/* eslint-disable no-undef */
/**
 * Inventory Workstation — Amazon Seller Central style.
 * White background, #FF9900 orange accents, sortable virtualized table,
 * sidebar with item-name search + multi-line serial scan, server-side
 * Excel export of all filtered rows.
 */

frappe.pages["inventory-workstation"].on_page_load = function (wrapper) {
	new InventoryWorkstation(wrapper);
};

// ---------- constants -------------------------------------------------------

const ROW_HEIGHT = 44; // px — keep in sync with .iw-tr CSS
const PAGE_SIZE = 500;
const ALL_STATUSES = ["Active", "Inactive", "Consumed", "Delivered", "Expired"];

// Small formatters — fmtNum / format_currency don't exist on
// every Frappe version, so we use vanilla Intl with sane defaults.
const fmtNum = (v) => Number(v || 0).toLocaleString("en-US");
const fmtMoney = (v) =>
	Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS_TONES = {
	Active: { bg: "#E1F0EC", fg: "#067D62", dot: "#067D62" },
	Inactive: { bg: "#EAEDED", fg: "#565959", dot: "#565959" },
	Consumed: { bg: "#FCE7E5", fg: "#B12704", dot: "#B12704" },
	Delivered: { bg: "#E0F0F2", fg: "#007185", dot: "#007185" },
	Expired: { bg: "#FFF3E0", fg: "#C7511F", dot: "#FF9900" },
};

// Master list of every column the page can show. `defaultVisible: false` means
// the user has to opt in via the Columns dialog. User choices are persisted in
// localStorage under STORAGE_VIS so refreshing keeps the same view.
const STORAGE_VIS = "munzer_iw_columns_v2";

const COLUMNS = [
	{ key: "serial_no",            label: "Serial No",       sortable: true, width: 170, align: "left",  mono: true, link: true,           defaultVisible: true },
	{ key: "item_code",            label: "Item Code",       sortable: true, width: 130, align: "left",  mono: true,                       defaultVisible: false },
	{ key: "item_name",            label: "Item Name",       sortable: true, width: 280, align: "left",                                    defaultVisible: true },
	{ key: "super_category",       label: "Super Category",  sortable: true, width: 150, align: "left",                                    defaultVisible: false },
	{ key: "category",             label: "Category",        sortable: true, width: 160, align: "left",                                    defaultVisible: true },
	{ key: "sub_category",         label: "Sub Category",    sortable: true, width: 150, align: "left",                                    defaultVisible: false },
	{ key: "grade",                label: "Grade",            sortable: true, width: 90,  align: "left",  pill: true,                       defaultVisible: true },
	{ key: "status",               label: "Status",           sortable: true, width: 130, align: "left",  statusPill: true,                 defaultVisible: true },
	{ key: "warehouse",            label: "Warehouse",        sortable: true, width: 130, align: "left",                                    defaultVisible: true },
	{ key: "location_name",        label: "Location",         sortable: true, width: 140, align: "left",                                    defaultVisible: false },
	{ key: "box",                  label: "Box",              sortable: true, width: 100, align: "left",                                    defaultVisible: false },
	{ key: "batch",                label: "Batch",            sortable: true, width: 130, align: "left",                                    defaultVisible: false },
	{ key: "customer",             label: "Customer",         sortable: true, width: 160, align: "left",  link: "customer",                 defaultVisible: false },
	{ key: "sales_invoice",        label: "Sales Invoice",    sortable: true, width: 150, align: "left",  link: "sales-invoice",            defaultVisible: false },
	{ key: "asin",                 label: "ASIN",             sortable: true, width: 140, align: "left",  amazon: true,                     defaultVisible: false },
	{ key: "tracking_number",      label: "Tracking",         sortable: true, width: 150, align: "left",                                    defaultVisible: false },
	{ key: "shipment_request_id",  label: "Shipment ID",      sortable: false,width: 150, align: "left",                                    defaultVisible: false },
	{ key: "condition",            label: "Condition",         sortable: false,width: 120, align: "left",                                    defaultVisible: false },
	{ key: "item_with_grade",      label: "Item w/ Grade",    sortable: false,width: 170, align: "left",                                    defaultVisible: false },
	{ key: "purchase_price",       label: "Purchase",          sortable: true, width: 110, align: "right", money: true,                      defaultVisible: true },
	{ key: "selling_price",        label: "Selling",           sortable: true, width: 110, align: "right", money: true,                      defaultVisible: true },
	{ key: "mrp",                  label: "MRP",               sortable: true, width: 110, align: "right", money: true,                      defaultVisible: false },
	{ key: "creation",             label: "Date Added",       sortable: true, width: 130, align: "left",  date: true,                       defaultVisible: true },
	{ key: "days_in_stock",        label: "Days in Stock",    sortable: true, width: 120, align: "right",                                   defaultVisible: true },
	{ key: "_amazon_action",       label: "",                 sortable: false,width: 150, align: "center", action: "amazon", sticky: "right", defaultVisible: true },
];

// All filters defined here. `kind` controls how the dropdown fetches options.
const FILTERS = [
	{ key: "status", label: "Status", kind: "static", options: ALL_STATUSES },
	{ key: "item_code", label: "Item Code", kind: "link", doctype: "Item" },
	{ key: "warehouse", label: "Warehouse", kind: "link", doctype: "Warehouse" },
	{ key: "super_category", label: "Super Category", kind: "link", doctype: "Item Group" },
	{ key: "category", label: "Category", kind: "link", doctype: "Item Group" },
	{ key: "sub_category", label: "Sub Category", kind: "link", doctype: "Item Group" },
	{ key: "grade", label: "Grade", kind: "link", doctype: "Grade" },
	{ key: "batch", label: "Batch", kind: "link", doctype: "Batch Number" },
	{ key: "customer", label: "Customer", kind: "link", doctype: "Customer" },
	{ key: "sales_invoice", label: "Sales Invoice", kind: "link", doctype: "Sales Invoice" },
	{ key: "tracking_number", label: "Tracking", kind: "link", doctype: "Tracking No" },
	{ key: "shelf", label: "Shelf Kind", kind: "static", options: ["Pallet or Trolley", "Shelf"] },
	{ key: "trolly_pallet", label: "Pallet/Trolley", kind: "link", doctype: "Pallet or Trolley" },
	{ key: "shelf_name", label: "Shelf", kind: "link", doctype: "Shelf" },
	{ key: "box", label: "Box", kind: "link", doctype: "Box" },
];

// =============================================================================
// Main class
// =============================================================================

class InventoryWorkstation {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.page = frappe.ui.make_app_page({
			parent: wrapper,
			title: __("Inventory Workstation"),
			single_column: true,
		});
		this.state = {
			filters: { status: ["Active"] },
			item_name_search: "",
			scan_serials: "",
			rowsByIndex: new Map(),
			total: 0,
			summary: null,
			selected: new Set(),
			selectedAllVisible: false,
			fetchedPages: new Set(),
			loadingPages: new Set(),
			sort_by: "creation",
			sort_dir: "desc",
			openDropdown: null,
			colVis: this.loadColVis(), // Map<string, bool> — explicit user choices
		};
		this.searchDebounce = null;
		this.scanDebounce = null;
		this.scrollRaf = null;
		this.realtimeHandler = null;
		this.init();
	}

	// ---------------------------------------------------------------- init
	init() {
		this.injectStyles();
		this.renderShell();
		this.bindGlobals();
		this.bindRealtime();
		this.refresh();
	}

	teardown() {
		if (this.realtimeHandler) frappe.realtime.off("munzer_inventory_update", this.realtimeHandler);
	}

	// ---------------------------------------------------------------- shell
	renderShell() {
		const $body = $(this.page.body).addClass("munzer-iw");
		$body.html(`
			<div class="iw-app">
				<div class="iw-filterbar" id="iw-filterbar"></div>
				<div class="iw-chiprow" id="iw-chiprow"></div>
				<div class="iw-main">
					<aside class="iw-sidebar">
						<div class="iw-side-section">
							<label class="iw-side-label">${__("Item Name Search")}</label>
							<div class="iw-input-wrap">
								<svg class="iw-input-icon" viewBox="0 0 24 24" width="14" height="14"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16ZM21 21l-4.3-4.3"/></svg>
								<input type="text" id="iw-item-name" class="iw-input" placeholder="${__("Search items…")}" autocomplete="off" />
								<button id="iw-item-name-clear" class="iw-input-clear" hidden>✕</button>
							</div>
							<div class="iw-side-meta" id="iw-item-name-meta">${__("Type to filter the table")}</div>
						</div>

						<div class="iw-side-section">
							<label class="iw-side-label">${__("Scan / Search Serials")}</label>
							<textarea id="iw-scan" class="iw-textarea"
								placeholder="${__("Paste or scan one serial per line…")}"
								rows="9" spellcheck="false" autocomplete="off"></textarea>
							<div class="iw-side-row">
								<button id="iw-scan-clear" class="iw-btn-link">${__("Clear")}</button>
								<span id="iw-scan-meta" class="iw-side-meta">0 ${__("codes")}</span>
							</div>
							<div class="iw-side-help">${__("Duplicates are auto-removed. Matches serial, ASIN, tracking, item code or item barcode.")}</div>
						</div>

						<div class="iw-side-section iw-side-foot">
							<button id="iw-reset" class="iw-btn-ghost iw-btn-block">${__("Reset all filters")}</button>
						</div>
					</aside>

					<section class="iw-table-pane">
						<div class="iw-toolbar">
							<div class="iw-toolbar-left" id="iw-toolbar-left">
								<span class="iw-count" id="iw-count">${__("Loading…")}</span>
							</div>
							<div class="iw-toolbar-right">
								<button id="iw-cols" class="iw-btn-ghost">${__("Columns")} ▾</button>
								<button id="iw-export" class="iw-btn-primary">⬇ ${__("Export to Excel")}</button>
							</div>
						</div>

						<div class="iw-table-scroll" id="iw-table-scroll">
							<div class="iw-table">
								<div class="iw-thead" id="iw-thead"></div>
								<div class="iw-tbody-wrap" id="iw-tbody-wrap">
									<div class="iw-tbody" id="iw-tbody"></div>
								</div>
							</div>
						</div>
					</section>
				</div>

				<footer class="iw-footer" id="iw-footer"></footer>
			</div>
		`);

		this.renderFilterBar();
		this.renderActiveChips();
		this.renderTableHeader();
		this.renderFooter();
	}

	// ---------------------------------------------------------------- filter bar
	renderFilterBar() {
		const $bar = $("#iw-filterbar", this.page.body);
		const html = FILTERS.map((f) => {
			const sel = this.state.filters[f.key] || [];
			const n = Array.isArray(sel) ? sel.length : sel ? 1 : 0;
			const active = n > 0;
			return `
				<button class="iw-filter ${active ? "active" : ""}" data-filter-key="${f.key}">
					<span>${f.label}</span>
					${n ? `<span class="iw-filter-count">${n}</span>` : ""}
					<svg width="10" height="10" viewBox="0 0 12 12"><path fill="currentColor" d="M3 4.5l3 3 3-3"/></svg>
				</button>
			`;
		}).join("");
		$bar.html(html);
	}

	// ---------------------------------------------------------------- active chips
	renderActiveChips() {
		const $row = $("#iw-chiprow", this.page.body);
		const f = this.state.filters;
		const chips = [];

		for (const def of FILTERS) {
			const v = f[def.key];
			if (Array.isArray(v) && v.length) {
				chips.push(
					`<span class="iw-chip">${def.label}: <b>${v.map((x) => frappe.utils.escape_html(String(x))).join(", ")}</b><span class="x" data-rm="${def.key}">✕</span></span>`,
				);
			} else if (v && !Array.isArray(v)) {
				chips.push(
					`<span class="iw-chip">${def.label}: <b>${frappe.utils.escape_html(String(v))}</b><span class="x" data-rm="${def.key}">✕</span></span>`,
				);
			}
		}
		if (this.state.item_name_search) {
			chips.push(
				`<span class="iw-chip">Name: <b>${frappe.utils.escape_html(this.state.item_name_search)}</b><span class="x" data-rm="__name">✕</span></span>`,
			);
		}
		if (this.state.scan_serials) {
			const n = this.state.scan_serials.split(/\n/).filter(Boolean).length;
			chips.push(
				`<span class="iw-chip iw-chip-scan">Scanned: <b>${n}</b><span class="x" data-rm="__scan">✕</span></span>`,
			);
		}

		const right = `
			<span class="iw-chiprow-right">
				<span id="iw-showing">—</span>
				${chips.length ? `<a href="#" id="iw-clear-all">${__("Clear all")}</a>` : ""}
			</span>
		`;

		const left = chips.length
			? chips.join("")
			: `<span class="iw-chip-empty">${__("No active filters")}</span>`;

		$row.html(`<div class="iw-chiprow-left">${left}</div>${right}`);
		this.updateCount();
	}

	// ---------------------------------------------------------------- table header
	renderTableHeader() {
		const $thead = $("#iw-thead", this.page.body);
		const cols = this.visibleColumns().map((c) => {
			const isSorted = this.state.sort_by === c.key;
			const arrow = isSorted ? (this.state.sort_dir === "asc" ? "▲" : "▼") : "";
			const stickyCls = c.sticky === "right" ? "iw-th-sticky-right" : "";
			const cls = `iw-th ${c.sortable ? "iw-th-sortable" : ""} ${isSorted ? "iw-th-sorted" : ""} iw-th-${c.align || "left"} ${stickyCls}`;
			return `
				<div class="${cls}" data-sort="${c.sortable ? c.key : ""}" style="width:${c.width}px">
					<span>${c.label}</span>
					<span class="iw-th-arrow">${arrow}</span>
				</div>
			`;
		}).join("");
		$thead.html(`
			<div class="iw-tr iw-tr-head">
				<div class="iw-th iw-th-check"><input type="checkbox" id="iw-select-all" /></div>
				${cols}
			</div>
		`);
	}

	// ---------------------------------------------------------------- footer
	renderFooter() {
		const $f = $("#iw-footer", this.page.body);
		const sel = this.state.selected.size;
		const s = this.state.summary || {};
		const total = s.total_items ?? 0;
		const tv = s.total_purchase_value ?? 0;
		const tsv = s.total_selling_value ?? 0;
		const avg = Math.round(s.avg_days_in_stock || 0);

		$f.html(`
			<div class="iw-foot-left">
				${sel > 0 ? `<span class="iw-foot-sel"><b>${sel}</b> ${__("selected")}</span>
				<button class="iw-btn-link" id="iw-export-selected">${__("Export Selected")}</button>
				<button class="iw-btn-link" id="iw-bulk-status">${__("Change Status")}</button>
				<button class="iw-btn-link" id="iw-deselect">${__("Deselect")}</button>` : ""}
			</div>
			<div class="iw-foot-right">
				<span class="iw-stat"><span class="iw-stat-k">${__("Total Items")}:</span><b>${fmtNum(total)}</b></span>
				<span class="iw-stat-sep">·</span>
				<span class="iw-stat"><span class="iw-stat-k">${__("Purchase Value")}:</span><b>AED ${fmtMoney(tv)}</b></span>
				<span class="iw-stat-sep">·</span>
				<span class="iw-stat"><span class="iw-stat-k">${__("Selling Value")}:</span><b>AED ${fmtMoney(tsv)}</b></span>
				<span class="iw-stat-sep">·</span>
				<span class="iw-stat"><span class="iw-stat-k">${__("Avg Days in Stock")}:</span><b>${avg}</b></span>
			</div>
		`);
	}

	updateCount() {
		const showing = this.state.rowsByIndex.size;
		const total = this.state.total;
		$("#iw-showing", this.page.body).text(`${__("Showing")} ${fmtNum(showing)} ${__("of")} ${fmtNum(total)} ${__("records")}`);
		$("#iw-count", this.page.body).text(`${fmtNum(showing)} / ${fmtNum(total)} ${__("rows")}`);
	}

	// ---------------------------------------------------------------- events
	bindGlobals() {
		const me = this;
		const $body = $(this.page.body);

		// Sidebar item name search (debounced — server-side LIKE)
		$body.on("input", "#iw-item-name", function () {
			const v = this.value;
			$("#iw-item-name-clear").attr("hidden", v ? null : true);
			clearTimeout(me.searchDebounce);
			me.searchDebounce = setTimeout(() => {
				me.state.item_name_search = v;
				me.renderActiveChips();
				me.refresh();
			}, 220);
		});
		$body.on("click", "#iw-item-name-clear", () => {
			$("#iw-item-name").val("").trigger("input").trigger("focus");
		});

		// Scan textarea (dedup + debounced refresh)
		$body.on("input", "#iw-scan", function () {
			const lines = this.value.split(/\r?\n/);
			const seen = new Set();
			const out = [];
			for (const line of lines) {
				const t = line.trim();
				if (!t) continue;
				if (seen.has(t)) continue; // drop duplicates
				seen.add(t);
				out.push(t);
			}
			const cleaned = out.join("\n");
			if (cleaned !== this.value) {
				const pos = this.selectionStart;
				this.value = cleaned;
				this.selectionStart = this.selectionEnd = Math.min(pos, cleaned.length);
			}
			$("#iw-scan-meta").text(`${out.length} ${__("codes")}`);
			clearTimeout(me.scanDebounce);
			me.scanDebounce = setTimeout(() => {
				me.state.scan_serials = cleaned;
				me.renderActiveChips();
				me.refresh();
			}, 220);
		});
		$body.on("click", "#iw-scan-clear", () => {
			$("#iw-scan").val("").trigger("input").trigger("focus");
		});

		// Reset
		$body.on("click", "#iw-reset", () => {
			this.state.filters = { status: ["Active"] };
			this.state.item_name_search = "";
			this.state.scan_serials = "";
			$("#iw-item-name").val("");
			$("#iw-scan").val("");
			$("#iw-scan-meta").text(`0 ${__("codes")}`);
			this.renderFilterBar();
			this.renderActiveChips();
			this.refresh();
		});

		// Filter buttons → open dropdown
		$body.on("click", ".iw-filter", (e) => {
			const key = e.currentTarget.dataset.filterKey;
			this.openFilterDropdown(key, e.currentTarget);
		});

		// Active chip removal
		$body.on("click", "[data-rm]", (e) => {
			e.preventDefault();
			const k = e.currentTarget.dataset.rm;
			if (k === "__name") {
				this.state.item_name_search = "";
				$("#iw-item-name").val("");
			} else if (k === "__scan") {
				this.state.scan_serials = "";
				$("#iw-scan").val("").trigger("input");
			} else {
				delete this.state.filters[k];
			}
			this.renderFilterBar();
			this.renderActiveChips();
			this.refresh();
		});
		$body.on("click", "#iw-clear-all", (e) => {
			e.preventDefault();
			this.state.filters = { status: this.state.filters.status || [] };
			this.state.item_name_search = "";
			this.state.scan_serials = "";
			$("#iw-item-name").val("");
			$("#iw-scan").val("").trigger("input");
			this.renderFilterBar();
			this.renderActiveChips();
			this.refresh();
		});

		// Sort
		$body.on("click", ".iw-th-sortable", (e) => {
			const key = e.currentTarget.dataset.sort;
			if (!key) return;
			if (this.state.sort_by === key) {
				this.state.sort_dir = this.state.sort_dir === "asc" ? "desc" : "asc";
			} else {
				this.state.sort_by = key;
				this.state.sort_dir = "asc";
			}
			this.renderTableHeader();
			this.refresh();
		});

		// Select-all checkbox (selects all visible/loaded rows)
		$body.on("change", "#iw-select-all", (e) => {
			if (e.currentTarget.checked) {
				for (const r of this.state.rowsByIndex.values()) this.state.selected.add(r.serial_no);
			} else {
				this.state.selected.clear();
			}
			this.renderFooter();
			this.renderTableBody(true);
		});

		// Row checkbox + clicks (delegated)
		$body.on("change", ".iw-row-check", (e) => {
			const sn = e.currentTarget.closest(".iw-tr").dataset.sn;
			if (e.currentTarget.checked) this.state.selected.add(sn);
			else this.state.selected.delete(sn);
			this.renderFooter();
		});

		// Bottom bar buttons
		$body.on("click", "#iw-export", () => this.exportXlsx({ selected: false }));
		$body.on("click", "#iw-export-selected", () => this.exportXlsx({ selected: true }));
		$body.on("click", "#iw-bulk-status", (e) => this.openBulkStatusDialog());
		$body.on("click", "#iw-deselect", () => {
			this.state.selected.clear();
			this.renderFooter();
			this.renderTableBody(true);
		});
		$body.on("click", "#iw-cols", () => this.openColumnDialog());

		// Scroll virtualization
		const $scroll = $body.find("#iw-table-scroll");
		$scroll.on("scroll", () => {
			if (this.scrollRaf) return;
			this.scrollRaf = requestAnimationFrame(() => {
				this.scrollRaf = null;
				this.renderTableBody(false);
			});
		});

		// Window resize → recompute viewport
		$(window).on("resize.iw", () => this.renderTableBody(false));

		$(this.wrapper).on("remove", () => {
			$(window).off("resize.iw");
			this.teardown();
		});
	}

	// ---------------------------------------------------------------- realtime
	bindRealtime() {
		this.realtimeHandler = (msg) => {
			if (!msg || !msg.serial_no) return;
			let changed = false;
			for (const [idx, r] of this.state.rowsByIndex) {
				if (r.serial_no === msg.serial_no) {
					Object.assign(r, {
						status: msg.status,
						location_name: msg.location_name,
						shelf_kind: msg.shelf_kind,
						box: msg.box,
					});
					changed = true;
				}
			}
			if (changed) this.renderTableBody(true);
		};
		frappe.realtime.on("munzer_inventory_update", this.realtimeHandler);
	}

	// ---------------------------------------------------------------- core data flow
	refresh() {
		// Clear cache + re-render shell
		this.state.rowsByIndex.clear();
		this.state.fetchedPages.clear();
		this.state.loadingPages.clear();
		this.state.selected.clear();
		this.state.total = 0;
		this.state.summary = null;
		const $scroll = $("#iw-table-scroll", this.page.body);
		$scroll.scrollTop(0);
		this.renderTableBody(true);
		this.renderFooter();
		this.updateCount();
		// fetch first page (also returns total & summary)
		this.fetchPage(1);
	}

	fetchPage(pageNum) {
		if (this.state.fetchedPages.has(pageNum) || this.state.loadingPages.has(pageNum)) return;
		this.state.loadingPages.add(pageNum);
		const filters = { ...this.state.filters };
		if (this.state.item_name_search) filters.item_name = this.state.item_name_search;
		if (this.state.scan_serials) filters.scan_codes = this.state.scan_serials;
		frappe
			.call({
				method: "munzer_app.munzer_app.api.list_serials",
				args: {
					filters: JSON.stringify(filters),
					page: pageNum,
					page_size: PAGE_SIZE,
					sort_by: this.state.sort_by,
					sort_dir: this.state.sort_dir,
					with_summary: pageNum === 1 ? 1 : 0,
				},
			})
			.then((r) => {
				const res = r.message || {};
				const offset = (pageNum - 1) * PAGE_SIZE;
				(res.rows || []).forEach((row, i) => this.state.rowsByIndex.set(offset + i, row));
				this.state.total = res.total ?? this.state.total;
				if (pageNum === 1) {
					this.state.summary = res.summary;
					this.renderFooter();
				}
				this.state.fetchedPages.add(pageNum);
				this.state.loadingPages.delete(pageNum);
				this.updateCount();
				this.renderTableBody(true);
			})
			.catch((err) => {
				this.state.loadingPages.delete(pageNum);
				console.error("inventory-workstation list_serials error", err);
			});
	}

	// ---------------------------------------------------------------- virtualized body
	renderTableBody(scrollResetSafe = true) {
		const $scroll = $("#iw-table-scroll", this.page.body);
		const $bodyWrap = $("#iw-tbody-wrap", this.page.body);
		const $body = $("#iw-tbody", this.page.body);

		const total = this.state.total || 0;
		const totalHeight = total * ROW_HEIGHT;
		$bodyWrap.css("height", totalHeight + "px");

		const containerEl = $scroll[0];
		if (!containerEl) return;
		const scrollTop = containerEl.scrollTop || 0;
		const containerH = containerEl.clientHeight || 600;
		const visibleStart = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT));
		const visibleEnd = Math.min(total, Math.ceil((scrollTop + containerH) / ROW_HEIGHT));
		const buffer = 12;
		const renderStart = Math.max(0, visibleStart - buffer);
		const renderEnd = Math.min(total, visibleEnd + buffer);

		// Trigger fetches for any pages we need but don't have yet
		const startPage = Math.floor(renderStart / PAGE_SIZE) + 1;
		const endPage = Math.floor(Math.max(renderEnd - 1, 0) / PAGE_SIZE) + 1;
		for (let p = startPage; p <= endPage; p++) this.fetchPage(p);

		// Render rows
		const html = [];
		for (let i = renderStart; i < renderEnd; i++) {
			const r = this.state.rowsByIndex.get(i);
			html.push(this.renderRow(r, i));
		}
		$body.html(html.join(""));
	}

	renderRow(r, idx) {
		const top = idx * ROW_HEIGHT;
		if (!r) {
			return `<div class="iw-tr iw-tr-skel" style="top:${top}px"><div class="iw-skel-bar"></div></div>`;
		}
		const isSel = this.state.selected.has(r.serial_no);
		const cells = this.visibleColumns().map((c) => this.renderCell(r, c)).join("");
		return `
			<div class="iw-tr ${isSel ? "iw-tr-selected" : ""} ${idx % 2 ? "iw-tr-odd" : "iw-tr-even"}"
				style="top:${top}px" data-sn="${frappe.utils.escape_html(r.serial_no)}">
				<div class="iw-td iw-td-check"><input type="checkbox" class="iw-row-check" ${isSel ? "checked" : ""} /></div>
				${cells}
			</div>
		`;
	}

	renderCell(r, c) {
		const v = r[c.key];
		const align = c.align || "left";
		let inner;
		let titleAttr = String(v ?? "");

		if (c.action === "amazon") {
			const asin = r.asin;
			if (asin) {
				const a = frappe.utils.escape_html(String(asin));
				inner = `<a href="https://www.amazon.ae/dp/${a}" target="_blank" rel="noopener" class="iw-amzn-btn" title="ASIN ${a}">View on Amazon ↗</a>`;
			} else {
				inner = `<span class='iw-amzn-btn iw-amzn-btn-disabled' title="${__("No ASIN on this serial")}">— ${__("no ASIN")} —</span>`;
			}
			titleAttr = asin || "";
		} else if (c.statusPill) {
			if (v) {
				const tone = STATUS_TONES[v] || STATUS_TONES.Inactive;
				inner = `<span class="iw-status-pill" style="--bg:${tone.bg};--fg:${tone.fg};--dot:${tone.dot}"><span class="iw-status-dot"></span>${frappe.utils.escape_html(v)}</span>`;
			} else {
				inner = "<span class='iw-dim'>—</span>";
			}
		} else if (c.link === true && c.key === "serial_no") {
			inner = v ? `<a href="/app/serial-no/${encodeURIComponent(v)}" target="_blank" class="iw-link iw-mono">${frappe.utils.escape_html(v)}</a>` : "<span class='iw-dim'>—</span>";
		} else if (typeof c.link === "string" && v) {
			inner = `<a href="/app/${c.link}/${encodeURIComponent(v)}" target="_blank" class="iw-link">${frappe.utils.escape_html(String(v))}</a>`;
		} else if (c.amazon && v) {
			const a = frappe.utils.escape_html(String(v));
			inner = `<a href="https://www.amazon.ae/dp/${a}" target="_blank" class="iw-link iw-mono">${a} ↗</a>`;
		} else if (c.money) {
			inner = v ? `AED ${fmtMoney(v)}` : "—";
		} else if (c.date) {
			inner = v ? frappe.datetime.str_to_user(v).split(" ")[0] : "—";
		} else if (c.pill && v) {
			inner = `<span class="iw-pill">${frappe.utils.escape_html(String(v))}</span>`;
		} else if (c.mono && v) {
			inner = `<span class="iw-mono">${frappe.utils.escape_html(String(v))}</span>`;
		} else {
			inner = v ? frappe.utils.escape_html(String(v)) : "<span class='iw-dim'>—</span>";
		}

		const stickyCls = c.sticky === "right" ? "iw-td-sticky-right" : "";
		return `<div class="iw-td iw-td-${align} ${stickyCls}" style="width:${c.width}px" title="${frappe.utils.escape_html(titleAttr)}">${inner}</div>`;
	}

	// ---------------------------------------------------------------- export
	exportXlsx({ selected = false } = {}) {
		const filters = { ...this.state.filters };
		if (this.state.item_name_search) filters.item_name = this.state.item_name_search;
		if (this.state.scan_serials) filters.scan_codes = this.state.scan_serials;

		const params = new URLSearchParams({
			filters: JSON.stringify(filters),
			sort_by: this.state.sort_by,
			sort_dir: this.state.sort_dir,
		});
		if (selected && this.state.selected.size) {
			params.set("selected", JSON.stringify([...this.state.selected]));
		}

		const total = selected ? this.state.selected.size : this.state.total;
		frappe.show_alert({
			message: `${__("Exporting")} ${fmtNum(total)} ${__("rows…")}`,
			indicator: "orange",
		});

		// hidden iframe trigger so the page doesn't navigate away
		const url = `/api/method/munzer_app.munzer_app.api.export_xlsx?${params.toString()}`;
		const iframe = document.createElement("iframe");
		iframe.style.display = "none";
		iframe.src = url;
		document.body.appendChild(iframe);
		setTimeout(() => iframe.remove(), 60000);
	}

	// ---------------------------------------------------------------- filter dropdowns
	openFilterDropdown(key, anchor) {
		this.closeFilterDropdown();
		const def = FILTERS.find((f) => f.key === key);
		if (!def) return;

		const $pop = $(`<div class="iw-pop"></div>`);
		$pop.html(`
			<div class="iw-pop-head">
				<input type="text" class="iw-pop-search" placeholder="${__("Search…")}" />
			</div>
			<div class="iw-pop-list" tabindex="0"></div>
			<div class="iw-pop-foot">
				<button class="iw-btn-link iw-pop-clear">${__("Clear")}</button>
				<button class="iw-btn-primary iw-pop-apply">${__("Apply")}</button>
			</div>
		`);
		document.body.appendChild($pop[0]);

		const r = anchor.getBoundingClientRect();
		$pop.css({
			top: r.bottom + window.scrollY + 4 + "px",
			left: Math.max(8, r.left + window.scrollX) + "px",
			minWidth: Math.max(240, r.width) + "px",
		});

		this.state.openDropdown = $pop;
		const $list = $pop.find(".iw-pop-list");
		const $search = $pop.find(".iw-pop-search");

		const selected = new Set(this.state.filters[key] || []);

		const renderOptions = (items) => {
			$list.html(
				items
					.map(
						(opt) => `
					<label class="iw-pop-opt ${selected.has(opt.value) ? "checked" : ""}" data-val="${frappe.utils.escape_html(opt.value)}">
						<input type="checkbox" ${selected.has(opt.value) ? "checked" : ""} />
						<span>${frappe.utils.escape_html(opt.label || opt.value)}</span>
						${opt.hint ? `<span class="iw-pop-opt-hint">${frappe.utils.escape_html(opt.hint)}</span>` : ""}
					</label>
				`,
					)
					.join("") || `<div class="iw-pop-empty">${__("No matches")}</div>`,
			);
		};

		const fetchOptions = (txt) => {
			if (def.kind === "static") {
				const items = (def.options || [])
					.filter((o) => !txt || o.toLowerCase().includes(txt.toLowerCase()))
					.map((o) => ({ value: o, label: o }));
				renderOptions(items);
			} else if (def.kind === "link") {
				frappe.db
					.get_link_options(def.doctype, txt || "")
					.then((opts) => {
						const items = (opts || []).map((o) => ({
							value: o.value,
							label: o.value,
							hint: o.description && o.description !== o.value ? o.description : "",
						}));
						renderOptions(items);
					})
					.catch(() => renderOptions([]));
			}
		};

		fetchOptions("");
		setTimeout(() => $search.focus(), 30);

		let searchT;
		$search.on("input", function () {
			clearTimeout(searchT);
			searchT = setTimeout(() => fetchOptions(this.value), 180);
		});

		$list.on("change", 'input[type="checkbox"]', (e) => {
			const v = e.currentTarget.closest(".iw-pop-opt").dataset.val;
			if (e.currentTarget.checked) selected.add(v);
			else selected.delete(v);
			$(e.currentTarget).closest(".iw-pop-opt").toggleClass("checked", e.currentTarget.checked);
		});

		$pop.find(".iw-pop-clear").on("click", () => {
			selected.clear();
			$pop.find('input[type="checkbox"]').prop("checked", false);
			$pop.find(".iw-pop-opt").removeClass("checked");
		});

		$pop.find(".iw-pop-apply").on("click", () => {
			const arr = [...selected];
			if (arr.length) this.state.filters[key] = arr;
			else delete this.state.filters[key];
			this.closeFilterDropdown();
			this.renderFilterBar();
			this.renderActiveChips();
			this.refresh();
		});

		setTimeout(() => {
			$(document).one("mousedown.iw-pop", (e) => {
				if (
					!$(e.target).closest(".iw-pop").length &&
					!$(e.target).closest(`[data-filter-key="${key}"]`).length
				) {
					this.closeFilterDropdown();
				}
			});
		}, 10);
	}

	closeFilterDropdown() {
		if (this.state.openDropdown) {
			this.state.openDropdown.remove();
			this.state.openDropdown = null;
			$(document).off("mousedown.iw-pop");
		}
	}

	// ---------------------------------------------------------------- bulk status dialog
	openBulkStatusDialog() {
		const sns = [...this.state.selected];
		if (!sns.length) return;
		const me = this;
		const dialog = new frappe.ui.Dialog({
			title: __("Change Status — {0} serials", [sns.length]),
			fields: [
				{
					fieldname: "status",
					label: __("New Status"),
					fieldtype: "Select",
					options: ALL_STATUSES.join("\n"),
					default: "Active",
					reqd: 1,
				},
			],
			primary_action_label: __("Apply"),
			primary_action: ({ status }) => {
				dialog.hide();
				frappe
					.call({
						method: "munzer_app.munzer_app.api.bulk_change_status",
						args: { serial_nos: JSON.stringify(sns), status },
					})
					.then((r) => {
						const res = r.message || {};
						frappe.show_alert({ message: `${res.updated || 0} ${__("updated")}`, indicator: "green" });
						me.refresh();
					});
			},
		});
		dialog.show();
	}

	// ---------------------------------------------------------------- columns
	loadColVis() {
		try {
			const raw = localStorage.getItem(STORAGE_VIS);
			return raw ? new Map(JSON.parse(raw)) : new Map();
		} catch (e) {
			return new Map();
		}
	}

	saveColVis() {
		try {
			localStorage.setItem(STORAGE_VIS, JSON.stringify([...this.state.colVis]));
		} catch (e) {}
	}

	isColVisible(col) {
		const v = this.state.colVis.get(col.key);
		return v === undefined ? !!col.defaultVisible : !!v;
	}

	visibleColumns() {
		return COLUMNS.filter((c) => this.isColVisible(c));
	}

	openColumnDialog() {
		const me = this;
		const dialog = new frappe.ui.Dialog({
			title: __("Columns"),
			size: "small",
			fields: [
				{
					fieldname: "html",
					fieldtype: "HTML",
					options: `
						<div class="iw-col-mgr">
							<div class="iw-col-mgr-actions">
								<button type="button" class="iw-btn-link" data-act="all">${__("Show all")}</button>
								<button type="button" class="iw-btn-link" data-act="none">${__("Hide all")}</button>
								<button type="button" class="iw-btn-link" data-act="reset">${__("Reset to defaults")}</button>
							</div>
							<div class="iw-col-mgr-list">
								${COLUMNS.map(
									(c) => `
									<label class="iw-col-mgr-row">
										<input type="checkbox" data-key="${c.key}" ${me.isColVisible(c) ? "checked" : ""} />
										<span>${frappe.utils.escape_html(c.label)}</span>
										${!c.defaultVisible ? `<span class="iw-col-mgr-tag">${__("optional")}</span>` : ""}
									</label>
								`,
								).join("")}
							</div>
						</div>
					`,
				},
			],
			primary_action_label: __("Done"),
			primary_action: () => dialog.hide(),
		});

		dialog.show();
		const $w = dialog.$wrapper;

		const apply = () => {
			me.saveColVis();
			me.renderTableHeader();
			me.renderTableBody(true);
		};

		$w.on("change", "input[type=checkbox]", (e) => {
			const key = e.currentTarget.dataset.key;
			me.state.colVis.set(key, e.currentTarget.checked);
			apply();
		});

		$w.on("click", "[data-act]", (e) => {
			const act = e.currentTarget.dataset.act;
			if (act === "all") {
				COLUMNS.forEach((c) => me.state.colVis.set(c.key, true));
			} else if (act === "none") {
				COLUMNS.forEach((c) => me.state.colVis.set(c.key, false));
			} else if (act === "reset") {
				me.state.colVis.clear();
			}
			$w.find("input[type=checkbox]").each((_i, el) => {
				const col = COLUMNS.find((c) => c.key === el.dataset.key);
				el.checked = me.isColVisible(col);
			});
			apply();
		});
	}

	// ---------------------------------------------------------------- styles
	injectStyles() {
		if (document.getElementById("munzer-iw-styles")) return;
		const style = document.createElement("style");
		style.id = "munzer-iw-styles";
		style.textContent = STYLES;
		document.head.appendChild(style);
	}
}

// =============================================================================
// Styles — Amazon Seller Central palette
// =============================================================================
const STYLES = `
.munzer-iw {
	--orange: #FF9900;
	--orange-h: #E48800;
	--ink: #0F1111;
	--ink-2: #565959;
	--ink-3: #6F7373;
	--bd: #D5D9D9;
	--bd-2: #DDDDDD;
	--bg: #FFFFFF;
	--bg-2: #F7F8F8;
	--bg-3: #FAFAFA;
	--link: #007185;
	--link-h: #C7511F;
	--sel: #FFF8EB;
	--sel-bd: #FFD9A8;
	font-family: "Amazon Ember","Helvetica Neue",-apple-system,Segoe UI,Roboto,Arial,sans-serif;
	color:var(--ink);
	background:var(--bg);
}
.munzer-iw .iw-app {
	display:grid;
	grid-template-rows: auto auto 1fr auto;
	height: calc(100vh - 100px);
	min-height: 600px;
	background:var(--bg);
	border:1px solid var(--bd);
	border-radius:8px;
	overflow:hidden;
}
/* ---- top filter bar ---- */
.munzer-iw .iw-filterbar {
	display:flex; flex-wrap:wrap; gap:6px;
	padding:10px 14px;
	background:var(--bg);
	border-bottom:1px solid var(--bd);
	position:sticky; top:0; z-index:5;
}
.munzer-iw .iw-filter {
	display:inline-flex; align-items:center; gap:6px;
	padding:6px 12px;
	border-radius:8px;
	background:#FFFFFF;
	border:1px solid var(--bd);
	color:var(--ink);
	font-size:13px;
	font-weight:500;
	cursor:pointer;
	transition: box-shadow 0.12s ease, border-color 0.12s ease;
}
.munzer-iw .iw-filter:hover {
	border-color:#888C8C;
	box-shadow: 0 0 0 3px rgba(228,136,0,0.08);
}
.munzer-iw .iw-filter.active {
	border-color:var(--orange);
	background:#FFFAF1;
}
.munzer-iw .iw-filter-count {
	background:var(--orange);
	color:#fff;
	border-radius:999px;
	padding:1px 7px;
	font-size:11px;
	font-weight:700;
}
/* ---- chip row ---- */
.munzer-iw .iw-chiprow {
	display:flex; justify-content:space-between; align-items:center; gap:10px;
	padding:8px 14px;
	background:var(--bg-3);
	border-bottom:1px solid var(--bd);
	min-height:40px;
}
.munzer-iw .iw-chiprow-left { display:flex; gap:6px; flex-wrap:wrap; flex:1; }
.munzer-iw .iw-chip {
	display:inline-flex; align-items:center; gap:4px;
	background:#fff;
	border:1px solid var(--bd);
	border-radius:999px;
	padding:3px 10px;
	font-size:12px;
	color:var(--ink);
}
.munzer-iw .iw-chip b { font-weight:600; }
.munzer-iw .iw-chip .x { cursor:pointer; opacity:0.55; padding:0 2px; }
.munzer-iw .iw-chip .x:hover { opacity:1; color:var(--link-h); }
.munzer-iw .iw-chip-scan { background:#FFF8EB; border-color:var(--sel-bd); }
.munzer-iw .iw-chip-empty { color:var(--ink-3); font-size:12px; font-style:italic; }
.munzer-iw .iw-chiprow-right { display:flex; align-items:center; gap:14px; font-size:12px; color:var(--ink-2); }
.munzer-iw .iw-chiprow-right a { color:var(--link); }
.munzer-iw .iw-chiprow-right a:hover { color:var(--link-h); }

/* ---- main split: sidebar + table ---- */
.munzer-iw .iw-main { display:grid; grid-template-columns: 280px 1fr; min-height:0; }
@media (max-width: 900px) { .munzer-iw .iw-main { grid-template-columns: 1fr; } .munzer-iw .iw-sidebar { display:none; } }

.munzer-iw .iw-sidebar {
	background:var(--bg-2);
	border-right:1px solid var(--bd);
	padding:14px;
	overflow-y:auto;
	display:flex; flex-direction:column; gap:18px;
}
.munzer-iw .iw-side-section { display:flex; flex-direction:column; gap:6px; }
.munzer-iw .iw-side-foot { margin-top:auto; }
.munzer-iw .iw-side-label {
	font-size:11px; font-weight:700;
	text-transform:uppercase;
	letter-spacing:0.6px;
	color:var(--ink-2);
}
.munzer-iw .iw-input-wrap {
	display:flex; align-items:center; gap:6px;
	background:#fff;
	border:1px solid var(--bd);
	border-radius:6px;
	padding:0 8px;
}
.munzer-iw .iw-input-wrap:focus-within {
	border-color:var(--orange);
	box-shadow:0 0 0 3px rgba(228,136,0,0.18);
}
.munzer-iw .iw-input-icon { color:var(--ink-3); flex-shrink:0; }
.munzer-iw .iw-input {
	flex:1;
	border:none; outline:none; background:transparent;
	padding:8px 0;
	font-size:13px;
	color:var(--ink);
}
.munzer-iw .iw-input-clear {
	border:none; background:transparent; cursor:pointer;
	color:var(--ink-3); font-size:12px;
}
.munzer-iw .iw-textarea {
	width:100%;
	background:#fff;
	border:1px solid var(--bd);
	border-radius:6px;
	padding:8px 10px;
	font-family: ui-monospace, Menlo, monospace;
	font-size:12px;
	color:var(--ink);
	resize:vertical;
	min-height:120px;
}
.munzer-iw .iw-textarea:focus {
	outline:none;
	border-color:var(--orange);
	box-shadow:0 0 0 3px rgba(228,136,0,0.18);
}
.munzer-iw .iw-side-row { display:flex; justify-content:space-between; align-items:center; }
.munzer-iw .iw-side-meta { font-size:11px; color:var(--ink-3); }
.munzer-iw .iw-side-help { font-size:11px; color:var(--ink-3); line-height:1.45; }

/* ---- buttons ---- */
.munzer-iw .iw-btn-primary {
	display:inline-flex; align-items:center; gap:6px;
	background:linear-gradient(180deg,#FFD814 0%,#FFC107 50%,#F7CA00 100%);
	border:1px solid #FCD200;
	color:var(--ink);
	padding:7px 14px;
	border-radius:6px;
	font-size:13px;
	font-weight:600;
	cursor:pointer;
	box-shadow:0 1px 0 rgba(0,0,0,0.05);
}
.munzer-iw .iw-btn-primary:hover { background:linear-gradient(180deg,#F7CA00 0%,#F2C200 50%,#E6B800 100%); }
.munzer-iw .iw-btn-ghost {
	background:#fff;
	border:1px solid var(--bd);
	color:var(--ink);
	padding:7px 12px;
	border-radius:6px;
	font-size:13px;
	cursor:pointer;
}
.munzer-iw .iw-btn-ghost:hover { background:var(--bg-2); }
.munzer-iw .iw-btn-block { width:100%; }
.munzer-iw .iw-btn-link {
	background:transparent; border:none; padding:0;
	color:var(--link); cursor:pointer;
	font-size:13px;
}
.munzer-iw .iw-btn-link:hover { color:var(--link-h); text-decoration:underline; }

/* ---- table pane ---- */
.munzer-iw .iw-table-pane { display:flex; flex-direction:column; min-width:0; min-height:0; }
.munzer-iw .iw-toolbar {
	display:flex; align-items:center; justify-content:space-between;
	padding:8px 14px;
	border-bottom:1px solid var(--bd);
	background:#fff;
	gap:8px;
}
.munzer-iw .iw-toolbar-left { color:var(--ink-2); font-size:13px; }
.munzer-iw .iw-toolbar-right { display:flex; gap:8px; }
.munzer-iw .iw-count { font-weight:600; color:var(--ink); }

.munzer-iw .iw-table-scroll {
	flex:1;
	overflow:auto;
	background:#fff;
	position:relative;
}
.munzer-iw .iw-table { min-width: max-content; }
.munzer-iw .iw-thead {
	position:sticky; top:0; z-index:3;
	background:#fff;
	border-bottom:2px solid var(--bd);
	box-shadow:0 1px 0 var(--bd);
}
.munzer-iw .iw-tr {
	display:flex; align-items:center;
	height:${ROW_HEIGHT}px;
	border-bottom:1px solid var(--bd-2);
	font-size:13px;
	color:var(--ink);
}
.munzer-iw .iw-tr-head {
	height:42px;
	background:#fff;
	color:var(--ink);
	font-weight:600;
	font-size:12px;
}
.munzer-iw .iw-th, .munzer-iw .iw-td {
	padding: 0 12px;
	flex-shrink:0;
	overflow:hidden;
	white-space:nowrap;
	text-overflow:ellipsis;
}
.munzer-iw .iw-th-check, .munzer-iw .iw-td-check { width:40px; padding:0 8px; flex-shrink:0; }
.munzer-iw .iw-th-check input, .munzer-iw .iw-td-check input { accent-color: var(--orange); cursor:pointer; }
.munzer-iw .iw-th-sortable { cursor:pointer; user-select:none; }
.munzer-iw .iw-th-sortable:hover { background:var(--bg-2); }
.munzer-iw .iw-th-sorted { color:var(--ink); }
.munzer-iw .iw-th-arrow { color:var(--orange); font-size:10px; margin-left:4px; }
.munzer-iw .iw-th-right { justify-content:flex-end; text-align:right; }
.munzer-iw .iw-td-right { justify-content:flex-end; text-align:right; }

.munzer-iw .iw-tbody-wrap { position:relative; }
.munzer-iw .iw-tbody { position:relative; }
.munzer-iw .iw-tbody .iw-tr {
	position:absolute; left:0; right:0;
	--row-bg: #fff;
	background: var(--row-bg);
}
.munzer-iw .iw-tbody .iw-tr.iw-tr-odd { --row-bg: var(--bg-3); }
.munzer-iw .iw-tbody .iw-tr:hover { --row-bg: #FFF8EB; }
.munzer-iw .iw-tbody .iw-tr-selected { --row-bg: var(--sel); box-shadow: inset 3px 0 0 var(--orange); }

.munzer-iw .iw-link {
	color:var(--link);
	text-decoration:none;
}
.munzer-iw .iw-link:hover { color:var(--link-h); text-decoration:underline; }
.munzer-iw .iw-mono { font-family: ui-monospace, Menlo, monospace; font-size:12.5px; }
.munzer-iw .iw-pill {
	display:inline-block;
	padding:1px 8px;
	border-radius:4px;
	background:var(--bg-2);
	border:1px solid var(--bd);
	font-size:11px;
	font-weight:600;
	color:var(--ink-2);
}
.munzer-iw .iw-dim { color:var(--ink-3); }

.munzer-iw .iw-status-pill {
	display:inline-flex; align-items:center; gap:6px;
	background:var(--bg, #EAEDED);
	color:var(--fg, #565959);
	border-radius:999px;
	padding:3px 10px 3px 8px;
	font-size:11px;
	font-weight:700;
	letter-spacing:0.4px;
	text-transform:uppercase;
	user-select:none;
}
.munzer-iw .iw-status-dot {
	width:7px; height:7px; border-radius:50%;
	background:var(--dot, currentColor);
	flex-shrink:0;
}

/* skeleton row while a page is loading */
.munzer-iw .iw-tr-skel { background:#fff; }
.munzer-iw .iw-skel-bar {
	margin: 14px 12px;
	height:14px; width:60%;
	background:linear-gradient(90deg, #ECEFEF 0%, #F7F8F8 50%, #ECEFEF 100%);
	background-size: 200% 100%;
	animation: iw-skel 1.2s linear infinite;
	border-radius:4px;
}
@keyframes iw-skel {
	0% { background-position: 200% 0; }
	100% { background-position: -200% 0; }
}

/* ---- footer ---- */
.munzer-iw .iw-footer {
	display:flex; justify-content:space-between; align-items:center;
	padding:8px 14px;
	background:var(--bg-3);
	border-top:1px solid var(--bd);
	font-size:13px;
	gap:14px;
}
.munzer-iw .iw-foot-left { display:flex; gap:14px; align-items:center; }
.munzer-iw .iw-foot-sel b {
	background:var(--orange); color:#fff;
	padding:2px 8px; border-radius:999px;
	margin-right:6px;
}
.munzer-iw .iw-foot-right { display:flex; gap:8px; align-items:center; flex-wrap:wrap; color:var(--ink-2); }
.munzer-iw .iw-stat-k { color:var(--ink-3); margin-right:4px; }
.munzer-iw .iw-stat b { color:var(--ink); }
.munzer-iw .iw-stat-sep { color:var(--bd); }

/* ---- popover dropdown ---- */
.iw-pop {
	position:absolute;
	z-index:1100;
	background:#fff;
	border:1px solid var(--bd, #D5D9D9);
	border-radius:8px;
	box-shadow:0 12px 32px rgba(0,0,0,0.12);
	display:flex; flex-direction:column;
	width:280px;
	max-height:380px;
	overflow:hidden;
}
.iw-pop-head { padding:8px; border-bottom:1px solid #ECECEC; }
.iw-pop-search {
	width:100%;
	border:1px solid #D5D9D9;
	border-radius:6px;
	padding:6px 8px;
	font-size:13px;
	outline:none;
}
.iw-pop-search:focus { border-color:#FF9900; box-shadow:0 0 0 3px rgba(228,136,0,0.15); }
.iw-pop-list { flex:1; overflow-y:auto; padding:4px 0; }
.iw-pop-empty { padding:14px; text-align:center; color:#6F7373; font-size:12px; }
.iw-pop-opt {
	display:flex; align-items:center; gap:8px;
	padding:6px 10px;
	cursor:pointer;
	font-size:13px;
}
.iw-pop-opt:hover { background:#FFF8EB; }
.iw-pop-opt.checked { background:#FFF1D6; }
.iw-pop-opt input { accent-color:#FF9900; }
.iw-pop-opt-hint { color:#6F7373; font-size:11px; margin-left:auto; }
.iw-pop-foot { display:flex; justify-content:space-between; padding:8px; border-top:1px solid #ECECEC; }

/* ---- column manager dialog ---- */
.iw-col-mgr { display:flex; flex-direction:column; gap:10px; }
.iw-col-mgr-actions {
	display:flex; gap:14px;
	padding-bottom:8px;
	border-bottom:1px solid #ECECEC;
}
.iw-col-mgr-list {
	display:flex; flex-direction:column;
	max-height: 50vh;
	overflow-y:auto;
}
.iw-col-mgr-row {
	display:flex; align-items:center; gap:10px;
	padding:6px 4px;
	border-radius:4px;
	cursor:pointer;
	font-size:13px;
	color:#0F1111;
}
.iw-col-mgr-row:hover { background:#FFF8EB; }
.iw-col-mgr-row input { accent-color:#FF9900; cursor:pointer; }
.iw-col-mgr-tag {
	margin-left:auto;
	font-size:10px;
	text-transform:uppercase;
	letter-spacing:0.6px;
	color:#6F7373;
	background:#EAEDED;
	padding:1px 6px;
	border-radius:3px;
}

/* ---- sticky right column (View on Amazon action) ---- */
.munzer-iw .iw-th-sticky-right,
.munzer-iw .iw-td-sticky-right {
	position: sticky;
	right: 0;
	z-index: 2;
	background: var(--row-bg, #FFFFFF);
	border-left: 1px solid #D5D9D9;
	box-shadow: -6px 0 12px rgba(15,17,17,0.06);
	display:flex;
	align-items:center;
	justify-content:center;
}
.munzer-iw .iw-thead .iw-th-sticky-right {
	background: #FFFFFF;
	z-index: 4;
}

.munzer-iw .iw-amzn-btn {
	display:inline-flex;
	align-items:center;
	gap:4px;
	background: linear-gradient(180deg,#FFD814 0%,#F7CA00 100%);
	border: 1px solid #FCD200;
	border-radius: 999px;
	padding: 4px 12px;
	color:#0F1111;
	font-size:11px;
	font-weight:600;
	text-decoration:none !important;
	white-space:nowrap;
	box-shadow: 0 1px 0 rgba(0,0,0,0.05);
	transition: background 0.12s ease, transform 0.12s ease;
}
.munzer-iw .iw-amzn-btn:hover {
	background: linear-gradient(180deg,#F7CA00 0%,#E6B800 100%);
	color:#0F1111;
	transform: translateY(-1px);
	text-decoration:none !important;
}
.munzer-iw .iw-amzn-btn-disabled {
	background:#EAEDED;
	border-color:#D5D9D9;
	color:#6F7373;
	cursor:not-allowed;
	transform:none;
	pointer-events:none;
}
`;
