"""Whitelisted API for the Inventory Workstation page.

Contract:
- list_serials: paginated, filterable list for the left panel
- get_serial_detail: full record + linked invoices + last 50 stock ledger entries
- quick_scan: resolve any scanned code (serial / asin / tracking / barcode) to a serial
- bulk_change_status: status update across many serials
- bulk_move_location: location update across many serials
- print_label_url: returns a print URL for a serial
- broadcast_serial_update: doc_event hook → emits a realtime event so live workstations
  see each other's changes
"""

import json

import frappe
from frappe import _
from frappe.utils import flt


# ---- helpers ----------------------------------------------------------------

VALID_STATUS = {"Active", "Inactive", "Consumed", "Delivered", "Expired"}


def _parse_list(value):
	"""Accept list, JSON-string-of-list, comma string. Return cleaned list of str."""
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
			items = [t for t in s.replace("\n", ",").split(",")]
	return [str(x).strip() for x in items if str(x).strip()]


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


def _build_where(filters, search):
	"""Build a parameterised WHERE fragment + values list."""
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
	in_clause("sn.custom_trolley_or_shelf", "shelf")
	in_clause("sn.custom_trolley_or_shelf_name", "trolly_pallet")
	in_clause("sn.custom_trolley_or_shelf_name", "shelf_name")
	in_clause("sn.custom_box", "box")

	if search:
		s = f"%{search}%"
		conditions.append(
			"(sn.serial_no LIKE %s OR sn.item_code LIKE %s OR sn.item_name LIKE %s "
			"OR sn.custom_asin LIKE %s OR sn.custom_tracking_number LIKE %s)"
		)
		values.extend([s] * 5)

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


# ---- list -------------------------------------------------------------------

@frappe.whitelist()
def list_serials(filters=None, search=None, page=1, page_size=100):
	"""Paginated list for the workstation. Returns rows + total + facets for the
	current filter set so the UI can show counts."""
	frappe.has_permission("Serial No", "read", throw=True)

	page = max(1, int(page or 1))
	page_size = min(500, max(20, int(page_size or 100)))
	offset = (page - 1) * page_size

	if isinstance(filters, str):
		try:
			filters = json.loads(filters)
		except ValueError:
			filters = {}

	where, values = _build_where(filters, search)

	total = frappe.db.sql(
		f"SELECT COUNT(*) FROM `tabSerial No` sn WHERE {where}",
		tuple(values),
	)[0][0]

	rows = frappe.db.sql(
		f"""
		SELECT
			sn.name AS serial_no,
			sn.item_code,
			sn.item_name,
			sn.status,
			sn.custom_asin AS asin,
			sn.custom_grade AS grade,
			sn.custom_batch_number AS batch,
			sn.custom_customer AS customer,
			sn.custom_sales_invoice AS sales_invoice,
			sn.custom_sold_rate AS sold_rate,
			sn.custom_rate AS cost,
			sn.custom_trolley_or_shelf AS shelf_kind,
			sn.custom_trolley_or_shelf_name AS location_name,
			sn.custom_box AS box,
			sn.custom_tracking_number AS tracking_number,
			sn.custom_condition AS `condition`,
			sn.custom_shipment_request_id AS shipment_request_id,
			it.custom_mrp AS mrp,
			it.image AS image
		FROM `tabSerial No` sn
		LEFT JOIN `tabItem` it ON it.name = sn.item_code
		WHERE {where}
		ORDER BY sn.modified DESC
		LIMIT %s OFFSET %s
		""",
		tuple(values) + (page_size, offset),
		as_dict=True,
	)

	# status facet counts (so the UI can show a tab strip)
	facets = {}
	for status in VALID_STATUS:
		facets[status] = frappe.db.count("Serial No", {"status": status, "docstatus": 0})

	return {
		"rows": rows,
		"total": total,
		"page": page,
		"page_size": page_size,
		"facets": facets,
	}


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

	stock_ledger = frappe.db.sql(
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
	) or []

	barcodes = []
	if doc.item_code:
		barcodes = frappe.get_all(
			"Item Barcode",
			filters={"parent": doc.item_code},
			fields=["barcode", "barcode_type", "uom"],
		) or []

	return {
		"doc": doc.as_dict(),
		"item": item,
		"stock_ledger": stock_ledger,
		"barcodes": barcodes,
	}


# ---- scan -------------------------------------------------------------------

@frappe.whitelist()
def quick_scan(code):
	"""Resolve a scanned code to one or more Serial Nos.
	Tries: Serial No name → ASIN → Tracking → Item barcode → Item code."""
	frappe.has_permission("Serial No", "read", throw=True)
	if not code:
		return {"matches": []}

	code = str(code).strip()
	if not code:
		return {"matches": []}

	# 1. exact serial
	if frappe.db.exists("Serial No", code):
		return {"matches": [{"serial_no": code, "via": "serial_no"}], "code": code}

	# 2. ASIN / Tracking exact match (custom fields)
	for field, via in (("custom_asin", "asin"), ("custom_tracking_number", "tracking_number")):
		serials = frappe.db.get_all(
			"Serial No",
			filters={field: code, "docstatus": 0},
			pluck="name",
			limit=20,
		)
		if serials:
			return {"matches": [{"serial_no": s, "via": via} for s in serials], "code": code}

	# 3. Item Barcode → all serials of that item
	parent_item = frappe.db.get_value("Item Barcode", {"barcode": code}, "parent")
	if parent_item:
		serials = frappe.db.get_all(
			"Serial No",
			filters={"item_code": parent_item, "docstatus": 0},
			pluck="name",
			limit=200,
		)
		return {"matches": [{"serial_no": s, "via": "item_barcode"} for s in serials], "code": code, "item_code": parent_item}

	# 4. Item code → all its serials
	if frappe.db.exists("Item", code):
		serials = frappe.db.get_all(
			"Serial No",
			filters={"item_code": code, "docstatus": 0},
			pluck="name",
			limit=200,
		)
		return {"matches": [{"serial_no": s, "via": "item_code"} for s in serials], "code": code, "item_code": code}

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
	"""Move serials between locations.
	shelf_kind: "Pallet or Trolley" | "Shelf" | None to leave unchanged
	location_name: string (links to Pallet or Trolley / Shelf doctype) or None
	box: string or None
	"""
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

	qs = urlencode({
		"doctype": "Serial No",
		"name": serial_no,
		"format": pf,
		"no_letterhead": 0,
	})
	return {"url": f"/api/method/frappe.utils.print_format.download_pdf?{qs}"}


# ---- doc events / realtime --------------------------------------------------

def broadcast_serial_update(doc, method=None):
	"""Hooked to Serial No `on_update`. Emits a realtime event consumed by
	the Inventory Workstation page so multiple users see each other's edits."""
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
		# never block the save because of a realtime hiccup
		frappe.log_error(frappe.get_traceback(), "munzer_app: realtime broadcast failed")
