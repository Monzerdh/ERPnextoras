import frappe
from frappe import _


def execute(filters=None):
	filters = filters or {}
	columns = get_columns()
	data = get_data(filters)
	return columns, data


def get_columns():
	return [
		{"fieldname": "item_code", "label": _("Item Code"), "fieldtype": "Link", "options": "Item", "width": 200},
		{"fieldname": "item_name", "label": _("Item Name"), "fieldtype": "Data", "width": 220},
		{"fieldname": "asin", "label": _("ASIN"), "fieldtype": "Data", "width": 140},
		{"fieldname": "batch", "label": _("Batch"), "fieldtype": "Link", "options": "Batch Number", "width": 110},
		{"fieldname": "serial", "label": _("Serial"), "fieldtype": "Link", "options": "Serial No", "width": 200},
		{"fieldname": "customer", "label": _("Customer"), "fieldtype": "Link", "options": "Customer", "width": 180},
		{"fieldname": "si", "label": _("Sales Invoice"), "fieldtype": "Link", "options": "Sales Invoice", "width": 170},
		{"fieldname": "pos", "label": _("POS Invoice"), "fieldtype": "Link", "options": "POS Invoice", "width": 170},
		{"fieldname": "sold_rate", "label": _("Sold Rate"), "fieldtype": "Currency", "width": 110},
		{"fieldname": "grade", "label": _("Grade"), "fieldtype": "Data", "width": 90},
		{"fieldname": "item_with_grade", "label": _("Item With Grade"), "fieldtype": "Data", "width": 160},
		{"fieldname": "condition", "label": _("Condition"), "fieldtype": "Data", "width": 130},
		{"fieldname": "mrp", "label": _("MRP"), "fieldtype": "Currency", "width": 100},
		{"fieldname": "shipment_request_id", "label": _("Shipment Request ID"), "fieldtype": "Data", "width": 170},
		{"fieldname": "tracking_number", "label": _("Tracking Number"), "fieldtype": "Link", "options": "Tracking No", "width": 150},
		{"fieldname": "shelf", "label": _("Trolley/Shelf"), "fieldtype": "Data", "width": 140},
		{"fieldname": "trolly_pallet", "label": _("Trolly/Pallet or Shelf"), "fieldtype": "Data", "width": 160},
		{"fieldname": "box", "label": _("Box"), "fieldtype": "Data", "width": 100},
		{"fieldname": "sn_rate", "label": _("Cost"), "fieldtype": "Currency", "width": 100},
		{"fieldname": "sub_category", "label": _("Sub Category"), "fieldtype": "Data", "width": 170},
		{"fieldname": "category", "label": _("Category"), "fieldtype": "Data", "width": 170},
		{"fieldname": "super_category", "label": _("Super Category"), "fieldtype": "Data", "width": 170},
		{"fieldname": "status", "label": _("Status"), "fieldtype": "Data", "width": 120},
		{"fieldname": "stock_blc", "label": _("Stock Balance"), "fieldtype": "Float", "width": 130},
	]


def _split_codes(raw):
	"""Split a scanner string (newline / comma / space) into deduped non-empty tokens."""
	if not raw:
		return []
	if isinstance(raw, list):
		tokens = raw
	else:
		s = str(raw).replace("\r", "\n").replace(",", "\n").replace("\t", "\n")
		tokens = s.split("\n")
	cleaned = []
	seen = set()
	for t in tokens:
		t = (t or "").strip()
		if t and t not in seen:
			seen.add(t)
			cleaned.append(t)
	return cleaned


def get_data(filters):
	conditions = []
	values = []

	def in_clause(field_name, key):
		selected = filters.get(key)
		if not selected:
			return
		if isinstance(selected, str):
			selected = [s for s in selected.split(",") if s]
		if not selected:
			return
		placeholders = ", ".join(["%s"] * len(selected))
		conditions.append(f"{field_name} IN ({placeholders})")
		values.extend(selected)

	in_clause("sn.item_code", "item_code")
	in_clause("sn.serial_no", "serial_no")
	in_clause("sn.custom_batch_number", "batch")
	in_clause("sn.custom_tracking_number", "tracking_number")
	in_clause("sn.custom_trolley_or_shelf_name", "trolly_pallet")
	in_clause("sn.custom_trolley_or_shelf_name", "shelf_name")
	in_clause("sn.custom_trolley_or_shelf", "shelf")
	in_clause("sn.custom_box", "box")
	in_clause("sn.custom_grade", "grade")
	in_clause("sn.custom_sales_invoice", "sales_invoice")
	in_clause("sn.custom_customer", "customer")
	in_clause("ig.item_group_name", "sub_category")
	in_clause("parent_ig.item_group_name", "category")
	in_clause("grandparent_ig.item_group_name", "super_category")
	in_clause("sn.status", "status")

	if filters.get("item_name"):
		conditions.append("sn.item_name LIKE %s")
		values.append(f"%{filters.get('item_name')}%")

	if filters.get("asin"):
		conditions.append("sn.custom_asin = %s")
		values.append(filters.get("asin"))

	if filters.get("item_with_grade"):
		conditions.append("sn.custom_item_code_with_grade = %s")
		values.append(filters.get("item_with_grade"))

	scan_tokens = _split_codes(filters.get("scan_codes"))
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

	condition_str = " AND ".join(conditions)
	if condition_str:
		condition_str = " AND " + condition_str

	limit_clause = ""
	if filters.get("enable_pagination"):
		page_number = int(filters.get("page_number") or 1)
		page_size = int(filters.get("page_size") or 500)
		offset = (page_number - 1) * page_size
		limit_clause = "LIMIT %s OFFSET %s"
		values.append(page_size)
		values.append(offset)

	query = f"""
		SELECT
			sn.item_code,
			sn.item_name,
			sn.status,
			sn.custom_item_code_with_grade AS item_with_grade,
			sn.custom_asin AS asin,
			sn.custom_batch_number AS batch,
			sn.serial_no AS serial,
			sn.custom_customer AS customer,
			sn.custom_sales_invoice AS si,
			sn.custom_pos_ AS pos,
			sn.custom_sold_rate AS sold_rate,
			sn.custom_grade AS grade,
			sn.custom_rate AS sn_rate,
			sn.custom_condition AS `condition`,
			it.custom_mrp AS mrp,
			sn.custom_shipment_request_id AS shipment_request_id,
			sn.custom_tracking_number AS tracking_number,
			sn.custom_trolley_or_shelf AS shelf,
			sn.custom_trolley_or_shelf_name AS trolly_pallet,
			sn.custom_box AS box,
			COALESCE(b.actual_qty, 0) AS stock_blc,
			ig.item_group_name AS sub_category,
			parent_ig.item_group_name AS category,
			grandparent_ig.item_group_name AS super_category
		FROM
			`tabSerial No` sn
		LEFT JOIN
			`tabItem` it ON sn.item_code = it.name
		LEFT JOIN
			`tabBin` b ON sn.item_code = b.item_code
		LEFT JOIN
			`tabItem Group` ig ON it.item_group = ig.name
		LEFT JOIN
			`tabItem Group` parent_ig ON ig.parent_item_group = parent_ig.name
		LEFT JOIN
			`tabItem Group` grandparent_ig ON parent_ig.parent_item_group = grandparent_ig.name
		WHERE
			sn.docstatus = 0 {condition_str}
		ORDER BY sn.creation DESC
		{limit_clause}
	"""

	return frappe.db.sql(query, tuple(values), as_dict=True)


@frappe.whitelist()
def resolve_scan_codes(codes):
	"""Optional helper for the JS side: take a list/string of scanned codes and
	return the matching Serial Nos and Items so the UI can preview before
	applying the filter. Permission: read on Serial No."""
	frappe.has_permission("Serial No", "read", throw=True)
	tokens = _split_codes(codes)
	if not tokens:
		return {"matches": [], "missing": []}

	ph = ", ".join(["%s"] * len(tokens))
	rows = frappe.db.sql(
		f"""
		SELECT sn.serial_no, sn.item_code, sn.status, sn.custom_asin, sn.custom_tracking_number
		FROM `tabSerial No` sn
		WHERE sn.serial_no IN ({ph})
		   OR sn.custom_asin IN ({ph})
		   OR sn.custom_tracking_number IN ({ph})
		   OR sn.item_code IN ({ph})
		   OR sn.item_code IN (SELECT parent FROM `tabItem Barcode` WHERE barcode IN ({ph}))
		""",
		tuple(tokens) * 5,
		as_dict=True,
	)
	found_codes = {r.serial_no for r in rows} | {r.custom_asin for r in rows if r.custom_asin} | {r.custom_tracking_number for r in rows if r.custom_tracking_number} | {r.item_code for r in rows}
	missing = [t for t in tokens if t not in found_codes]
	return {"matches": rows, "missing": missing}
