# Munzer App

Standalone Frappe app that ships **Item Master Report S** — a faster,
scanner-first inventory query report for ORAS, with multi-barcode scanning,
column show/hide, instant CSV export, status badges and an ORAS-branded UI.

> **Repo URL**: https://github.com/Monzerdh/ERPnextoras
> **App name**: `munzer_app` &nbsp;·&nbsp; **Module**: `Munzer App` &nbsp;·&nbsp; **Requires**: ERPNext

## Layout

```
munzer_app/                         <- python package (top-level)
  __init__.py                       <- __version__
  hooks.py
  modules.txt                       <- "Munzer App"
  patches.txt
  config/
    __init__.py
    desktop.py                      <- workspace card
  munzer_app/                       <- module folder (slug of "Munzer App")
    __init__.py
    report/
      __init__.py
      item_master_report_s/
        __init__.py
        item_master_report_s.json
        item_master_report_s.py
        item_master_report_s.js
pyproject.toml
setup.py
requirements.txt
MANIFEST.in
license.txt
```

## What the report does

- ORAS palette (deep navy + red `#E8173A`, glassmorphism filter card)
- 📷 **Scan Mode** dialog: auto-focused input, accumulates scans as red chips,
  ORs across `Serial No`, `Item Code`, `ASIN`, `Tracking No`, and the
  `Item Barcode` child table on Item.
- 👁 **Columns** popover with Show-all / Hide-all, persisted in `localStorage`.
- ⬇ **Quick CSV** (instant, client-side) + 📊 **Excel/PDF** via Frappe's export.
- ↺ **Reset** restores defaults (incl. `Status = Active`).
- Status pill-badges (green/grey/red/blue/orange), green/red stock-balance,
  ASIN as Amazon link, grade pill.

## Install on Frappe Cloud (`orasbeta.k.frappe.cloud`)

This site is hosted on Frappe Cloud, so you can't `bench install-app` from a
shell — you wire the GitHub repo to the bench through the dashboard.

1. **Sign in** at https://frappecloud.com → open your bench (the one running
   `orasbeta`).
2. **Bench → Apps → Add App**. Pick **From GitHub**.
3. If the repo is private, click **Install GitHub App** first and grant
   `Monzerdh/ERPnextoras` access to the Frappe Cloud GitHub App.
4. Paste `https://github.com/Monzerdh/ERPnextoras`, branch `main`, click **Add**.
5. Frappe Cloud builds a new bench candidate. When it's green, click **Deploy**.
6. **Sites → orasbeta.k.frappe.cloud → Apps → Install App** → pick `munzer_app`.

Once installed, the report lives at:

```
https://orasbeta.k.frappe.cloud/app/query-report/Item%20Master%20Report%20S
```

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
  untouched. The new report sits alongside it, in its own module so the two
  never collide.
- Python is parameterized — no SQL injection from filter values.
- Roles match the original report (Item Manager, Stock Manager, Stock User,
  Sales User, Purchase User, Maintenance User, Accounts User, Manufacturing
  User, Desk User).
