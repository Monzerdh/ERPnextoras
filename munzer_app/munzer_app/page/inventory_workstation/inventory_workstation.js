/* eslint-disable no-undef */
// Inventory Workstation — Munzer App
// Amazon-style scanner-first inventory page for ORAS warehouse staff.

frappe.pages["inventory-workstation"].on_page_load = function (wrapper) {
	new InventoryWorkstation(wrapper);
};

const STATUS_COLORS = {
	Active: "#22c55e",
	Inactive: "#94a3b8",
	Consumed: "#E8173A",
	Delivered: "#3b82f6",
	Expired: "#f59e0b",
};

const ALL_STATUSES = ["Active", "Inactive", "Consumed", "Delivered", "Expired"];

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
			search: "",
			selected: null,
			selectedSet: new Set(),
			bulkMode: false,
			data: [],
			rowsByCode: new Map(),
			total: 0,
			page: 1,
			page_size: 100,
			loading: false,
			facets: {},
			detail: null,
			detailLoading: false,
		};
		this.searchDebounce = null;
		this.realtimeHandler = null;
		this.observer = null;
		this.init();
	}

	// -------------------------------------------------------------- init/teardown
	init() {
		this.injectStyles();
		this.renderShell();
		this.bindGlobals();
		this.bindRealtime();
		this.loadList(true);
		setTimeout(() => this.focusScanner(), 100);

		$(this.wrapper).on("remove", () => this.teardown());
	}

	teardown() {
		if (this.realtimeHandler) {
			frappe.realtime.off("munzer_inventory_update", this.realtimeHandler);
		}
		if (this.observer) this.observer.disconnect();
	}

	// -------------------------------------------------------------- styles
	injectStyles() {
		if (document.getElementById("munzer-iw-styles")) return;
		const style = document.createElement("style");
		style.id = "munzer-iw-styles";
		style.textContent = STYLES;
		document.head.appendChild(style);
	}

	// -------------------------------------------------------------- shell render
	renderShell() {
		const $body = $(this.page.body).addClass("munzer-iw");
		$body.html(`
			<div class="iw-root">
				<div class="iw-topbar">
					<div class="iw-search-wrap">
						<span class="iw-search-icon">🔍</span>
						<input class="iw-search" id="iw-search"
							placeholder="${__("Scan or search… (serial, ASIN, tracking, item, barcode)")}"
							autocomplete="off" />
						<button class="iw-btn iw-btn-ghost" id="iw-clear-search" title="${__("Clear")}">✕</button>
					</div>
					<div class="iw-status-tabs" id="iw-status-tabs"></div>
					<div class="iw-spacer"></div>
					<button class="iw-btn iw-btn-ghost" id="iw-toggle-bulk">
						<span class="iw-bulk-pill">${__("Bulk")}<b id="iw-bulk-count">0</b></span>
					</button>
					<button class="iw-btn iw-btn-ghost" id="iw-open-filters" title="${__("Filters")}">⚙</button>
					<button class="iw-btn iw-btn-ghost" id="iw-refresh" title="${__("Refresh")}">↻</button>
				</div>

				<div class="iw-filterbar" id="iw-filterbar"></div>

				<div class="iw-split">
					<div class="iw-list-pane">
						<div class="iw-list-meta">
							<span id="iw-list-count">—</span>
							<span class="iw-list-meta-right">
								<a href="#" id="iw-export-visible">⬇ ${__("Export visible")}</a>
							</span>
						</div>
						<div class="iw-list" id="iw-list"></div>
						<div class="iw-list-sentinel" id="iw-sentinel"></div>
					</div>
					<div class="iw-detail-pane" id="iw-detail-pane">
						${this.renderDetailEmpty()}
					</div>
				</div>

				<div class="iw-bulkbar" id="iw-bulkbar" hidden>
					<span class="iw-bulkbar-count"><b id="iw-bulkbar-num">0</b> ${__("selected")}</span>
					<button class="iw-btn" data-bulk="status">${__("Change Status")} ▾</button>
					<button class="iw-btn" data-bulk="move">${__("Move To…")}</button>
					<button class="iw-btn" data-bulk="print">🖨 ${__("Print Labels")}</button>
					<div class="iw-spacer"></div>
					<button class="iw-btn iw-btn-ghost" data-bulk="clear">${__("Clear")}</button>
				</div>
			</div>
		`);

		this.renderStatusTabs();
		this.renderFilterBar();
	}

	// -------------------------------------------------------------- status tabs
	renderStatusTabs() {
		const $tabs = $("#iw-status-tabs", this.page.body);
		const sel = new Set(this.state.filters.status || []);
		const html = [
			`<button class="iw-tab ${sel.size === 0 ? "active" : ""}" data-status="all">${__("All")}</button>`,
		]
			.concat(
				ALL_STATUSES.map(
					(s) => `
					<button class="iw-tab ${sel.has(s) ? "active" : ""}" data-status="${s}"
						style="--c:${STATUS_COLORS[s]}">
						<span class="iw-tab-dot"></span>${s}
						<span class="iw-tab-count" id="iw-fc-${s}">·</span>
					</button>`,
				),
			)
			.join("");
		$tabs.html(html);
	}

	// -------------------------------------------------------------- filter bar (chips)
	renderFilterBar() {
		const f = this.state.filters;
		const chips = [];
		const labels = {
			item_code: __("Item"),
			grade: __("Grade"),
			batch: __("Batch"),
			customer: __("Customer"),
			shelf: __("Shelf Kind"),
			trolly_pallet: __("Pallet/Trolley"),
			shelf_name: __("Shelf"),
			box: __("Box"),
		};
		for (const k of Object.keys(labels)) {
			const v = f[k];
			if (Array.isArray(v) && v.length) {
				chips.push(
					`<span class="iw-chip" data-key="${k}">${labels[k]}: ${frappe.utils.escape_html(v.join(", "))}<span class="x" data-rm="${k}">✕</span></span>`,
				);
			}
		}
		if (f.scan_codes) {
			const n = (f.scan_codes.match(/\n|,/g) || []).length + 1;
			chips.push(
				`<span class="iw-chip iw-chip-scan" data-key="scan_codes">${__("Scanned")}: <b>${n}</b><span class="x" data-rm="scan_codes">✕</span></span>`,
			);
		}
		const html = chips.length
			? chips.join("") + ` <a href="#" id="iw-clear-chips">${__("Clear all")}</a>`
			: `<span class="iw-empty-chips">${__("No active filters — use the ⚙ menu to add some.")}</span>`;
		$("#iw-filterbar", this.page.body).html(html);
	}

	// -------------------------------------------------------------- list rendering
	renderList(append = false) {
		const $list = $("#iw-list", this.page.body);
		if (!append) $list.empty();
		const html = this.state.data.map((r) => this.renderRow(r)).join("");
		if (append) $list.append(html);
		else $list.html(html);

		$("#iw-list-count", this.page.body).text(
			`${this.state.data.length} / ${this.state.total} ${__("rows")}`,
		);
		this.updateFacetCounts();
		this.bindListEvents();
		this.observeSentinel();
	}

	renderRow(r) {
		const c = STATUS_COLORS[r.status] || "#64748b";
		const checked = this.state.selectedSet.has(r.serial_no) ? "checked" : "";
		const sel = this.state.selected === r.serial_no ? "selected" : "";
		const loc = [r.location_name, r.box].filter(Boolean).join(" / ");
		return `
			<div class="iw-row ${sel}" data-sn="${frappe.utils.escape_html(r.serial_no)}">
				<input type="checkbox" class="iw-row-check" ${checked} />
				<div class="iw-row-thumb">${r.image ? `<img src="${frappe.utils.escape_html(r.image)}" />` : "📦"}</div>
				<div class="iw-row-main">
					<div class="iw-row-line1">
						<span class="iw-row-sn">${frappe.utils.escape_html(r.serial_no)}</span>
						<span class="iw-badge" style="--bg:${c}">${frappe.utils.escape_html(r.status || "")}</span>
						${r.grade ? `<span class="iw-grade-pill">${frappe.utils.escape_html(r.grade)}</span>` : ""}
					</div>
					<div class="iw-row-line2">
						<span class="iw-row-item" title="${frappe.utils.escape_html(r.item_name || "")}">
							${frappe.utils.escape_html(r.item_code || "")} — ${frappe.utils.escape_html(r.item_name || "")}
						</span>
					</div>
					<div class="iw-row-line3">
						${loc ? `<span class="iw-row-loc">📍 ${frappe.utils.escape_html(loc)}</span>` : `<span class="iw-row-loc dim">${__("no location")}</span>`}
						${r.asin ? `<span class="iw-row-asin">ASIN: ${frappe.utils.escape_html(r.asin)}</span>` : ""}
						${r.sold_rate ? `<span class="iw-row-rate">AED ${frappe.utils.format_currency(r.sold_rate)}</span>` : ""}
					</div>
				</div>
			</div>
		`;
	}

	// -------------------------------------------------------------- detail rendering
	renderDetailEmpty() {
		return `
			<div class="iw-detail-empty">
				<div class="iw-detail-empty-icon">🏷</div>
				<div class="iw-detail-empty-title">${__("Select a serial to view details")}</div>
				<div class="iw-detail-empty-hint">${__("Or scan a barcode — it will jump straight to the matching item.")}</div>
			</div>
		`;
	}

	renderDetail() {
		const $pane = $("#iw-detail-pane", this.page.body);
		if (this.state.detailLoading) {
			$pane.html(`<div class="iw-detail-loading">${__("Loading…")}</div>`);
			return;
		}
		const d = this.state.detail;
		if (!d) {
			$pane.html(this.renderDetailEmpty());
			return;
		}
		const doc = d.doc || {};
		const item = d.item || {};
		const c = STATUS_COLORS[doc.status] || "#64748b";
		const ledger = (d.stock_ledger || [])
			.map(
				(e) => `
				<tr>
					<td>${frappe.utils.escape_html(e.posting_date)} ${e.posting_time || ""}</td>
					<td>${frappe.utils.escape_html(e.warehouse || "")}</td>
					<td>${frappe.utils.escape_html(e.voucher_type || "")}</td>
					<td><a href="/app/${(e.voucher_type || "").toLowerCase().replace(/ /g, "-")}/${encodeURIComponent(e.voucher_no || "")}" target="_blank">${frappe.utils.escape_html(e.voucher_no || "")}</a></td>
					<td class="num ${e.actual_qty >= 0 ? "pos" : "neg"}">${e.actual_qty}</td>
				</tr>
			`,
			)
			.join("");

		$pane.html(`
			<div class="iw-detail">
				<div class="iw-detail-head">
					<div class="iw-detail-thumb">${item.image ? `<img src="${frappe.utils.escape_html(item.image)}" />` : "📦"}</div>
					<div class="iw-detail-headinfo">
						<div class="iw-detail-sn">${frappe.utils.escape_html(doc.name)}</div>
						<div class="iw-detail-item">${frappe.utils.escape_html(doc.item_code || "")} — ${frappe.utils.escape_html(doc.item_name || "")}</div>
						<div class="iw-detail-meta">
							<span class="iw-badge" style="--bg:${c}">${frappe.utils.escape_html(doc.status || "")}</span>
							${doc.custom_grade ? `<span class="iw-grade-pill">${frappe.utils.escape_html(doc.custom_grade)}</span>` : ""}
							${doc.custom_condition ? `<span class="iw-meta-pill">${frappe.utils.escape_html(doc.custom_condition)}</span>` : ""}
						</div>
					</div>
					<div class="iw-detail-actions">
						<a class="iw-btn iw-btn-ghost" href="/app/serial-no/${encodeURIComponent(doc.name)}" target="_blank">${__("Open record ↗")}</a>
					</div>
				</div>

				<div class="iw-detail-grid">
					<div><span class="iw-k">${__("Location")}</span><span class="iw-v">${frappe.utils.escape_html([doc.custom_trolley_or_shelf_name, doc.custom_box].filter(Boolean).join(" / ") || "—")}</span></div>
					<div><span class="iw-k">${__("Shelf Kind")}</span><span class="iw-v">${frappe.utils.escape_html(doc.custom_trolley_or_shelf || "—")}</span></div>
					<div><span class="iw-k">${__("Batch")}</span><span class="iw-v">${frappe.utils.escape_html(doc.custom_batch_number || "—")}</span></div>
					<div><span class="iw-k">${__("Tracking")}</span><span class="iw-v">${frappe.utils.escape_html(doc.custom_tracking_number || "—")}</span></div>
					<div><span class="iw-k">${__("ASIN")}</span><span class="iw-v">${doc.custom_asin ? `<a href="https://www.amazon.ae/dp/${frappe.utils.escape_html(doc.custom_asin)}" target="_blank">${frappe.utils.escape_html(doc.custom_asin)} ↗</a>` : "—"}</span></div>
					<div><span class="iw-k">${__("Shipment")}</span><span class="iw-v">${frappe.utils.escape_html(doc.custom_shipment_request_id || "—")}</span></div>
					<div><span class="iw-k">${__("Customer")}</span><span class="iw-v">${doc.custom_customer ? `<a href="/app/customer/${encodeURIComponent(doc.custom_customer)}" target="_blank">${frappe.utils.escape_html(doc.custom_customer)} ↗</a>` : "—"}</span></div>
					<div><span class="iw-k">${__("Sales Invoice")}</span><span class="iw-v">${doc.custom_sales_invoice ? `<a href="/app/sales-invoice/${encodeURIComponent(doc.custom_sales_invoice)}" target="_blank">${frappe.utils.escape_html(doc.custom_sales_invoice)} ↗</a>` : "—"}</span></div>
					<div><span class="iw-k">${__("Cost")}</span><span class="iw-v">${doc.custom_rate ? "AED " + frappe.utils.format_currency(doc.custom_rate) : "—"}</span></div>
					<div><span class="iw-k">${__("Sold Rate")}</span><span class="iw-v">${doc.custom_sold_rate ? "AED " + frappe.utils.format_currency(doc.custom_sold_rate) : "—"}</span></div>
					<div><span class="iw-k">${__("MRP")}</span><span class="iw-v">${item.valuation_rate ? "AED " + frappe.utils.format_currency(item.valuation_rate) : "—"}</span></div>
					<div><span class="iw-k">${__("UoM")}</span><span class="iw-v">${frappe.utils.escape_html(item.stock_uom || "—")}</span></div>
				</div>

				<div class="iw-detail-actions-row">
					<select id="iw-detail-status" class="iw-select">
						${ALL_STATUSES.map((s) => `<option value="${s}" ${doc.status === s ? "selected" : ""}>${s}</option>`).join("")}
					</select>
					<button class="iw-btn" data-act="save-status">${__("Update Status")}</button>
					<button class="iw-btn" data-act="move">${__("Move To…")}</button>
					<button class="iw-btn" data-act="print">🖨 ${__("Print Label")}</button>
				</div>

				${
					(d.stock_ledger || []).length
						? `
				<div class="iw-detail-section">
					<div class="iw-detail-section-title">${__("Recent Stock Ledger")}</div>
					<table class="iw-ledger">
						<thead><tr>
							<th>${__("When")}</th>
							<th>${__("Warehouse")}</th>
							<th>${__("Voucher Type")}</th>
							<th>${__("Voucher No")}</th>
							<th class="num">${__("Qty")}</th>
						</tr></thead>
						<tbody>${ledger}</tbody>
					</table>
				</div>`
						: ""
				}

				${
					(d.barcodes || []).length
						? `
				<div class="iw-detail-section">
					<div class="iw-detail-section-title">${__("Item Barcodes")}</div>
					<div class="iw-barcodes">
						${d.barcodes.map((b) => `<span class="iw-barcode-pill"><b>${frappe.utils.escape_html(b.barcode)}</b> ${b.barcode_type || ""}</span>`).join("")}
					</div>
				</div>`
						: ""
				}
			</div>
		`);

		$pane.find("[data-act=save-status]").on("click", () => {
			const status = $pane.find("#iw-detail-status").val();
			this.bulkChangeStatus([this.state.selected], status);
		});
		$pane.find("[data-act=move]").on("click", () => this.openMoveDialog([this.state.selected]));
		$pane.find("[data-act=print]").on("click", () => this.printLabel(this.state.selected));
	}

	// -------------------------------------------------------------- bulk bar
	updateBulkBar() {
		const n = this.state.selectedSet.size;
		$("#iw-bulkbar", this.page.body).attr("hidden", n === 0 ? true : null);
		$("#iw-bulkbar-num", this.page.body).text(n);
		$("#iw-bulk-count", this.page.body).text(n);
	}

	updateFacetCounts() {
		for (const s of ALL_STATUSES) {
			$("#iw-fc-" + s, this.page.body).text(this.state.facets[s] ?? "·");
		}
	}

	// -------------------------------------------------------------- event wiring
	bindGlobals() {
		const $body = $(this.page.body);
		const me = this;

		// scanner / search
		$body.on("input", "#iw-search", function () {
			me.state.search = this.value;
			clearTimeout(me.searchDebounce);
			me.searchDebounce = setTimeout(() => me.loadList(true), 250);
		});
		$body.on("keydown", "#iw-search", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				clearTimeout(this.searchDebounce);
				this.onScanSubmit($("#iw-search").val().trim());
			}
		});
		$body.on("click", "#iw-clear-search", () => {
			$("#iw-search").val("").trigger("input").trigger("focus");
		});

		// status tabs
		$body.on("click", ".iw-tab", (e) => {
			const s = e.currentTarget.dataset.status;
			if (s === "all") this.state.filters.status = [];
			else this.state.filters.status = [s];
			this.renderStatusTabs();
			this.loadList(true);
		});

		// filter chip removal
		$body.on("click", "[data-rm]", (e) => {
			e.preventDefault();
			const k = e.currentTarget.dataset.rm;
			if (this.state.filters[k] !== undefined) delete this.state.filters[k];
			this.renderFilterBar();
			this.loadList(true);
		});
		$body.on("click", "#iw-clear-chips", (e) => {
			e.preventDefault();
			this.state.filters = { status: this.state.filters.status || [] };
			this.renderFilterBar();
			this.loadList(true);
		});

		// open filter drawer
		$body.on("click", "#iw-open-filters", () => this.openFiltersDialog());

		// refresh
		$body.on("click", "#iw-refresh", () => this.loadList(true));

		// bulk toggle
		$body.on("click", "#iw-toggle-bulk", () => {
			this.state.bulkMode = !this.state.bulkMode;
			$("#iw-toggle-bulk", this.page.body).toggleClass("active", this.state.bulkMode);
		});

		// bulk bar actions
		$body.on("click", ".iw-bulkbar [data-bulk]", (e) => {
			const act = e.currentTarget.dataset.bulk;
			const sns = [...this.state.selectedSet];
			if (act === "clear") {
				this.state.selectedSet.clear();
				this.updateBulkBar();
				this.renderList();
			} else if (act === "status") {
				this.openBulkStatusMenu(e.currentTarget, sns);
			} else if (act === "move") {
				this.openMoveDialog(sns);
			} else if (act === "print") {
				sns.forEach((sn) => this.printLabel(sn, true));
			}
		});

		// export visible
		$body.on("click", "#iw-export-visible", (e) => {
			e.preventDefault();
			this.exportVisibleCSV();
		});
	}

	bindListEvents() {
		const $list = $("#iw-list", this.page.body);
		$list.off("click").off("change");

		$list.on("change", ".iw-row-check", (e) => {
			const sn = e.currentTarget.closest(".iw-row").dataset.sn;
			if (e.currentTarget.checked) this.state.selectedSet.add(sn);
			else this.state.selectedSet.delete(sn);
			this.updateBulkBar();
		});

		$list.on("click", ".iw-row", (e) => {
			if (e.target.classList.contains("iw-row-check")) return;
			const sn = e.currentTarget.dataset.sn;
			if (this.state.bulkMode || e.shiftKey) {
				if (this.state.selectedSet.has(sn)) this.state.selectedSet.delete(sn);
				else this.state.selectedSet.add(sn);
				this.updateBulkBar();
				this.renderList();
			} else {
				this.selectRow(sn);
			}
		});
	}

	observeSentinel() {
		if (this.observer) this.observer.disconnect();
		const sentinel = document.getElementById("iw-sentinel");
		if (!sentinel) return;
		this.observer = new IntersectionObserver(
			(entries) => {
				if (
					entries[0].isIntersecting &&
					!this.state.loading &&
					this.state.data.length < this.state.total
				) {
					this.state.page++;
					this.loadList(false);
				}
			},
			{ rootMargin: "200px" },
		);
		this.observer.observe(sentinel);
	}

	// -------------------------------------------------------------- realtime
	bindRealtime() {
		this.realtimeHandler = (msg) => this.onRemoteUpdate(msg);
		frappe.realtime.on("munzer_inventory_update", this.realtimeHandler);
	}

	onRemoteUpdate(msg) {
		if (!msg || !msg.serial_no) return;
		const idx = this.state.data.findIndex((r) => r.serial_no === msg.serial_no);
		if (idx >= 0) {
			Object.assign(this.state.data[idx], {
				status: msg.status,
				location_name: msg.location_name,
				shelf_kind: msg.shelf_kind,
				box: msg.box,
			});
			this.renderList();
			frappe.show_alert({
				message: `${msg.serial_no}: ${msg.status}`,
				indicator: "blue",
			});
		}
		if (this.state.selected === msg.serial_no) {
			this.loadDetail(msg.serial_no);
		}
	}

	// -------------------------------------------------------------- data calls
	loadList(reset = false) {
		if (reset) {
			this.state.page = 1;
			this.state.data = [];
			this.state.rowsByCode.clear();
		}
		this.state.loading = true;
		frappe
			.call({
				method: "munzer_app.munzer_app.api.list_serials",
				args: {
					filters: JSON.stringify(this.state.filters),
					search: this.state.search,
					page: this.state.page,
					page_size: this.state.page_size,
				},
			})
			.then((r) => {
				const res = r.message || {};
				const rows = res.rows || [];
				this.state.data = reset ? rows : this.state.data.concat(rows);
				this.state.total = res.total || 0;
				this.state.facets = res.facets || {};
				rows.forEach((row) => this.state.rowsByCode.set(row.serial_no, row));
				this.renderList(!reset);
				this.state.loading = false;
			})
			.catch(() => {
				this.state.loading = false;
			});
	}

	loadDetail(serial_no) {
		this.state.detailLoading = true;
		this.renderDetail();
		frappe
			.call({
				method: "munzer_app.munzer_app.api.get_serial_detail",
				args: { serial_no },
			})
			.then((r) => {
				this.state.detail = r.message;
				this.state.detailLoading = false;
				this.renderDetail();
			})
			.catch(() => {
				this.state.detailLoading = false;
				this.state.detail = null;
				this.renderDetail();
			});
	}

	// -------------------------------------------------------------- selection
	selectRow(sn) {
		this.state.selected = sn;
		$(".iw-row", this.page.body).removeClass("selected");
		$(`.iw-row[data-sn="${sn}"]`, this.page.body).addClass("selected");
		this.loadDetail(sn);
	}

	// -------------------------------------------------------------- scan submit
	onScanSubmit(code) {
		if (!code) return;
		frappe
			.call({
				method: "munzer_app.munzer_app.api.quick_scan",
				args: { code },
			})
			.then((r) => {
				const res = r.message || {};
				const matches = res.matches || [];
				if (!matches.length) {
					frappe.show_alert({
						message: `${__("No match for")} ${code}`,
						indicator: "red",
					});
					return;
				}
				if (this.state.bulkMode) {
					matches.forEach((m) => this.state.selectedSet.add(m.serial_no));
					this.updateBulkBar();
					this.renderList();
					frappe.show_alert({
						message: `${matches.length} ${__("added to selection")}`,
						indicator: "green",
					});
				} else if (matches.length === 1) {
					this.selectRow(matches[0].serial_no);
					$("#iw-search").val("").trigger("focus");
				} else {
					// Many matches → load as a focused result list
					this.state.filters.scan_codes = matches.map((m) => m.serial_no).join("\n");
					this.renderFilterBar();
					this.loadList(true);
					$("#iw-search").val("").trigger("focus");
					frappe.show_alert({
						message: `${matches.length} ${__("matches")}`,
						indicator: "blue",
					});
				}
			});
	}

	// -------------------------------------------------------------- actions
	bulkChangeStatus(sns, status) {
		if (!sns || !sns.length) return;
		frappe
			.call({
				method: "munzer_app.munzer_app.api.bulk_change_status",
				args: { serial_nos: JSON.stringify(sns), status },
			})
			.then((r) => {
				const res = r.message || {};
				frappe.show_alert({
					message: `${res.updated || 0} ${__("updated")}`,
					indicator: "green",
				});
				if ((res.errors || []).length) {
					frappe.msgprint({
						title: __("Some updates failed"),
						message: `<pre>${JSON.stringify(res.errors, null, 2)}</pre>`,
					});
				}
				this.loadList(true);
				if (this.state.selected) this.loadDetail(this.state.selected);
			});
	}

	openBulkStatusMenu(anchor, sns) {
		const me = this;
		const dialog = new frappe.ui.Dialog({
			title: __("Change Status"),
			fields: [
				{
					fieldname: "status",
					fieldtype: "Select",
					label: __("New Status"),
					options: ALL_STATUSES.join("\n"),
					default: "Active",
					reqd: 1,
				},
			],
			primary_action_label: __("Apply to {0}", [sns.length]),
			primary_action: ({ status }) => {
				dialog.hide();
				me.bulkChangeStatus(sns, status);
			},
		});
		dialog.show();
	}

	openMoveDialog(sns) {
		if (!sns || !sns.length) return;
		const me = this;
		const dialog = new frappe.ui.Dialog({
			title: __("Move {0} serials", [sns.length]),
			fields: [
				{
					fieldname: "shelf_kind",
					fieldtype: "Select",
					label: __("Shelf Kind"),
					options: "\nPallet or Trolley\nShelf",
				},
				{
					fieldname: "location_name",
					fieldtype: "Dynamic Link",
					label: __("Location"),
					get_options: () => {
						return dialog.get_value("shelf_kind") === "Shelf"
							? "Shelf"
							: "Pallet or Trolley";
					},
				},
				{
					fieldname: "box",
					fieldtype: "Link",
					label: __("Box"),
					options: "Box",
				},
			],
			primary_action_label: __("Move"),
			primary_action: (vals) => {
				dialog.hide();
				frappe
					.call({
						method: "munzer_app.munzer_app.api.bulk_move_location",
						args: {
							serial_nos: JSON.stringify(sns),
							shelf_kind: vals.shelf_kind || null,
							location_name: vals.location_name || null,
							box: vals.box || null,
						},
					})
					.then((r) => {
						const res = r.message || {};
						frappe.show_alert({
							message: `${res.updated || 0} ${__("moved")}`,
							indicator: "green",
						});
						if ((res.errors || []).length) {
							frappe.msgprint({
								title: __("Some moves failed"),
								message: `<pre>${JSON.stringify(res.errors, null, 2)}</pre>`,
							});
						}
						me.loadList(true);
						if (me.state.selected) me.loadDetail(me.state.selected);
					});
			},
		});
		dialog.show();
	}

	printLabel(sn, silent = false) {
		if (!sn) return;
		frappe
			.call({
				method: "munzer_app.munzer_app.api.print_label_url",
				args: { serial_no: sn },
			})
			.then((r) => {
				const url = (r.message || {}).url;
				if (url) window.open(url, "_blank");
				else if (!silent) frappe.show_alert({ message: __("No print URL"), indicator: "red" });
			});
	}

	// -------------------------------------------------------------- filters dialog
	openFiltersDialog() {
		const f = this.state.filters;
		const me = this;
		const dialog = new frappe.ui.Dialog({
			title: __("Filters"),
			size: "large",
			fields: [
				{
					fieldname: "item_code",
					label: __("Item Code"),
					fieldtype: "MultiSelectList",
					default: f.item_code || [],
					get_data: (txt) => frappe.db.get_link_options("Item", txt),
				},
				{
					fieldname: "grade",
					label: __("Grade"),
					fieldtype: "MultiSelectList",
					default: f.grade || [],
					get_data: (txt) => frappe.db.get_link_options("Grade", txt),
				},
				{
					fieldname: "batch",
					label: __("Batch"),
					fieldtype: "MultiSelectList",
					default: f.batch || [],
					get_data: (txt) => frappe.db.get_link_options("Batch Number", txt),
				},
				{
					fieldname: "customer",
					label: __("Customer"),
					fieldtype: "MultiSelectList",
					default: f.customer || [],
					get_data: (txt) => frappe.db.get_link_options("Customer", txt),
				},
				{ fieldtype: "Column Break" },
				{
					fieldname: "shelf",
					label: __("Shelf Kind"),
					fieldtype: "Select",
					options: "\nPallet or Trolley\nShelf",
					default: (f.shelf || [])[0] || "",
				},
				{
					fieldname: "trolly_pallet",
					label: __("Pallet/Trolley"),
					fieldtype: "MultiSelectList",
					default: f.trolly_pallet || [],
					get_data: (txt) => frappe.db.get_link_options("Pallet or Trolley", txt),
				},
				{
					fieldname: "shelf_name",
					label: __("Shelf"),
					fieldtype: "MultiSelectList",
					default: f.shelf_name || [],
					get_data: (txt) => frappe.db.get_link_options("Shelf", txt),
				},
				{
					fieldname: "box",
					label: __("Box"),
					fieldtype: "MultiSelectList",
					default: f.box || [],
					get_data: (txt) => frappe.db.get_link_options("Box", txt),
				},
			],
			primary_action_label: __("Apply"),
			primary_action: (vals) => {
				const newF = { status: f.status || [] };
				for (const k of [
					"item_code",
					"grade",
					"batch",
					"customer",
					"trolly_pallet",
					"shelf_name",
					"box",
				]) {
					if (vals[k] && vals[k].length) newF[k] = vals[k];
				}
				if (vals.shelf) newF.shelf = [vals.shelf];
				if (f.scan_codes) newF.scan_codes = f.scan_codes;
				me.state.filters = newF;
				me.renderFilterBar();
				me.loadList(true);
				dialog.hide();
			},
		});
		dialog.show();
	}

	// -------------------------------------------------------------- export
	exportVisibleCSV() {
		const cols = [
			"serial_no",
			"item_code",
			"item_name",
			"status",
			"grade",
			"batch",
			"location_name",
			"box",
			"customer",
			"sales_invoice",
			"asin",
			"tracking_number",
			"sold_rate",
			"cost",
		];
		const escape = (v) => {
			if (v === null || v === undefined) return "";
			const s = String(v).replace(/"/g, '""');
			return /[",\n]/.test(s) ? `"${s}"` : s;
		};
		const head = cols.join(",");
		const body = this.state.data.map((r) => cols.map((c) => escape(r[c])).join(",")).join("\n");
		const blob = new Blob(["\uFEFF" + head + "\n" + body], { type: "text/csv;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		const ts = frappe.datetime.now_datetime().replace(/[: ]/g, "-");
		const a = document.createElement("a");
		a.href = url;
		a.download = `inventory-workstation_${ts}.csv`;
		document.body.appendChild(a);
		a.click();
		setTimeout(() => {
			URL.revokeObjectURL(url);
			a.remove();
		}, 100);
	}

	// -------------------------------------------------------------- focus helpers
	focusScanner() {
		const el = document.getElementById("iw-search");
		if (el) el.focus();
	}
}

// =============================================================================
// Styles — ORAS palette: navy gradient + red #E8173A
// =============================================================================
const STYLES = `
.munzer-iw .iw-root {
	display:flex; flex-direction:column;
	min-height: calc(100vh - 110px);
	background: linear-gradient(180deg,#0f1146 0%,#14176b 100%);
	color:#f3f4ff;
	border-radius:14px;
	border:1px solid rgba(232,23,58,0.18);
	overflow:hidden;
	font-family:-apple-system,Segoe UI,Roboto,sans-serif;
}
.munzer-iw .iw-topbar {
	display:flex; align-items:center; gap:10px;
	padding:10px 14px;
	background:rgba(15,17,70,0.65);
	border-bottom:1px solid rgba(232,23,58,0.2);
	backdrop-filter:blur(6px);
}
.munzer-iw .iw-search-wrap {
	flex:1; max-width:520px;
	display:flex; align-items:center; gap:6px;
	background:rgba(255,255,255,0.06);
	border:1px solid rgba(232,23,58,0.4);
	border-radius:10px;
	padding:0 10px;
	transition:all 0.15s ease;
}
.munzer-iw .iw-search-wrap:focus-within {
	border-color:#E8173A;
	box-shadow:0 0 0 4px rgba(232,23,58,0.18);
}
.munzer-iw .iw-search-icon { font-size:14px; opacity:0.7; }
.munzer-iw .iw-search {
	flex:1;
	background:transparent;
	border:none;
	padding:10px 4px;
	color:#fff;
	font-size:14px;
	letter-spacing:0.3px;
	outline:none;
}
.munzer-iw .iw-search::placeholder { color:rgba(255,255,255,0.45); }
.munzer-iw .iw-status-tabs { display:flex; gap:4px; flex-wrap:wrap; }
.munzer-iw .iw-tab {
	padding:6px 12px;
	border-radius:999px;
	background:rgba(255,255,255,0.06);
	color:#fff;
	border:1px solid rgba(255,255,255,0.1);
	font-size:12px;
	font-weight:600;
	cursor:pointer;
	display:inline-flex; align-items:center; gap:6px;
	transition:all 0.15s ease;
}
.munzer-iw .iw-tab:hover { background:rgba(232,23,58,0.18); }
.munzer-iw .iw-tab.active {
	background:linear-gradient(135deg,#E8173A 0%,#b3102b 100%);
	border-color:transparent;
	box-shadow:0 4px 12px rgba(232,23,58,0.35);
}
.munzer-iw .iw-tab-dot {
	width:8px; height:8px; border-radius:50%;
	background:var(--c,#64748b);
	display:inline-block;
}
.munzer-iw .iw-tab-count {
	background:rgba(0,0,0,0.25);
	padding:1px 6px;
	border-radius:6px;
	font-size:10px;
}
.munzer-iw .iw-spacer { flex:1; }
.munzer-iw .iw-btn {
	display:inline-flex; align-items:center; gap:6px;
	padding:7px 12px;
	border-radius:8px;
	background:linear-gradient(135deg,#E8173A 0%,#b3102b 100%);
	color:#fff;
	font-size:13px; font-weight:600;
	border:none;
	cursor:pointer;
	transition:all 0.15s ease;
}
.munzer-iw .iw-btn:hover { background:linear-gradient(135deg,#ff1f47 0%,#c7132f 100%); transform:translateY(-1px); }
.munzer-iw .iw-btn-ghost {
	background:rgba(255,255,255,0.06);
	color:#fff;
	border:1px solid rgba(232,23,58,0.4);
}
.munzer-iw .iw-btn-ghost:hover { background:rgba(232,23,58,0.18); transform:translateY(-1px); }
.munzer-iw .iw-btn-ghost.active { background:rgba(232,23,58,0.3); border-color:#E8173A; }
.munzer-iw .iw-bulk-pill { display:inline-flex; gap:4px; }
.munzer-iw .iw-bulk-pill b {
	background:rgba(232,23,58,0.7);
	padding:0 6px;
	border-radius:6px;
}

.munzer-iw .iw-filterbar {
	display:flex; flex-wrap:wrap; gap:6px; align-items:center;
	padding:8px 14px;
	background:rgba(15,17,70,0.4);
	border-bottom:1px solid rgba(232,23,58,0.15);
	min-height:36px;
	font-size:12px;
}
.munzer-iw .iw-chip {
	display:inline-flex; align-items:center; gap:6px;
	background:rgba(232,23,58,0.18);
	border:1px solid rgba(232,23,58,0.4);
	padding:3px 10px;
	border-radius:999px;
	color:#fff;
	font-weight:500;
}
.munzer-iw .iw-chip .x { cursor:pointer; opacity:0.7; }
.munzer-iw .iw-chip .x:hover { opacity:1; }
.munzer-iw .iw-chip-scan { background:rgba(34,197,94,0.18); border-color:rgba(34,197,94,0.4); }
.munzer-iw .iw-empty-chips { color:rgba(255,255,255,0.5); font-style:italic; }
.munzer-iw #iw-clear-chips { color:#ffd9e1; font-size:12px; margin-left:8px; }

.munzer-iw .iw-split { flex:1; display:grid; grid-template-columns: 1fr 1fr; min-height:0; }
@media (max-width: 1100px) { .munzer-iw .iw-split { grid-template-columns: 1fr; } }
.munzer-iw .iw-list-pane {
	display:flex; flex-direction:column;
	border-right:1px solid rgba(232,23,58,0.18);
	min-height:0;
	overflow:hidden;
}
.munzer-iw .iw-list-meta {
	display:flex; justify-content:space-between;
	padding:8px 14px;
	font-size:12px;
	color:rgba(255,255,255,0.7);
	border-bottom:1px solid rgba(255,255,255,0.05);
	background:rgba(15,17,70,0.4);
}
.munzer-iw .iw-list-meta a { color:#ffd9e1; }
.munzer-iw .iw-list { flex:1; overflow-y:auto; padding:8px 0; }
.munzer-iw .iw-list-sentinel { height:24px; }

.munzer-iw .iw-row {
	display:grid;
	grid-template-columns: 24px 56px 1fr;
	gap:10px;
	align-items:center;
	padding:10px 14px;
	border-left:3px solid transparent;
	border-bottom:1px solid rgba(255,255,255,0.04);
	cursor:pointer;
	transition:background 0.1s ease;
}
.munzer-iw .iw-row:hover { background:rgba(232,23,58,0.06); }
.munzer-iw .iw-row.selected {
	background:rgba(232,23,58,0.12);
	border-left-color:#E8173A;
}
.munzer-iw .iw-row-check { accent-color:#E8173A; cursor:pointer; }
.munzer-iw .iw-row-thumb {
	width:48px; height:48px; border-radius:8px;
	background:rgba(255,255,255,0.06);
	display:flex; align-items:center; justify-content:center;
	font-size:22px; overflow:hidden;
}
.munzer-iw .iw-row-thumb img { width:100%; height:100%; object-fit:cover; }
.munzer-iw .iw-row-main { min-width:0; }
.munzer-iw .iw-row-line1 {
	display:flex; gap:8px; align-items:center;
	font-weight:600;
	font-size:13px;
}
.munzer-iw .iw-row-sn { font-family:ui-monospace,Menlo,monospace; }
.munzer-iw .iw-row-line2 {
	font-size:12px;
	color:rgba(255,255,255,0.78);
	white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
	margin-top:2px;
}
.munzer-iw .iw-row-line3 {
	display:flex; gap:10px; flex-wrap:wrap;
	font-size:11px;
	color:rgba(255,255,255,0.6);
	margin-top:3px;
}
.munzer-iw .iw-row-loc.dim { color:rgba(255,255,255,0.35); font-style:italic; }
.munzer-iw .iw-badge {
	display:inline-block;
	padding:2px 8px;
	border-radius:999px;
	background:var(--bg,#64748b);
	color:#fff;
	font-size:10px;
	font-weight:700;
	letter-spacing:0.4px;
	text-transform:uppercase;
}
.munzer-iw .iw-grade-pill,
.munzer-iw .iw-meta-pill {
	display:inline-block;
	padding:1px 8px;
	border-radius:6px;
	background:rgba(232,23,58,0.18);
	color:#ffd1da;
	font-size:11px;
	font-weight:600;
}

.munzer-iw .iw-detail-pane {
	background:rgba(15,17,70,0.55);
	overflow-y:auto;
	min-height:0;
}
.munzer-iw .iw-detail-empty {
	display:flex; flex-direction:column; align-items:center; justify-content:center;
	height:100%;
	text-align:center;
	color:rgba(255,255,255,0.5);
	padding:40px;
}
.munzer-iw .iw-detail-empty-icon { font-size:48px; margin-bottom:14px; }
.munzer-iw .iw-detail-empty-title { font-size:16px; font-weight:600; color:rgba(255,255,255,0.8); }
.munzer-iw .iw-detail-empty-hint { font-size:13px; margin-top:6px; }
.munzer-iw .iw-detail-loading { padding:40px; text-align:center; color:rgba(255,255,255,0.6); }

.munzer-iw .iw-detail { padding:18px; }
.munzer-iw .iw-detail-head {
	display:grid;
	grid-template-columns: 80px 1fr auto;
	gap:14px;
	align-items:center;
	padding-bottom:14px;
	border-bottom:1px solid rgba(255,255,255,0.08);
}
.munzer-iw .iw-detail-thumb {
	width:80px; height:80px; border-radius:12px;
	background:rgba(255,255,255,0.06);
	display:flex; align-items:center; justify-content:center;
	font-size:32px; overflow:hidden;
}
.munzer-iw .iw-detail-thumb img { width:100%; height:100%; object-fit:cover; }
.munzer-iw .iw-detail-sn { font-family:ui-monospace,Menlo,monospace; font-weight:700; font-size:18px; }
.munzer-iw .iw-detail-item { font-size:13px; color:rgba(255,255,255,0.78); margin-top:2px; }
.munzer-iw .iw-detail-meta { display:flex; gap:6px; margin-top:8px; flex-wrap:wrap; }

.munzer-iw .iw-detail-grid {
	display:grid;
	grid-template-columns:repeat(auto-fit,minmax(200px,1fr));
	gap:12px;
	margin:18px 0;
}
.munzer-iw .iw-detail-grid > div {
	background:rgba(255,255,255,0.03);
	border:1px solid rgba(255,255,255,0.05);
	border-radius:8px;
	padding:8px 12px;
}
.munzer-iw .iw-k {
	display:block;
	font-size:10px;
	text-transform:uppercase;
	letter-spacing:1px;
	color:rgba(255,255,255,0.45);
	margin-bottom:2px;
}
.munzer-iw .iw-v {
	font-size:13px; color:#fff; font-weight:500;
	display:block; word-break:break-word;
}
.munzer-iw .iw-v a { color:#ffd9e1; }

.munzer-iw .iw-detail-actions-row {
	display:flex; gap:8px; flex-wrap:wrap;
	padding:14px 0;
	border-top:1px solid rgba(255,255,255,0.08);
}
.munzer-iw .iw-select {
	background:rgba(255,255,255,0.06);
	color:#fff;
	border:1px solid rgba(232,23,58,0.4);
	border-radius:8px;
	padding:7px 10px;
	font-size:13px;
	min-width:140px;
}

.munzer-iw .iw-detail-section { margin-top:18px; }
.munzer-iw .iw-detail-section-title {
	font-size:12px;
	text-transform:uppercase;
	letter-spacing:1.2px;
	color:rgba(255,255,255,0.55);
	margin-bottom:10px;
	font-weight:700;
}
.munzer-iw .iw-ledger {
	width:100%; border-collapse:collapse;
	font-size:12px;
	background:rgba(255,255,255,0.02);
	border-radius:8px;
	overflow:hidden;
}
.munzer-iw .iw-ledger th, .munzer-iw .iw-ledger td {
	padding:8px 10px;
	border-bottom:1px solid rgba(255,255,255,0.06);
	text-align:left;
}
.munzer-iw .iw-ledger th { color:rgba(255,255,255,0.6); font-weight:600; background:rgba(255,255,255,0.04); }
.munzer-iw .iw-ledger td.num { text-align:right; font-family:ui-monospace,Menlo,monospace; }
.munzer-iw .iw-ledger td.num.pos { color:#34d399; }
.munzer-iw .iw-ledger td.num.neg { color:#fb7185; }

.munzer-iw .iw-barcodes { display:flex; flex-wrap:wrap; gap:6px; }
.munzer-iw .iw-barcode-pill {
	background:rgba(255,255,255,0.06);
	border:1px solid rgba(232,23,58,0.3);
	border-radius:6px;
	padding:4px 10px;
	font-size:12px;
	font-family:ui-monospace,Menlo,monospace;
}

.munzer-iw .iw-bulkbar {
	position:sticky; bottom:0;
	display:flex; gap:8px; align-items:center;
	padding:10px 14px;
	background:rgba(232,23,58,0.18);
	border-top:1px solid rgba(232,23,58,0.4);
	backdrop-filter:blur(6px);
}
.munzer-iw .iw-bulkbar[hidden] { display:none; }
.munzer-iw .iw-bulkbar-count {
	font-size:13px;
	font-weight:600;
}
.munzer-iw .iw-bulkbar-count b {
	background:#E8173A;
	padding:2px 10px;
	border-radius:999px;
	margin-right:6px;
}
`;
