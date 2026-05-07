# Handover Notes — Munzer Oras App

For the next Claude session that picks up this project.

---

## 1. Snapshot

| | |
|---|---|
| **Repo** | https://github.com/Monzerdh/ERPnextoras (branch `main`) |
| **Live site** | https://orasbeta.k.frappe.cloud |
| **Frappe Cloud bench** | `bench-15714` (region: KSA) |
| **Frappe Cloud dashboard** | https://cloud.frappe.io/dashboard/groups/bench-15714 |
| **App on disk (Python pkg)** | `munzer_app` (unchanged forever) |
| **App display title** | `Munzer Oras App` |
| **Frappe module** | `Munzer Oras App` (slug `munzer_oras_app`) |
| **User's local repo** | `C:\Users\Munzer\Desktop\oras erp` (Windows, Git Bash) |
| **Other apps on the bench** | frappe, erpnext, hrms, posnext, oras (legacy), insights, healthcare, sif, ecommerce_integrations, akg, craft_hr, craft_project_invoicing, cheque_management_v2, frappe_whatsapp, workboard, purchase_vat_script |
| **Frappe version** | v15 (esbuild build pipeline, modern) |

**The user is Munzer (`munzer@oras.ae`)**. He's a manager at ORAS Electronics LLC (UAE-based, Amazon vendor), runs a warehouse with serial-tracked inventory. He's not a Frappe expert — he iterates fast, expects me to push commits and walk him through the Frappe Cloud UI for deploys. He's on Windows, uses Chrome, has the **Claude in Chrome** extension installed but its per-conversation domain permissions are flaky — fall back to asking him to paste console output if inspection fails.

---

## 2. What ships

### A. Item Master Report S
A Frappe **Script Report** at `/app/query-report/Item Master Report S`. ORAS-branded (deep navy + red `#E8173A`), scanner-first, uses Frappe's standard report machinery + heavy custom JS:

- Multi-barcode `Scan Mode` dialog, dedup, OR-across-fields filter
- Column show/hide popover (localStorage)
- Instant client-side CSV export
- Status pill-badges in cells, ASIN as Amazon link, green/red stock balance
- Same SQL backbone as the original Oras `Item Master Report` (in the legacy `oras` app) — joins `tabSerial No` → `tabItem` → `tabBin` → 3-level `tabItem Group`

Files: `munzer_app/munzer_oras_app/report/item_master_report_s/*`.

### B. Inventory Workstation (the real workhorse)
A Frappe **Page** at `/app/inventory-workstation`. **Amazon Seller Central** style — white background, `#FF9900` orange accents, Amazon Ember font. **NOT** the navy ORAS palette — the user explicitly rejected the dark theme for the workstation and wants Amazon Vendor Central look.

Layout:
```
+----------------------------------------------------------+
| top filter bar (sticky, multi-select dropdowns)          |
+----------------------------------------------------------+
| active filter chips · Showing X of Y · Clear all          |
+--------+-------------------------------------------------+
| 280px  | virtualized table (44px rows, sticky header,    |
| side   | sortable, resizable, drag-to-reorder columns,   |
| bar    | sticky-right "View on Amazon" button)            |
| - name |                                                 |
|   srch |                                                 |
| - scan |                                                 |
|   txar |                                                 |
+--------+-------------------------------------------------+
| selected count · stats: Total Items · MRP · Cost          |
+----------------------------------------------------------+
```

Files: `munzer_app/munzer_oras_app/page/inventory_workstation/*` (JS+JSON) plus `munzer_app/munzer_oras_app/api.py` for the backend.

---

## 3. Architecture — the why

### Standalone app (not a customisation of `oras`)
The legacy `oras` app on the bench owns the original `Item Master Report`. We *deliberately* did **NOT** modify it. `munzer_app` is a separate Frappe app installed alongside, so:
- The original report keeps working (we never touch it)
- Hooks are scoped to sites where `munzer_app` is installed
- Module name conflict is avoided (`Munzer Oras App` vs `Oras`)

### Why the Python package is `munzer_app` (not renamed to `munzer_oras_app`)
- Frappe Cloud doesn't gracefully handle Python-package-name renames. It involves uninstall + reinstall + risk of data loss.
- The **display title** and **module name** were changed to "Munzer Oras App" via the safer Path B (commit `6b04e08`). The on-disk Python package and the GitHub repo are still `munzer_app` / `ERPnextoras` — those names are invisible to end users.
- See `munzer_app/patches/v0_0_1/rename_module_to_munzer_oras_app.py` for the migration that renames the **Module Def** in the live DB. Frappe's `rename_doc` cascades to all linked DocTypes / Reports / Pages.

### Inner module folder is `munzer_oras_app/`
Frappe finds module folders via `frappe.scrub(module_name)`. Module is "Munzer Oras App" → folder slug `munzer_oras_app`. Renaming the folder is **required** when changing the module name; the migration patch must run before the standard modules.txt sync.

### Page vs Report
- **Report** = analyst tool, ad-hoc filter+export (Item Master Report S)
- **Page** = operational workstation, scanner-first, bulk actions, realtime (Inventory Workstation)
The user wanted *both*. Don't merge them.

### Frappe Cloud reality
- No bench shell access on the cloud. Every change requires: push to GitHub → Frappe Cloud Apps tab → "Fetch Latest Updates" → "Deploy" → wait for Active.
- Builds occasionally fail at Initialize Bench step due to Docker registry hiccups (`registry1-nbg.frappe.cloud` serving a KSA bench has had cross-region replication issues). **This is not a code problem.** Tell the user to retry, then open a Frappe Cloud support ticket if it persists.

---

## 4. Critical implementation choices

### Virtualized table for 70k rows
File: `inventory_workstation.js` — `renderTableBody`.
- Each row is `position: absolute; top: idx * 44px` inside a parent of total height = `total * 44px`.
- Only render `visibleStart - 12` to `visibleEnd + 12` — typically 30 rows in DOM.
- IntersectionObserver isn't used; we recompute on every scroll event throttled by `requestAnimationFrame`.
- Server pagination: 500 rows/page on demand. As user scrolls into a page that hasn't been fetched, JS fires `list_serials` for it.

### Sticky-right action column (View on Amazon)
- The row is `position: absolute` (for vertical virtualization). Inside it, the action cell uses `position: sticky; right: 0` and `background: var(--row-bg)`.
- Each row sets `--row-bg` based on its state (odd / even / hover / selected) so the sticky cell visually tracks the row.
- Header cell of sticky-right column has higher `z-index` than body cells.
- The user accepted that this column can't be reordered. The column manager dialog tags it `PINNED RIGHT` and disables its drag handle.

### Column resize (Excel style)
- Each `<th>` has a 6px hot-zone on its right edge (`.iw-th-resize`).
- Mousedown captures start X + start width, mousemove updates DOM widths inline (no re-render — uses `data-key` attributes on every `<th>` and `<td>` to bulk-update with `document.querySelectorAll`), mouseup commits to localStorage.
- requestAnimationFrame throttling keeps it under 60Hz even with hundreds of cells.
- Double-click the handle = auto-fit (measures `scrollWidth` of all visible cells + header label, adds 28px padding).
- Min 60px, max 800px guard rails.

### Column reorder (drag-and-drop)
- Native HTML5 drag/drop in the Columns dialog. No external library — Frappe pages have no bundler, so external deps are awkward.
- Live DOM reorder during `dragover` (insert dragged element before/after the hovered row based on midpoint).
- On `dragend`, capture DOM order → save to localStorage → re-render table.
- `visibleColumns()` flows through `orderedColumns()` which honours saved order, then force-pins sticky:right columns to the end.

### Scanner UX
File: `inventory_workstation.js` — sidebar `Scan / Search Serials` textarea.
- The pre-fix bug: dedup-on-input stripped the trailing `\n` the scanner just emitted, so the next scan glued onto the previous (`SN001SN002` instead of two lines).
- Fix: live keystrokes only update the count — never mutate the textarea. After 350ms idle (or on blur) dedupe in place AND append a trailing `\n` so cursor sits on a fresh empty line ready for next scan.
- Server side: `scan_codes` filter runs an OR across `serial_no`, `custom_asin`, `custom_tracking_number`, `item_code`, AND a subquery against `tabItem Barcode` to support warehouse-printed item barcodes.

### Realtime updates
- `hooks.py` doc_events on `Serial No.on_update` → `broadcast_serial_update` → `frappe.publish_realtime("munzer_inventory_update", ...)` after_commit=True.
- Page subscribes via `frappe.realtime.on("munzer_inventory_update", ...)` and patches the visible row.
- Only fires on sites where `munzer_app` is installed — other sites in the same bench are unaffected.

### Status display
- Status is **read-only** in the table (user explicitly asked for this — no inline edit). It renders as a coloured pill via `STATUS_TONES`.
- The only path to change a status is select-rows-then-bulk-action via the footer. This is intentional: prevents accidental clicks from changing data.
- Active = green, Inactive = grey, Consumed = red, **Delivered = also red** (user wanted both Delivered & Consumed visually flagged), Expired = orange.

### Excel export
- `export_xlsx` endpoint runs the same SQL as `list_serials` minus the LIMIT, builds an xlsx via `frappe.utils.xlsxutils.make_xlsx`, returns as binary response.
- JS triggers it via a hidden iframe with the URL — no navigation, page state preserved.
- Supports an optional `selected` arg (JSON list of serial_nos) so "Export Selected" works.
- Sync export is fine up to ~70k rows; takes 20-40s + ~50MB peak memory. If it hits Frappe Cloud's 30s gateway timeout in production, switch to `frappe.enqueue` background job + email/notify on completion.

### Brand palette (two themes — don't confuse them)
| Theme | Where | Colors |
|---|---|---|
| ORAS dark navy | Item Master Report S only | `#0f1146`, `#1a1c6e`, accent `#E8173A` |
| Amazon Seller Central | Inventory Workstation | white `#FFFFFF`, ink `#0F1111`, secondary `#565959`, borders `#D5D9D9`, accent `#FF9900`, hover `#FFF8EB`, selected `#FFF8EB`, link `#007185`, link hover `#C7511F` |

---

## 5. Gotchas hit so far (don't repeat)

1. **`frappe.utils.format_number` doesn't exist** on the Frappe version this site runs. Use vanilla `Intl` (`Number(v).toLocaleString("en-US", ...)`). Same for `frappe.utils.format_currency`. Helpers live at the top of `inventory_workstation.js`: `fmtNum`, `fmtMoney`.
2. **Custom buttons rendered into popovers / dialogs are mounted to `<body>`**, OUTSIDE the `.munzer-iw` scope. Style them with selectors that don't depend on the wrapper class. See `.iw-pop button` and `.iw-col-mgr button` rules.
3. **`<label>` rows with native `<input>` checkboxes don't survive HTML5 drag-and-drop cleanly**. The Columns dialog uses `<div>` rows + manual click-to-toggle handler on the label text.
4. **Per-row `--row-bg` CSS variable** is the only sane way to make sticky cells track zebra/hover/selected without flashing — set on the row, inherited by the sticky cell, change it instead of the row's `background`.
5. **`pyproject.toml` + `requirements.txt` together** triggers a Frappe Cloud "Pre Build Validation Warning" that pyproject takes precedence. We deleted `requirements.txt` and `setup.py` — pyproject alone is enough on v15.
6. **modules.txt sync runs after patches** in `bench migrate`. The rename patch must execute before sync, so it's registered in `patches.txt` and runs early. `frappe.rename_doc("Module Def", ...)` cascades to linked DocTypes / Reports / Pages, but the patch falls back to a manual UPDATE-and-delete if both old/new names already exist.
7. **Permissions on Claude in Chrome are per-tab and reset on tab close**. If you're trying to inspect the live page and getting `permission_required`, ask the user to open Chrome → extension settings → Claude → Site access → "On all sites", and even then it sometimes still gates per-conversation. Falling back to asking for pasted DevTools console output is more reliable.
8. **Frappe Cloud Docker registry retry loop on Initialize Bench** is an infrastructure issue, not a code one. Don't waste time trying to "fix" it from code.

---

## 6. Open improvements / future work

Ranked by impact.

### High-value, near-term
1. **Background-job Excel export** — current sync export will time out for >100k rows. Move to `frappe.enqueue` + emit a "ready" toast / notification when done. Optional: email a download link.
2. **Save column visibility/order/widths PER-USER on the server** — currently localStorage. If the user logs in from another browser, they lose their layout. Add a `User Default` or a small `Munzer Workstation Pref` DocType.
3. **Saved views / presets** ("Returns awaiting QC", "Customer X's serials", "Box 12 audit") — UI: a strip of named buttons above the filter bar; click to load filter + sort + visible-cols snapshot.
4. **Audit mode** — scan all serials in a location, get a diff against expected (missing / extra / mis-located). High value for warehouse ops.
5. **Mobile/tablet layout** — sidebar collapses to a slide-out, table scrolls horizontally. Currently usable on tablet but not great on phones.

### Mid-value
6. **Custom label print format** — `print_label_url` currently returns Frappe's "Standard" PDF which is generic. A barcode-shaped label (Code 128) with serial + item + grade + price would be a real warehouse asset.
7. **Inline cell tooltips** for long item names — currently uses HTML `title` attr which is OS-styled. A floating tooltip that matches the Amazon look would be nicer.
8. **Multi-language (Arabic RTL)** — the price-checker page on `orasdxb.frappe.cloud` already has an Arabic toggle. Some warehouse staff may prefer Arabic.
9. **Faster sort on joined columns** — Category / Sub Category / Super Category sort joins three Item Group rows. Add MySQL composite indexes on `tabItem Group(parent_item_group)` if real queries get slow.
10. **Frozen left columns** (Serial No, Item Code) — same `position: sticky; left: 0` pattern as the right-side action column. The CSS infrastructure already handles `--row-bg`; just add `iw-td-sticky-left` rules.

### Lower-priority but nice
11. **Drag-to-multi-select** rows on the table.
12. **Keyboard shortcuts** — `J/K` to navigate selection, `space` to toggle, `/` to focus scanner, `Esc` to clear filters.
13. **Recent-scans dropdown** — the scanner textarea remembers the last 50 batches per user.
14. **`Ctrl+Click` row** — opens the Serial No record in a new tab without selecting.
15. **Action column polymorphism** — same sticky-right slot, but per-status icon (e.g. "Mark for Audit" if Active, "View Invoice" if Delivered).
16. **Custom column visibility for Item Master Report S** — the Inventory Workstation has it, the Report S only has Frappe's built-in "Pick Columns" which is buried.

### Architecture-level
17. **Migrate to FrappeUI / Vue 3** — the Frappe team's modern reactive framework, used by HRMS / Frappe Books. Would replace the hand-rolled state management in `inventory_workstation.js`. **Big rewrite — only do if the user asks for advanced features that hand-rolled JS struggles with.**
18. **Move deduplication / dedupe-as-you-scan logic to a small worker** so the UI never stalls on huge paste-scan operations.

---

## 7. Workflow tips for the next Claude

### Iterate fast on JS only
The user runs Frappe Cloud production. After a JS-only change:
1. Edit the file
2. `git add -A && git commit && git push origin main`
3. Tell the user: "**Apps tab → Fetch Latest Updates → Deploys → Deploy → hard refresh (Ctrl+Shift+R)**"

For Python changes the same flow works, but the user must wait for migrate to finish.

### When the page is blank
Always your first move: ask for the **DevTools Console output**. Common causes (in order of frequency):
- New Frappe API used that doesn't exist on this version (e.g., `frappe.utils.format_number`)
- Typo in a frappe.call() method path
- Build hasn't deployed yet — verify the active commit on Apps tab
- Module Def mismatch after a partial migrate (the patch didn't run for some reason)

### Validating before push
```bash
node -e "new Function(require('fs').readFileSync('munzer_app/munzer_oras_app/page/inventory_workstation/inventory_workstation.js','utf8')); console.log('JS OK')"
python -c "import ast; ast.parse(open('munzer_app/munzer_oras_app/api.py').read()); print('PY OK')"
```
Catches 90% of typos. Doesn't catch runtime errors.

### Don't even try to run bench locally
The user is on Windows. We discussed Docker (frappe_docker) but he hasn't set it up. He's been iterating directly against `orasbeta` which is fine for this scale. If you do want a local env, the conversation has the `frappe_docker` setup plan written out.

### When the user asks "do you do everything for me?"
Be honest: I can't install Docker Desktop, I can't sign into Frappe Cloud, I can't pull database backups. But I CAN do all the code, all the deploy choreography (telling him which buttons to click), and inspect the live page **if** the Chrome extension permission cooperates.

### When the user gives ambiguous instructions
He types fast and skips words. "ok lets do B" usually means "execute the full plan you described in option B". "for this" almost always means whatever was at the top of his screen. Ask **one** clarifying question if you can't infer; otherwise pick the most-likely interpretation and call it out at the top of your response.

### What he likes
- Speed. Push fast, deploy fast.
- **Modern Amazon-style UI** (yellow gradient buttons, not native chrome, not dark themes for the workstation)
- Excel-style power-user shortcuts (resize columns, drag reorder, dbl-click autofit)
- Scanner-driven flows
- Concrete numbers in summaries
- Brevity in responses

### What he dislikes
- Anything that looks like default Windows widgets
- Dark themes for the workstation (he tolerated the report's navy palette but wanted the workstation white)
- Buttons that aren't clearly call-to-action shaped
- Long explanations of trivial steps

---

## 8. Quick code orientation

```
oras erp/                                      <- repo root
  HANDOVER.md                                  <- this file
  README.md
  pyproject.toml
  MANIFEST.in
  license.txt
  munzer_app/                                  <- Python pkg
    __init__.py                                <- __version__
    hooks.py                                   <- app_title, doc_events
    modules.txt                                <- "Munzer Oras App"
    patches.txt                                <- registers v0_0_1 patch
    config/desktop.py                          <- Workspace card
    munzer_oras_app/                           <- module folder (slug)
      __init__.py
      api.py                                   <- whitelisted endpoints
        - list_serials                         <- paginated + sort + summary
        - get_serial_detail                    <- (legacy from split-view era)
        - quick_scan                           <- scan resolver (legacy)
        - bulk_change_status                   <- used by footer
        - bulk_move_location                   <- (legacy from split-view era)
        - print_label_url                      <- (legacy from split-view era)
        - export_xlsx                          <- streams .xlsx
        - broadcast_serial_update              <- doc_event hook target
      report/item_master_report_s/             <- Item Master Report S
      page/inventory_workstation/              <- Inventory Workstation
    patches/v0_0_1/
      rename_module_to_munzer_oras_app.py      <- one-time rename patch
```

API surface (whitelisted):
- `munzer_app.munzer_oras_app.api.list_serials`
- `munzer_app.munzer_oras_app.api.export_xlsx`
- `munzer_app.munzer_oras_app.api.bulk_change_status`
- (others above)

localStorage keys (all per-browser):
- `munzer_iw_columns_v2` — column visibility map
- `munzer_iw_col_order_v1` — column order array
- `munzer_iw_col_widths_v1` — column widths map

Realtime channel: `munzer_inventory_update`

---

## 9. Recent commit timeline

```
6b04e08  Rename app: Munzer App -> Munzer Oras App (display + module)
fccb943  Add Excel-style column resize: drag header edge, dbl-click to auto-fit
ed00344  Add drag-and-drop column reordering in Columns dialog
cc4d69f  Footer stats: Total Items, Total MRP, Total Cost only
3662f22  Style filter popover + column manager buttons in Amazon look
a070209  Status filter defaults to all + Delivered/Consumed both render red
829c274  Fix scanner Enter handling on Scan/Search Serials
6b95b60  Add per-row View on Amazon action, frozen on the right
a499681  Lock status column: render as read-only pill, no inline edit
1973b95  (column manager dialog)
b82f8c6  Fix Inventory Workstation render: replace missing frappe.utils.format_*
e40e3d3  Redesign Inventory Workstation: Amazon Seller Central style
0744629  Add Inventory Workstation page (initial dark navy version, since pivoted)
477484a  Convert to standalone Frappe app: munzer_app
cc745e6  Add Item Master Report S — scanner-first inventory query report
```

---

## 10. If you're stuck

- Ask the user for the live URL's commit hash (visible on the Apps tab)
- Ask for browser console output before touching code
- Don't rename the Python package — Path C in the rename discussion was deemed too risky
- Don't merge the Item Master Report S into the workstation — they serve different users
- Don't add Tailwind / shadcn / Vue without an explicit ask — the user accepted hand-rolled CSS and JS for everything so far

Good luck.
