// Item Master Report S — Oras
// Smooth, scanner-first inventory query report with ORAS-branded UI.

(() => {
	"use strict";

	const REPORT_NAME = "Item Master Report S";
	const STORAGE_KEYS = {
		hiddenCols: "oras_imrs_hidden_cols",
		scanChips: "oras_imrs_scan_chips",
	};

	const STATUS_COLORS = {
		Active: "#22c55e",
		Inactive: "#94a3b8",
		Consumed: "#E8173A",
		Delivered: "#3b82f6",
		Expired: "#f59e0b",
	};

	// ---------- Filters ----------
	const FILTERS = [
		{
			fieldname: "scan_codes",
			label: __("Scan Codes"),
			fieldtype: "Small Text",
			description: __("Paste or scan multiple barcodes / serials / ASINs / tracking numbers (one per line)."),
		},
		{
			fieldname: "item_code",
			label: __("Item Code"),
			fieldtype: "MultiSelectList",
			get_data: (txt) => frappe.db.get_link_options("Item", txt),
		},
		{
			fieldname: "serial_no",
			label: __("Serial Number"),
			fieldtype: "MultiSelectList",
			get_data: (txt) => frappe.db.get_link_options("Serial No", txt),
		},
		{
			fieldname: "customer",
			label: __("Customer"),
			fieldtype: "MultiSelectList",
			get_data: (txt) => frappe.db.get_link_options("Customer", txt),
		},
		{
			fieldname: "sales_invoice",
			label: __("Sales Invoice"),
			fieldtype: "MultiSelectList",
			get_data: (txt) => frappe.db.get_link_options("Sales Invoice", txt),
		},
		{
			fieldname: "sub_category",
			label: __("Sub Category"),
			fieldtype: "MultiSelectList",
			get_data: (txt) => frappe.db.get_link_options("Item Group", txt),
		},
		{
			fieldname: "category",
			label: __("Category"),
			fieldtype: "MultiSelectList",
			get_data: (txt) => frappe.db.get_link_options("Item Group", txt),
		},
		{
			fieldname: "super_category",
			label: __("Super Category"),
			fieldtype: "MultiSelectList",
			get_data: (txt) => frappe.db.get_link_options("Item Group", txt),
		},
		{
			fieldname: "item_name",
			label: __("Item Name"),
			fieldtype: "Data",
		},
		{
			fieldname: "asin",
			label: __("ASIN"),
			fieldtype: "Data",
		},
		{
			fieldname: "item_with_grade",
			label: __("Item With Grade"),
			fieldtype: "Data",
		},
		{
			fieldname: "grade",
			label: __("Grade"),
			fieldtype: "MultiSelectList",
			get_data: (txt) => frappe.db.get_link_options("Grade", txt),
		},
		{
			fieldname: "batch",
			label: __("Batch"),
			fieldtype: "MultiSelectList",
			get_data: (txt) => frappe.db.get_link_options("Batch Number", txt),
		},
		{
			fieldname: "tracking_number",
			label: __("Tracking Number"),
			fieldtype: "MultiSelectList",
			get_data: (txt) => frappe.db.get_link_options("Tracking No", txt),
		},
		{
			fieldname: "status",
			label: __("SN Status"),
			fieldtype: "MultiSelectList",
			get_data: () => [
				{ value: "Active", description: "" },
				{ value: "Inactive", description: "" },
				{ value: "Consumed", description: "" },
				{ value: "Delivered", description: "" },
				{ value: "Expired", description: "" },
			],
		},
		{
			fieldname: "shelf",
			label: __("Trolly/Shelf"),
			fieldtype: "Select",
			options: "\nPallet or Trolley\nShelf",
		},
		{
			fieldname: "trolly_pallet",
			label: __("Pallet or Trolly"),
			fieldtype: "MultiSelectList",
			get_data: (txt) => frappe.db.get_link_options("Pallet or Trolley", txt),
			on_change: () => {
				frappe.query_report.set_filter_value("shelf_name", []);
				frappe.query_report.refresh();
			},
		},
		{
			fieldname: "shelf_name",
			label: __("Shelf"),
			fieldtype: "MultiSelectList",
			get_data: (txt) => frappe.db.get_link_options("Shelf", txt),
			on_change: () => {
				frappe.query_report.set_filter_value("trolly_pallet", []);
				frappe.query_report.refresh();
			},
		},
		{
			fieldname: "box",
			label: __("Box"),
			fieldtype: "MultiSelectList",
			get_data: (txt) => frappe.db.get_link_options("Box", txt),
		},
		{
			fieldname: "page_number",
			label: __("Page Number"),
			fieldtype: "Int",
			default: 1,
			reqd: 1,
		},
		{
			fieldname: "page_size",
			label: __("Page Size"),
			fieldtype: "Int",
			default: 10000,
			reqd: 1,
		},
		{
			fieldname: "enable_pagination",
			label: __("Enable Pagination"),
			fieldtype: "Check",
		},
	];

	// ---------- Formatter ----------
	function formatter(value, row, column, data, default_formatter) {
		const original = default_formatter(value, row, column, data);
		if (!data || !column) return original;

		if (column.fieldname === "status" && data.status) {
			const c = STATUS_COLORS[data.status] || "#64748b";
			return `<span class="oras-badge" style="--bg:${c}">${frappe.utils.escape_html(data.status)}</span>`;
		}

		if (column.fieldname === "asin" && data.asin) {
			const a = frappe.utils.escape_html(data.asin);
			return `<a class="oras-link" href="https://www.amazon.ae/dp/${a}" target="_blank" rel="noopener">${a} <span class="oras-link-arrow">↗</span></a>`;
		}

		if (column.fieldname === "stock_blc") {
			const n = parseFloat(data.stock_blc) || 0;
			const cls = n > 0 ? "oras-stock-pos" : "oras-stock-zero";
			return `<span class="${cls}">${n}</span>`;
		}

		if (column.fieldname === "grade" && data.grade) {
			return `<span class="oras-grade">${frappe.utils.escape_html(data.grade)}</span>`;
		}

		return original;
	}

	// ---------- Styles ----------
	const STYLES = `
		body.oras-imrs .layout-main-section {
			background: linear-gradient(180deg, #0f1146 0%, #14176b 100%);
			color: #f3f4ff;
			border-radius: 14px;
			border: 1px solid rgba(232,23,58,0.18);
			padding: 14px;
			box-shadow: 0 12px 40px rgba(15,17,70,0.35);
		}
		body.oras-imrs .page-form, body.oras-imrs .report-filters {
			background: rgba(15,17,70,0.55);
			border: 1px solid rgba(232,23,58,0.25);
			border-radius: 12px;
			padding: 10px 12px;
			margin-bottom: 12px;
			backdrop-filter: blur(6px);
		}
		body.oras-imrs .page-form .form-group label,
		body.oras-imrs .report-filters .form-group label {
			color: rgba(255,255,255,0.78) !important;
			font-weight: 500;
			letter-spacing: 0.2px;
		}
		body.oras-imrs .page-form .form-control,
		body.oras-imrs .report-filters .form-control,
		body.oras-imrs .page-form .awesomplete > input,
		body.oras-imrs .page-form .form-control[disabled] {
			background: rgba(255,255,255,0.06) !important;
			color: #fff !important;
			border: 1px solid rgba(232,23,58,0.35) !important;
			border-radius: 8px !important;
			transition: border-color 0.15s ease, box-shadow 0.15s ease;
		}
		body.oras-imrs .page-form .form-control:focus,
		body.oras-imrs .page-form input:focus {
			border-color: #E8173A !important;
			box-shadow: 0 0 0 3px rgba(232,23,58,0.18) !important;
			outline: none !important;
		}
		body.oras-imrs .frappe-control[data-fieldtype="MultiSelectList"] .form-tagsinput {
			background: rgba(255,255,255,0.06);
			border: 1px solid rgba(232,23,58,0.35);
			border-radius: 8px;
		}
		body.oras-imrs .frappe-control[data-fieldtype="MultiSelectList"] .tagit-choice {
			background: linear-gradient(135deg,#E8173A,#b3102b);
			color: #fff;
			border: none;
			border-radius: 6px;
			padding: 2px 8px;
			margin: 2px;
		}
		body.oras-imrs .frappe-control[data-fieldtype="MultiSelectList"] .tagit-choice .tagit-close {
			color: rgba(255,255,255,0.85);
		}
		body.oras-imrs .dt-scrollable {
			border-radius: 10px;
			border: 1px solid rgba(232,23,58,0.18);
			background: rgba(15,17,70,0.4);
		}
		body.oras-imrs .dt-header, body.oras-imrs .dt-row-header {
			background: linear-gradient(180deg,#1a1c6e,#15175a) !important;
			color: #fff !important;
		}
		body.oras-imrs .dt-header .dt-cell,
		body.oras-imrs .dt-row-header .dt-cell {
			background: transparent !important;
			color: #fff !important;
			border-color: rgba(232,23,58,0.18) !important;
			font-weight: 600;
		}
		body.oras-imrs .dt-row {
			background: rgba(255,255,255,0.02) !important;
		}
		body.oras-imrs .dt-row .dt-cell {
			background: transparent !important;
			color: #f3f4ff !important;
			border-color: rgba(255,255,255,0.06) !important;
		}
		body.oras-imrs .dt-row:hover .dt-cell {
			background: rgba(232,23,58,0.08) !important;
		}
		body.oras-imrs .dt-row .dt-cell a {
			color: #ffd9e1 !important;
			text-decoration: none;
		}
		body.oras-imrs .dt-row .dt-cell a:hover {
			color: #fff !important;
			text-decoration: underline;
		}
		body.oras-imrs .oras-badge {
			display: inline-block;
			padding: 3px 10px;
			border-radius: 999px;
			background: var(--bg, #64748b);
			color: #fff;
			font-size: 11px;
			font-weight: 700;
			letter-spacing: 0.4px;
			text-transform: uppercase;
			box-shadow: 0 2px 6px rgba(0,0,0,0.25);
		}
		body.oras-imrs .oras-stock-pos { color:#34d399; font-weight:600; }
		body.oras-imrs .oras-stock-zero { color:#fb7185; font-weight:600; }
		body.oras-imrs .oras-grade {
			display:inline-block;
			padding:1px 8px;
			border-radius:6px;
			background:rgba(232,23,58,0.18);
			color:#ffd1da;
			font-weight:600;
			font-size:11px;
		}
		body.oras-imrs .oras-link {
			color:#ffd9e1 !important;
			text-decoration:none;
			border-bottom:1px dashed rgba(255,217,225,0.5);
		}
		body.oras-imrs .oras-link-arrow { font-size:0.85em; opacity:0.8; }

		/* Toolbar */
		.oras-toolbar {
			display:flex;
			gap:8px;
			flex-wrap:wrap;
			align-items:center;
			margin: 10px 0 6px;
		}
		.oras-toolbar .oras-btn {
			display:inline-flex;
			align-items:center;
			gap:6px;
			padding:7px 14px;
			border-radius:8px;
			font-size:13px;
			font-weight:600;
			border:1px solid rgba(232,23,58,0.45);
			background:rgba(255,255,255,0.06);
			color:#fff;
			cursor:pointer;
			transition:all 0.15s ease;
		}
		.oras-toolbar .oras-btn:hover {
			background:rgba(232,23,58,0.18);
			border-color:#E8173A;
			transform:translateY(-1px);
		}
		.oras-toolbar .oras-btn.primary {
			background:linear-gradient(135deg,#E8173A 0%,#b3102b 100%);
			border-color:transparent;
			box-shadow:0 6px 16px rgba(232,23,58,0.35);
		}
		.oras-toolbar .oras-btn.primary:hover {
			background:linear-gradient(135deg,#ff1f47 0%,#c7132f 100%);
		}
		.oras-toolbar .oras-divider {
			width:1px;
			height:22px;
			background:rgba(255,255,255,0.15);
			margin:0 4px;
		}
		.oras-toolbar .oras-summary {
			margin-left:auto;
			color:rgba(255,255,255,0.75);
			font-size:13px;
		}
		.oras-toolbar .oras-summary b { color:#fff; }

		/* Column popover */
		.oras-col-popover {
			position:absolute;
			z-index:1050;
			background:#15175a;
			border:1px solid rgba(232,23,58,0.4);
			border-radius:10px;
			padding:10px;
			box-shadow:0 12px 32px rgba(0,0,0,0.45);
			max-height:60vh;
			overflow-y:auto;
			min-width:240px;
			color:#fff;
		}
		.oras-col-popover .oras-col-row {
			display:flex;
			align-items:center;
			gap:8px;
			padding:5px 4px;
			border-radius:6px;
			cursor:pointer;
			user-select:none;
		}
		.oras-col-popover .oras-col-row:hover { background:rgba(232,23,58,0.15); }
		.oras-col-popover input[type=checkbox] { accent-color:#E8173A; }
		.oras-col-popover .oras-col-actions {
			display:flex;
			justify-content:space-between;
			gap:6px;
			padding-top:8px;
			border-top:1px solid rgba(255,255,255,0.1);
			margin-top:6px;
		}
		.oras-col-popover .oras-col-actions a {
			color:#ffd9e1;
			font-size:12px;
			cursor:pointer;
		}

		/* Scanner dialog */
		.oras-scan-input {
			width:100%;
			padding:14px 16px;
			border-radius:10px;
			border:2px dashed rgba(232,23,58,0.55);
			background:rgba(15,17,70,0.85);
			color:#fff;
			font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
			font-size:15px;
			letter-spacing:1px;
		}
		.oras-scan-input::placeholder { color:rgba(255,255,255,0.45); }
		.oras-scan-input:focus { outline:none; border-color:#E8173A; box-shadow:0 0 0 4px rgba(232,23,58,0.18); }
		.oras-scan-hint {
			margin-top:6px;
			font-size:12px;
			color:rgba(255,255,255,0.65);
		}
		.oras-scan-chips {
			margin-top:14px;
			display:flex;
			flex-wrap:wrap;
			gap:6px;
			min-height:40px;
			max-height:220px;
			overflow-y:auto;
			padding:8px;
			background:rgba(255,255,255,0.04);
			border-radius:8px;
			border:1px solid rgba(232,23,58,0.2);
		}
		.oras-scan-chip {
			display:inline-flex;
			align-items:center;
			gap:6px;
			padding:4px 10px;
			border-radius:999px;
			background:linear-gradient(135deg,#E8173A,#b3102b);
			color:#fff;
			font-size:12px;
			font-weight:600;
		}
		.oras-scan-chip .x {
			cursor:pointer;
			opacity:0.8;
			padding:0 2px;
			border-radius:50%;
		}
		.oras-scan-chip .x:hover { opacity:1; background:rgba(0,0,0,0.2); }
		.oras-scan-empty { color:rgba(255,255,255,0.45); font-size:12px; padding:6px; }
		.oras-scan-meta {
			display:flex;
			justify-content:space-between;
			margin-top:8px;
			font-size:12px;
			color:rgba(255,255,255,0.7);
		}

		/* Frappe dialog dark backdrop tweak when scanner open */
		.oras-imrs-scan-dialog .modal-content {
			background:#0f1146;
			color:#fff;
			border:1px solid rgba(232,23,58,0.35);
		}
		.oras-imrs-scan-dialog .modal-header,
		.oras-imrs-scan-dialog .modal-footer {
			border-color:rgba(255,255,255,0.1);
		}
		.oras-imrs-scan-dialog .modal-title { color:#fff; }
	`;

	function injectStyles() {
		if (document.getElementById("oras-imrs-styles")) return;
		const style = document.createElement("style");
		style.id = "oras-imrs-styles";
		style.textContent = STYLES;
		document.head.appendChild(style);
	}

	function activateBodyClass() {
		document.body.classList.add("oras-imrs");
		if (frappe.router && !frappe.router._oras_imrs_hooked) {
			frappe.router._oras_imrs_hooked = true;
			frappe.router.on("change", () => {
				const route = frappe.get_route() || [];
				const active = route[0] === "query-report" && route[1] === REPORT_NAME;
				document.body.classList.toggle("oras-imrs", active);
			});
		}
	}

	// ---------- Toolbar ----------
	function buildToolbar(report) {
		const $page = report.page && report.page.main;
		if (!$page || $page.find(".oras-toolbar").length) return;

		const $bar = $(`
			<div class="oras-toolbar">
				<button class="oras-btn primary" data-act="scan">📷 ${__("Scan Mode")}</button>
				<button class="oras-btn" data-act="cols">👁 ${__("Columns")}</button>
				<div class="oras-divider"></div>
				<button class="oras-btn" data-act="csv">⬇ CSV</button>
				<button class="oras-btn" data-act="export">📊 ${__("Export")}</button>
				<button class="oras-btn" data-act="reset">↺ ${__("Reset")}</button>
				<div class="oras-summary"></div>
			</div>
		`);

		const $filterArea = $page.find(".page-form, .report-filters").first();
		if ($filterArea.length) $filterArea.after($bar);
		else $page.prepend($bar);

		$bar.on("click", "[data-act]", (e) => {
			const act = e.currentTarget.dataset.act;
			if (act === "scan") openScanner(report);
			else if (act === "cols") openColumnPopover(report, e.currentTarget);
			else if (act === "csv") downloadCSV(report);
			else if (act === "export") frappe.query_report.export_report();
			else if (act === "reset") resetFilters(report);
		});

		updateSummary(report);
	}

	function updateSummary(report) {
		const $s = $(".oras-toolbar .oras-summary");
		if (!$s.length) return;
		const total = (report.data || []).length;
		const stock = (report.data || []).reduce((a, r) => a + (parseFloat(r.stock_blc) || 0), 0);
		$s.html(`<b>${total}</b> ${__("rows")} &middot; ${__("Stock")}: <b>${stock}</b>`);
	}

	// ---------- Scanner ----------
	function loadScanChips() {
		try {
			return JSON.parse(localStorage.getItem(STORAGE_KEYS.scanChips) || "[]");
		} catch (e) {
			return [];
		}
	}
	function saveScanChips(chips) {
		localStorage.setItem(STORAGE_KEYS.scanChips, JSON.stringify(chips));
	}

	function openScanner(report) {
		let chips = loadScanChips();

		const dialog = new frappe.ui.Dialog({
			title: __("Multi-Barcode Scan"),
			size: "large",
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "html",
					options: `
						<input type="text" class="oras-scan-input" id="oras-scan-input"
							placeholder="${__("Focus here and start scanning… one barcode per scan")}"
							autocomplete="off" autofocus />
						<div class="oras-scan-hint">
							${__("Each scan auto-adds. Press Enter to add manually. Supports Serial No, ASIN, Item Code, Tracking No, Item Barcode.")}
						</div>
						<div class="oras-scan-chips" id="oras-scan-chips"></div>
						<div class="oras-scan-meta">
							<span id="oras-scan-count">0 ${__("codes")}</span>
							<span>
								<a href="#" id="oras-scan-clear" style="color:#fb7185;">${__("Clear all")}</a>
							</span>
						</div>
					`,
				},
			],
			primary_action_label: __("Apply Filter"),
			primary_action: () => {
				const value = chips.join("\n");
				frappe.query_report.set_filter_value("scan_codes", value);
				saveScanChips(chips);
				dialog.hide();
				frappe.query_report.refresh();
			},
			secondary_action_label: __("Close"),
		});

		dialog.$wrapper.addClass("oras-imrs-scan-dialog");
		dialog.show();

		const $chips = dialog.$wrapper.find("#oras-scan-chips");
		const $input = dialog.$wrapper.find("#oras-scan-input");
		const $count = dialog.$wrapper.find("#oras-scan-count");
		const $clear = dialog.$wrapper.find("#oras-scan-clear");

		function render() {
			if (!chips.length) {
				$chips.html(`<div class="oras-scan-empty">${__("No codes yet. Start scanning…")}</div>`);
			} else {
				$chips.html(
					chips
						.map(
							(c, i) =>
								`<span class="oras-scan-chip">${frappe.utils.escape_html(c)}<span class="x" data-i="${i}">✕</span></span>`,
						)
						.join(""),
				);
			}
			$count.text(`${chips.length} ${__("codes")}`);
		}

		function addCode(raw) {
			const tokens = (raw || "")
				.split(/[\n\r,\t]+/)
				.map((s) => s.trim())
				.filter(Boolean);
			let added = 0;
			for (const t of tokens) {
				if (!chips.includes(t)) {
					chips.push(t);
					added++;
				}
			}
			if (added) render();
		}

		// scanner heuristic: detect very fast keypress ending in Enter
		let buffer = "";
		let lastTime = 0;
		$input.on("keydown", (e) => {
			const now = Date.now();
			const dt = now - lastTime;
			lastTime = now;
			if (e.key === "Enter") {
				e.preventDefault();
				const v = $input.val().trim();
				if (v) {
					addCode(v);
					$input.val("");
				}
				buffer = "";
				return;
			}
			// fast keypresses ( <30ms apart ) suggest scanner
			if (e.key && e.key.length === 1 && dt < 30) {
				buffer += e.key;
			} else {
				buffer = e.key && e.key.length === 1 ? e.key : "";
			}
		});

		$input.on("paste", (e) => {
			const txt = (e.originalEvent.clipboardData || window.clipboardData).getData("text");
			if (txt) {
				e.preventDefault();
				addCode(txt);
				$input.val("");
			}
		});

		$chips.on("click", ".x", (e) => {
			const i = parseInt(e.currentTarget.dataset.i, 10);
			chips.splice(i, 1);
			render();
		});

		$clear.on("click", (e) => {
			e.preventDefault();
			chips = [];
			render();
		});

		// preload existing scan_codes filter
		const existing = frappe.query_report.get_filter_value("scan_codes");
		if (existing) {
			addCode(existing);
		}

		render();
		setTimeout(() => $input.trigger("focus"), 50);
	}

	// ---------- Column visibility ----------
	function getHiddenCols() {
		try {
			return new Set(JSON.parse(localStorage.getItem(STORAGE_KEYS.hiddenCols) || "[]"));
		} catch (e) {
			return new Set();
		}
	}
	function saveHiddenCols(set) {
		localStorage.setItem(STORAGE_KEYS.hiddenCols, JSON.stringify([...set]));
	}

	function applyColumnVisibility(report) {
		const hidden = getHiddenCols();
		(report.columns || []).forEach((col) => {
			col.hidden = hidden.has(col.fieldname);
		});
		if (report.datatable) {
			try {
				report.refresh_report_render
					? report.refresh_report_render()
					: report.datatable.refresh(report.data, report.columns);
			} catch (e) {
				// silent — DataTable may not be ready
			}
		}
	}

	function openColumnPopover(report, anchor) {
		$(".oras-col-popover").remove();
		const hidden = getHiddenCols();
		const cols = report.columns || [];
		const $pop = $(`<div class="oras-col-popover"></div>`);
		cols.forEach((col) => {
			const checked = !hidden.has(col.fieldname);
			$pop.append(`
				<label class="oras-col-row">
					<input type="checkbox" data-fn="${col.fieldname}" ${checked ? "checked" : ""} />
					<span>${frappe.utils.escape_html(col.label || col.fieldname)}</span>
				</label>
			`);
		});
		$pop.append(`
			<div class="oras-col-actions">
				<a data-act="all">${__("Show all")}</a>
				<a data-act="none">${__("Hide all")}</a>
			</div>
		`);
		document.body.appendChild($pop[0]);

		const r = anchor.getBoundingClientRect();
		$pop.css({
			top: r.bottom + window.scrollY + 6 + "px",
			left: r.left + window.scrollX + "px",
		});

		$pop.on("change", "input[type=checkbox]", (e) => {
			const fn = e.currentTarget.dataset.fn;
			const set = getHiddenCols();
			if (e.currentTarget.checked) set.delete(fn);
			else set.add(fn);
			saveHiddenCols(set);
			applyColumnVisibility(report);
		});

		$pop.on("click", "[data-act]", (e) => {
			const act = e.currentTarget.dataset.act;
			const set = new Set();
			if (act === "none") cols.forEach((c) => set.add(c.fieldname));
			saveHiddenCols(set);
			$pop.find("input[type=checkbox]").each((_, el) => {
				el.checked = !set.has(el.dataset.fn);
			});
			applyColumnVisibility(report);
		});

		setTimeout(() => {
			$(document).one("click.oras-col-pop", (e) => {
				if (!$(e.target).closest(".oras-col-popover").length && e.target !== anchor) {
					$pop.remove();
				}
			});
		}, 0);
	}

	// ---------- Quick CSV ----------
	function downloadCSV(report) {
		const cols = (report.columns || []).filter((c) => !c.hidden);
		const rows = report.data || [];
		const escape = (v) => {
			if (v === null || v === undefined) return "";
			const s = String(v).replace(/"/g, '""');
			return /[",\n]/.test(s) ? `"${s}"` : s;
		};
		const header = cols.map((c) => escape(c.label || c.fieldname)).join(",");
		const body = rows.map((r) => cols.map((c) => escape(r[c.fieldname])).join(",")).join("\n");
		const blob = new Blob(["\uFEFF" + header + "\n" + body], { type: "text/csv;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		const ts = frappe.datetime.now_datetime().replace(/[: ]/g, "-");
		const a = document.createElement("a");
		a.href = url;
		a.download = `Item-Master-Report-S_${ts}.csv`;
		document.body.appendChild(a);
		a.click();
		setTimeout(() => {
			URL.revokeObjectURL(url);
			a.remove();
		}, 100);
	}

	// ---------- Reset ----------
	function resetFilters(report) {
		(report.filters || []).forEach((f) => {
			if (f.df.fieldname === "page_number") f.set_value(1);
			else if (f.df.fieldname === "page_size") f.set_value(10000);
			else if (f.df.fieldname === "status") f.set_value(["Active"]);
			else if (f.df.fieldtype === "Check") f.set_value(0);
			else if (f.df.fieldtype === "MultiSelectList") f.set_value([]);
			else f.set_value("");
		});
		localStorage.removeItem(STORAGE_KEYS.scanChips);
		report.refresh();
	}

	// ---------- Pagination ----------
	function addPaginationButtons(report) {
		setTimeout(() => {
			const $page = report.page && report.page.main;
			if (!$page || $page.find(".oras-pager").length) return;

			const $pager = $(`
				<div class="oras-toolbar oras-pager" style="justify-content:center;margin-top:10px;">
					<button class="oras-btn" data-pg="prev">⟵ ${__("Prev")}</button>
					<span class="oras-summary" style="margin:0;color:rgba(255,255,255,0.85);">
						${__("Page")} <b id="oras-pg-num">1</b>
					</span>
					<button class="oras-btn primary" data-pg="next">${__("Next")} ⟶</button>
				</div>
			`);
			$page.find(".dt-scrollable").after($pager);

			$pager.on("click", "[data-pg]", (e) => {
				const dir = e.currentTarget.dataset.pg;
				let page = parseInt(frappe.query_report.get_filter_value("page_number") || 1, 10);
				if (dir === "prev" && page > 1) page--;
				if (dir === "next") page++;
				frappe.query_report.set_filter_value("page_number", page);
				$("#oras-pg-num").text(page);
				frappe.query_report.refresh();
			});
		}, 600);
	}

	// ---------- Entry ----------
	frappe.query_reports[REPORT_NAME] = {
		filters: FILTERS,
		formatter,

		onload: function (report) {
			injectStyles();
			activateBodyClass();
			frappe.query_report.set_filter_value("status", ["Active"]);
			buildToolbar(report);
			addPaginationButtons(report);

			// Re-apply column hide-state and refresh summary after each render
			const origRefresh = report.refresh_report_render && report.refresh_report_render.bind(report);
			if (origRefresh) {
				report.refresh_report_render = function () {
					const r = origRefresh();
					applyColumnVisibility(report);
					updateSummary(report);
					return r;
				};
			}
		},

		after_datatable_render: function (datatable_obj) {
			const report = frappe.query_report;
			applyColumnVisibility(report);
			updateSummary(report);
		},
	};
})();
