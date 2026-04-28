"""One-time rename: Module Def 'Munzer App' -> 'Munzer Oras App'.

The app's display title and module name were updated. modules.txt now
lists 'Munzer Oras App'. Without this patch, frappe's modules.txt sync
would create a *new* Module Def 'Munzer Oras App' alongside the old
'Munzer App', leaving the existing Item Master Report S and
Inventory Workstation page linked to the old (now empty) module.

The patch:
 1. Returns silently if the old name doesn't exist (fresh installs).
 2. Renames the Module Def using frappe.rename_doc, which cascades to
    all linked DocTypes, Reports, Pages, Workspaces and Print Formats.
 3. If both names exist (edge case from a previously-failed migrate),
    merges old into new by hand, then deletes the old.
"""

import frappe


OLD = "Munzer App"
NEW = "Munzer Oras App"

# DocTypes whose `module` column we touch in the merge fallback below.
LINKED_DOCTYPES = (
	"DocType",
	"Report",
	"Page",
	"Workspace",
	"Print Format",
	"Web Form",
	"Notification",
	"Server Script",
	"Client Script",
	"Property Setter",
	"Custom Field",
	"Dashboard",
	"Dashboard Chart",
	"Number Card",
)


def execute():
	if not frappe.db.exists("Module Def", OLD):
		return

	if frappe.db.exists("Module Def", NEW):
		_merge_old_into_new()
	else:
		try:
			frappe.rename_doc("Module Def", OLD, NEW, force=True, merge=False)
		except frappe.NameError:
			# Race or partial state — fall back to manual merge.
			_merge_old_into_new()

	frappe.db.commit()


def _merge_old_into_new():
	for dt in LINKED_DOCTYPES:
		if not frappe.db.exists("DocType", dt):
			continue
		try:
			meta = frappe.get_meta(dt)
		except Exception:
			continue
		if not meta.has_field("module"):
			continue
		frappe.db.sql(
			f"UPDATE `tab{dt}` SET module = %s WHERE module = %s",
			(NEW, OLD),
		)
	frappe.delete_doc("Module Def", OLD, force=True, ignore_permissions=True)
