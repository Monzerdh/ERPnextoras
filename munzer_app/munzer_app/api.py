"""Whitelisted API for the Inventory Workstation page.

Endpoints:
- list_serials       paginated + sorted + summary aggregates
- get_serial_detail  full record + linked invoices + last 50 ledger entries
- quick_scan         resolve a scanned code (serial / asin / tracking / barcode / item)
- bulk_change_status status update across many serials
- bulk_move_location location update across many serials
- print_label_url    print URL for a serial
- export_xlsx        Excel of ALL rows matching current filters (no pagination)
- broadcast_serial_update  doc_event hook → publish_realtime
"""

import json

import frappe
from frappe import _


VALID_STATUS = {"Active", "Inactive", "Consumed", "Delivered", "Expired"}


# Whitelisted sort columns (no SQL injection — only keys here are accepted).
# UI sends column key, server maps to fully qualified column.
SORTABLE_COLUMNS = {
	"serial_no": "sn.serial_no",
	"item_code": "sn.item_code",
	"item_name": "sn.item_name",
	"status": "sn.status",
	"grade": "sn.custom_grade",
	"warehouse": "sn.warehouse",
	"purchase_price": "sn.custom_rate",
	"selling_price": "sn.custom_sold_rate",
	"creation": "sn.creation",
	"days_in_stock": "sn.creation",  # asc on creation = oldest first = most days
	"category": "parent_ig.item_group_name",
	"sub_category": "ig.item_group_name",
	"super_category": "grandparent_ig.item_group_name",
	"location_name": "sn.custom_trolley_or_shelf_name",
	"box": "sn.custom_box",
	"customer": "sn.custom_customer",
	"asin": "sn.custom_asin",
	"tracking_number": "sn.custom_tracking_number",
	"batch": "sn.custom_batch_number",
	"mrp": "it.custom_mrp",
}


# Master column list for export. Keep keys consistent with frontend.
EXPORT_COLUMNS = [
	("serial_no", "Serial No"),
	("item_code", "Item Code"),
	("item_name", "Item Name"),
	("super_category", "Super Category"),
	("category", "Category"),
	("sub_category", "Sub Category"),
	("grade", "Grade"),
	("status", "Status"),
	("warehouse", "Warehouse"),
	("location_name", "Location"),
	("box", "Box"),
	("batch", "Batch"),
	("customer", "Customer"),
	("sales_invoice", "Sales Invoice"),
	("pos", "POS Invoice"),
	("asin", "ASIN"),
	("tracking_number", "Tracking Number"),
	("shipment_request_id", "Shipment Request ID"),
	("condition", "Condition"),
	("purchase_price", "Purchase Price"),
	("selling_price", "Selling Price"),
	("mrp", "MRP"),
	("creation", "Date Added"),
	("days_in_stock", "Days in Stock"),
]


# ---- helpers ----------------------------------------------------------------


def _parse_list(value):
	"""Accept list / JSON-string-of-list / comma string → cleaned list of unique str (preserves order)."""
	if not value:
		return []
	if isinstance(value, list):
		items = value
	else:
		s = str(value).strip()
		if s.startswith("["):
			try:
				items = json.loads(s)
			except ValueError:
				items = [s]
		else:
			items = s.replace("\n", ",").split(",")
	out, seen = [], set()
	for x in items:
		t = str(x).strip()
		if t and t not in seen:
			seen.add(t)
			out.append(t)
	return out


def _split_codes(raw):
	if not raw:
		return []
	if isinstance(raw, list):
		tokens = raw
	else:
		s = str(raw).replace("\r", "\n").replace(",", "\n").replace("\t", "\n")
		tokens = s.split("\n")
	out, seen = [], set()
	for t in tokens:
		t = (t or "").strip()
		if t and t not in seen:
			seen.add(t)
			out.append(t)
	return out


def _coerce_filters(filters):
	if filters is None:
		return {}
	if isinstance(filters, dict):
		return filters
	try:
		return json.loads(filters) if filters else {}
	except ValueError:
		return {}


def _build_where(filters, search):
	"""Build a parameterised WHERE fragment + values list. SQL injection safe — every
	user-supplied value goes through %s placeholders, only the field names come from
	a hard-coded whitelist below."""
	conditions = ["sn.docstatus = 0"]
	values = []

	def in_clause(field, key):
		vals = _parse_list((filters or {}).get(key))
		if vals:
			ph = ", ".join(["%s"] * len(vals))
			conditions.append(f"{field} IN ({ph})")
			values.extend(vals)

	in_clause("sn.status", "status")
	in_clause("sn.item_code", "item_code")
	in_clause("sn.custom_grade", "grade")
	in_clause("sn.custom_batch_number", "batch")
	in_clause("sn.custom_customer", "customer")
	in_clause("sn.custom_sales_invoice", "sales_invoice")
	in_clause("sn.custom_trolley_or_shelf", "shelf")
	in_clause("sn.custom_trolley_or_shelf_name", "trolly_pallet")
	in_clause("sn.custom_trolley_or_shelf_name", "shelf_name")
	in_clause("sn.custom_box", "box")
	in_clause("sn.custom_tracking_number", "tracking_number")
	in_clause("sn.warehouse", "warehouse")
	in_clause("ig.item_group_name", "sub_category")
	in_clause("parent_ig.item_group_name", "category")
	in_clause("grandparent_ig.item_group_name", "super_category")

	# loose text matches (LIKE)
	for key, field in (
		("item_name", "sn.item_name"),
	):
		v = (filters or {}).get(key)
		if v:
			conditions.append(f"{field} LIKE %s")
			values.append(f"%{v}%")

	# exact text matches
	for key, field in (
		("asin", "sn.custom_asin"),
		("item_with_grade", "sn.custom_item_code_with_grade"),
	):
		v = (filters or {}).get(key)
		if v:
			conditions.append(f"{field} = %s")
			values.append(v)

	# global search (matches any of several fields)
	if search:
		s = f"%{search}%"
		conditions.append(
			"(sn.serial_no LIKE %s OR sn.item_code LIKE %s OR sn.item_name LIKE %s "
			"OR sn.custom_asin LIKE %s OR sn.custom_tracking_number LIKE %s)"
		)
		values.extend([s] * 5)

	# bulk scan filter — ORs across multiple identifier fields
	scan_tokens = _split_codes((filters or {}).get("scan_codes"))
	if scan_tokens:
		ph = ", ".join(["%s"] * len(scan_tokens))
		conditions.append(
			f"(sn.serial_no IN ({ph}) "
			f"OR sn.custom_asin IN ({ph}) "
			f"OR sn.custom_tracking_number IN ({ph}) "
			f"OR sn.item_code IN ({ph}) "
			f"OR sn.item_code IN (SELECT parent FROM `tabItem Barcode` WHERE barcode IN ({ph})))"
		)
		values.extend(scan_tokens * 5)

	return " AND ".join(conditions), values


def _select_columns():
	"""Single source of truth for the column list returned by list/export.
	Aliases match the frontend keys."""
	return """
		sn.name AS serial_no,
		sn.item_code,
		sn.item_name,
		sn.status,
		sn.warehouse,
		sn.custom_asin AS asin,
		sn.custom_grade AS grade,
		sn.custom_batch_number AS batch,
		sn.custom_customer AS customer,
		sn.custom_sales_invoice AS sales_invoice,
		sn.custom_pos_ AS pos,
		sn.custom_sold_rate AS selling_price,
		sn.custom_rate AS purchase_price,
		sn.custom_condition AS `condition`,
		sn.custom_shipment_request_id AS shipment_request_id,
		sn.custom_tracking_number AS tracking_number,
		sn.custom_trolley_or_shelf AS shelf_kind,
		sn.custom_trolley_or_shelf_name AS location_name,
		sn.custom_box AS box,
		sn.custom_item_code_with_grade AS item_with_grade,
		it.custom_mrp AS mrp,
		it.image AS image,
		ig.item_group_name AS sub_category,
		parent_ig.item_group_name AS category,
		grandparent_ig.item_group_name AS super_category,
		sn.creation,
		DATEDIFF(NOW(), sn.creation) AS days_in_stock
	"""


def _from_join():
	return """
		`tabSerial No` sn
		LEFT JOIN `tabItem` it ON it.name = sn.item_code
		LEFT JOIN `tabItem Group` ig ON ig.name = it.item_group
		LEFT JOIN `tabItem Group` parent_ig ON parent_ig.name = ig.parent_item_group
		LEFT JOIN `tabItem Group` grandparent_ig ON grandparent_ig.name = parent_ig.parent_item_group
	"""


def _resolve_sort(sort_by, sort_dir):
	col = SORTABLE_COLUMNS.get(sort_by) or "sn.creation"
	direction = "ASC" if str(sort_dir or "").lower() == "asc" else "DESC"
	return col, direction


# ---- list -------------------------------------------------------------------


@frappe.whitelist()
def list_serials(
	filters=None,
	search=None,
	page=1,
	page_size=100,
	sort_by="creation",
	sort_dir="desc",
	with_summary=1,
):
	frappe.has_permission("Serial No", "read", throw=True)

	page = max(1, int(page or 1))
	page_size = min(1000, max(20, int(page_size or 100)))
	offset = (page - 1) * page_size

	filters = _coerce_filters(filters)
	where, values = _build_where(filters, search)
	sort_col, sort_dir_sql = _resolve_sort(sort_by, sort_dir)

	total = frappe.db.sql(
		f"SELECT COUNT(*) FROM {_from_join()} WHERE {where}",
		tuple(values),
	)[0][0]

	rows = frappe.db.sql(
		f"""
		SELECT {_select_columns()}
		FROM {_from_join()}
		WHERE {where}
		ORDER BY {sort_col} {sort_dir_sql}
		LIMIT %s OFFSET %s
		""",
		tuple(values) + (page_size, offset),
		as_dict=True,
	)

	summary = None
	if int(with_summary or 0):
		summary = _list_summary(filters, search)

	return {
		"rows": rows,
		"total": total,
		"page": page,
		"page_size": page_size,
		"sort_by": sort_by,
		"sort_dir": sort_dir,
		"summary": summary,
	}


def _list_summary(filters, search):
	"""Aggregates over the *current filter set* — used for the bottom stat bar."""
	where, values = _build_where(filters, search)

	row = frappe.db.sql(
		f"""
		SELECT
			COUNT(*) AS total_items,
			COALESCE(SUM(sn.custom_rate), 0) AS total_purchase_value,
			COALESCE(SUM(sn.custom_sold_rate), 0) AS total_selling_value,
			COALESCE(AVG(DATEDIFF(NOW(), sn.creation)), 0) AS avg_days_in_stock
		FROM {_from_join()}
		WHERE {where}
		""",
		tuple(values),
		as_dict=True,
	)[0]

	# status breakdown — useful for the status quick filter pills
	status_rows = frappe.db.sql(
		f"""
		SELECT sn.status, COUNT(*) AS c
		FROM {_from_join()}
		WHERE {where}
		GROUP BY sn.status
		""",
		tuple(values),
		as_dict=True,
	)
	row["by_status"] = {r["status"]: r["c"] for r in status_rows}
	return row


# ---- detail -----------------------------------------------------------------


@frappe.whitelist()
def get_serial_detail(serial_no):
	frappe.has_permission("Serial No", "read", throw=True)
	if not serial_no:
		frappe.throw(_("serial_no is required"))

	doc = frappe.get_doc("Serial No", serial_no)
	if not doc.has_permission("read"):
		frappe.throw(_("Not allowed"), frappe.PermissionError)

	item = None
	if doc.item_code:
		item = frappe.db.get_value(
			"Item",
			doc.item_code,
			["item_code", "item_name", "image", "description", "valuation_rate", "stock_uom", "item_group"],
			as_dict=True,
		)

	stock_ledger = (
		frappe.db.sql(
			"""
			SELECT
				sle.posting_date,
				sle.posting_time,
				sle.warehouse,
				sle.voucher_type,
				sle.voucher_no,
				sle.actual_qty,
				sle.qty_after_transaction
			FROM `tabStock Ledger Entry` sle
			WHERE sle.serial_no LIKE %s OR sle.serial_and_batch_bundle IN (
				SELECT bun.parent FROM `tabSerial and Batch Entry` bun WHERE bun.serial_no = %s
			)
			ORDER BY sle.posting_date DESC, sle.posting_time DESC
			LIMIT 50
			""",
			(f"%{serial_no}%", serial_no),
			as_dict=True,
		)
		or []
	)

	barcodes = []
	if doc.item_code:
		barcodes = (
			frappe.get_all(
				"Item Barcode",
				filters={"parent": doc.item_code},
				fields=["barcode", "barcode_type", "uom"],
			)
			or []
		)

	return {
		"doc": doc.as_dict(),
		"item": item,
		"stock_ledger": stock_ledger,
		"barcodes": barcodes,
	}


# ---- scan -------------------------------------------------------------------


@frappe.whitelist()
def quick_scan(code):
	frappe.has_permission("Serial No", "read", throw=True)
	if not code:
		return {"matches": []}
	code = str(code).strip()
	if not code:
		return {"matches": []}

	if frappe.db.exists("Serial No", code):
		return {"matches": [{"serial_no": code, "via": "serial_no"}], "code": code}

	for field, via in (("custom_asin", "asin"), ("custom_tracking_number", "tracking_number")):
		serials = frappe.db.get_all(
			"Serial No",
			filters={field: code, "docstatus": 0},
			pluck="name",
			limit=20,
		)
		if serials:
			return {"matches": [{"serial_no": s, "via": via} for s in serials], "code": code}

	parent_item = frappe.db.get_value("Item Barcode", {"barcode": code}, "parent")
	if parent_item:
		serials = frappe.db.get_all(
			"Serial No",
			filters={"item_code": parent_item, "docstatus": 0},
			pluck="name",
			limit=200,
		)
		return {
			"matches": [{"serial_no": s, "via": "item_barcode"} for s in serials],
			"code": code,
			"item_code": parent_item,
		}

	if frappe.db.exists("Item", code):
		serials = frappe.db.get_all(
			"Serial No",
			filters={"item_code": code, "docstatus": 0},
			pluck="name",
			limit=200,
		)
		return {
			"matches": [{"serial_no": s, "via": "item_code"} for s in serials],
			"code": code,
			"item_code": code,
		}

	return {"matches": [], "code": code}


# ---- bulk actions -----------------------------------------------------------


@frappe.whitelist()
def bulk_change_status(serial_nos, status):
	frappe.has_permission("Serial No", "write", throw=True)
	serial_nos = _parse_list(serial_nos)
	if status not in VALID_STATUS:
		frappe.throw(_("Invalid status: {0}").format(status))
	if not serial_nos:
		return {"updated": 0}

	updated = 0
	errors = []
	for sn in serial_nos:
		try:
			doc = frappe.get_doc("Serial No", sn)
			if not doc.has_permission("write"):
				errors.append({"serial_no": sn, "error": "permission denied"})
				continue
			doc.status = status
			doc.save(ignore_version=True)
			updated += 1
		except Exception as e:
			errors.append({"serial_no": sn, "error": str(e)})

	frappe.db.commit()
	return {"updated": updated, "errors": errors}


@frappe.whitelist()
def bulk_move_location(serial_nos, shelf_kind=None, location_name=None, box=None):
	frappe.has_permission("Serial No", "write", throw=True)
	serial_nos = _parse_list(serial_nos)
	if not serial_nos:
		return {"updated": 0}

	updated = 0
	errors = []
	for sn in serial_nos:
		try:
			doc = frappe.get_doc("Serial No", sn)
			if not doc.has_permission("write"):
				errors.append({"serial_no": sn, "error": "permission denied"})
				continue
			if shelf_kind is not None:
				doc.custom_trolley_or_shelf = shelf_kind
			if location_name is not None:
				doc.custom_trolley_or_shelf_name = location_name
			if box is not None:
				doc.custom_box = box
			doc.save(ignore_version=True)
			updated += 1
		except Exception as e:
			errors.append({"serial_no": sn, "error": str(e)})

	frappe.db.commit()
	return {"updated": updated, "errors": errors}


# ---- print ------------------------------------------------------------------


@frappe.whitelist()
def print_label_url(serial_no, print_format=None):
	frappe.has_permission("Serial No", "read", throw=True)
	if not serial_no:
		frappe.throw(_("serial_no is required"))
	pf = print_format or "Standard"
	from urllib.parse import urlencode

	qs = urlencode(
		{
			"doctype": "Serial No",
			"name": serial_no,
			"format": pf,
			"no_letterhead": 0,
		}
	)
	return {"url": f"/api/method/frappe.utils.print_format.download_pdf?{qs}"}


# ---- export -----------------------------------------------------------------


@frappe.whitelist()
def export_xlsx(filters=None, search=None, sort_by="creation", sort_dir="desc", selected=None):
	"""Stream all rows matching filters as an .xlsx file. If `selected` is
	provided (JSON list of serial_nos), only those are exported."""
	frappe.has_permission("Serial No", "read", throw=True)

	filters = _coerce_filters(filters)
	where, values = _build_where(filters, search)
	sort_col, sort_dir_sql = _resolve_sort(sort_by, sort_dir)

	if selected:
		sel = _parse_list(selected)
		if sel:
			ph = ", ".join(["%s"] * len(sel))
			where = f"({where}) AND sn.name IN ({ph})"
			values = list(values) + sel

	rows = frappe.db.sql(
		f"""
		SELECT {_select_columns()}
		FROM {_from_join()}
		WHERE {where}
		ORDER BY {sort_col} {sort_dir_sql}
		""",
		tuple(values),
		as_dict=True,
	)

	header = [label for _key, label in EXPORT_COLUMNS]
	keys = [key for key, _label in EXPORT_COLUMNS]
	data = [header]
	for r in rows:
		data.append([_xlsx_safe(r.get(k)) for k in keys])

	from frappe.utils.xlsxutils import make_xlsx

	xlsx_file = make_xlsx(data, "Inventory")

	frappe.response["filename"] = "inventory_export.xlsx"
	frappe.response["filecontent"] = xlsx_file.getvalue()
	frappe.response["type"] = "binary"


def _xlsx_safe(v):
	if v is None:
		return ""
	# datetimes → ISO so Excel can parse them
	import datetime as _dt

	if isinstance(v, (_dt.datetime, _dt.date)):
		return v.isoformat(sep=" ")
	return v


# ---- doc events / realtime --------------------------------------------------


def broadcast_serial_update(doc, method=None):
	try:
		frappe.publish_realtime(
			event="munzer_inventory_update",
			message={
				"serial_no": doc.name,
				"item_code": doc.item_code,
				"status": doc.status,
				"location_name": getattr(doc, "custom_trolley_or_shelf_name", None),
				"shelf_kind": getattr(doc, "custom_trolley_or_shelf", None),
				"box": getattr(doc, "custom_box", None),
				"modified": str(doc.modified),
			},
			after_commit=True,
		)
	except Exception:
		frappe.log_error(frappe.get_traceback(), "munzer_app: realtime broadcast failed")
