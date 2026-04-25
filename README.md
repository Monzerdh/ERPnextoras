# Munzer App

Standalone Frappe app for ORAS, shipping two ERPNext-grade tools:

1. **Item Master Report S** — scanner-first query report with multi-barcode
   scanning, column show/hide, instant CSV, ORAS-branded UI.
2. **Inventory Workstation** — Amazon-style operational page for warehouse
   staff: split-view (list ↔ detail), always-focused scanner, bulk
   status/location actions, realtime updates between users, ledger preview.

> **Repo URL**: https://github.com/Monzerdh/ERPnextoras
> **App name**: `munzer_app` &nbsp;·&nbsp; **Module**: `Munzer App` &nbsp;·&nbsp; **Requires**: ERPNext

## Layout

```
munzer_app/                         <- python package (top-level)
  __init__.py                       <- __version__
  hooks.py                          <- doc_events for realtime
  modules.txt                       <- "Munzer App"
  patches.txt
  config/
    __init__.py
    desktop.py
  munzer_app/                       <- module folder
    __init__.py
    api.py                          <- whitelisted endpoints (workstation)
    report/
      __init__.py
      item_master_report_s/
        __init__.py
        item_master_report_s.json
        item_master_report_s.py
        item_master_report_s.js
    page/
      __init__.py
      inventory_workstation/
        __init__.py
        inventory_workstation.json
        inventory_workstation.js
pyproject.toml / setup.py / requirements.txt / MANIFEST.in / license.txt
```

## Item Master Report S

Tabular query report for analysts.

- ORAS palette (deep navy + red `#E8173A`, glassmorphism filter card)
- 📷 **Scan Mode** dialog: auto-focused input, accumulates scans as red chips,
  ORs across `Serial No`, `Item Code`, `ASIN`, `Tracking No`, and the
  `Item Barcode` child table on Item.
- 👁 **Columns** popover with Show-all / Hide-all, persisted in `localStorage`.
- ⬇ **Quick CSV** (instant, client-side) + 📊 **Excel/PDF** via Frappe's export.
- ↺ **Reset** restores defaults (incl. `Status = Active`).
- Status pill-badges, green/red stock-balance, ASIN as Amazon link.

URL: `/app/query-report/Item%20Master%20Report%20S`

## Inventory Workstation

Operational workstation for warehouse staff.

- **Always-focused scanner** at the top — scan a serial / ASIN / tracking /
  item barcode / item code; in single mode it jumps to that serial's detail,
  in **bulk mode** it adds to the selection.
- **Status quick-tabs** (All / Active / Inactive / Consumed / Delivered /
  Expired) with live facet counts.
- **Filter chips** — opens a multi-field dialog (Item, Grade, Batch, Customer,
  Pallet/Trolley, Shelf, Box, Shelf Kind). Clear chips one at a time.
- **Split view** — left list (infinite scroll, 100 per page) ↔ right detail
  panel showing item info, location, batch, tracking, ASIN, customer,
  invoices, recent stock-ledger entries, and item barcodes.
- **Inline actions** — Update status, Move To… (shelf kind / location / box),
  Print Label.
- **Bulk actions** — when items are selected, a bottom bar appears with
  Change Status, Move To… and Print Labels for the whole selection.
- **Realtime** — Frappe `doc_events` on Serial No emits `munzer_inventory_update`
  events; every open workstation updates its visible row immediately.
- **Export visible** — instant client-side CSV of the current page.

URL: `/app/inventory-workstation`

Roles allowed: Stock User, Stock Manager, Item Manager, Maintenance User.

## Install on Frappe Cloud (`orasbeta.k.frappe.cloud`)

This site is hosted on Frappe Cloud, so deploy via dashboard:

1. **cloud.frappe.io** → your bench → **Apps → Add App → From GitHub**.
2. If private: install the Frappe Cloud GitHub App first and grant access to
   `Monzerdh/ERPnextoras`.
3. Paste `https://github.com/Monzerdh/ERPnextoras`, branch `main`, click **Add**.
4. Wait for the build candidate → **Deploy**.
5. **Sites → orasbeta → Apps → Install App** → pick `munzer_app`.

## Install on a self-hosted bench

```bash
cd ~/frappe-bench
bench get-app https://github.com/Monzerdh/ERPnextoras --branch main
bench --site <your-site> install-app munzer_app
bench --site <your-site> migrate
bench build --app munzer_app
```

## Uninstall

```bash
bench --site <your-site> uninstall-app munzer_app
bench remove-app munzer_app
```

## Notes

- The original `Item Master Report` (in the `oras` app on your bench) is
  untouched. The new report sits alongside it.
- Python is parameterized — no SQL injection from filter values.
- `doc_events` only fire on sites that have `munzer_app` installed; other
  sites in the same bench are unaffected.
- The realtime channel is `munzer_inventory_update` and emits after commit.
