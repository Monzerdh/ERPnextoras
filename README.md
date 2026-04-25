# ORAS — ERPNext custom assets

This repo holds files that drop into the existing **`oras`** Frappe app on the bench.
The directory layout mirrors what lives inside `apps/oras/` so you can copy it across or
pull it directly on the server.

## Contents

```
oras/
  oras/
    report/
      item_master_report_s/        # New: Item Master Report S
        __init__.py
        item_master_report_s.json
        item_master_report_s.py
        item_master_report_s.js
```

## Item Master Report S

A faster, scanner-first alternative to **Item Master Report**, with:

- ORAS brand styling (deep navy + red gradient, glassmorphism card)
- **Scan Mode** dialog — auto-focuses an input so warehouse barcode scanners can
  fire codes one after another. Supports Serial No, ASIN, Item Code, Tracking No,
  and Item Barcode child-table values. Codes accumulate as chips, then apply as a
  single OR filter.
- **Multi-select filters** for Item, Customer, Sales Invoice, Item Group (3
  levels), Grade, Batch, Tracking, Status, Pallet/Trolley, Shelf, Box.
- **Status badges** with color coding (Active green, Inactive grey, Consumed red,
  Delivered blue, Expired orange).
- **Stock Balance** colored green when positive, red when zero.
- **Column show/hide** popover — choices persist per browser via `localStorage`.
- **Quick CSV** export (client-side, instant) and **Excel/PDF** via the standard
  Frappe export dialog.
- **Pagination buttons** styled to match the rest of the UI.
- **Reset filters** button — restores defaults including `Status = Active`.

## Installation

On the ERPNext server, inside the bench:

```bash
cd ~/frappe-bench/apps/oras
git pull origin main
cd ~/frappe-bench
bench --site <your-site> migrate         # registers the new Report DocType
bench --site <your-site> clear-cache
bench build --app oras                   # picks up the new JS
```

After that the report is reachable at:

```
/app/query-report/Item%20Master%20Report%20S
```

If your local clone of this repo isn't the `oras` app itself, copy the
`oras/oras/report/item_master_report_s/` folder into your `apps/oras/oras/report/`
directory before running migrate.

## Notes on backwards compatibility

- The original `Item Master Report` is **untouched**. The new report sits alongside it.
- The Python executor is parameterized — no SQL injection risk from filter values.
- The new `scan_codes` filter is opt-in: empty value = no extra clause.
- Roles match the original report (Item Manager, Stock Manager, Stock User, Sales User,
  Purchase User, Maintenance User, Accounts User, Manufacturing User, Desk User).
