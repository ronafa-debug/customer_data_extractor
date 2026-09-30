import { formatOrderDate } from "../order/model/OrderBatch.js";
import { getOrderDatesWithProducts, getOrderProductsByDate, loadOrderBatches } from "../order/services/OrderHistoryStore.js";
import { calculateMarketplacePrices } from "./priceCalculator.js";
import { connectProductMapping, searchWholesaleCandidates } from "./productMappingService.js";
import { deleteProductMapping } from "./productMappingStore.js";
import { resolveOrderProductPricingRows } from "./orderProductPricingService.js";
import { createManualProduct, getAllProducts } from "./productPriceStore.js";

const STATUS_ORDER = { unmatched: 0, stale: 1, matched: 2 };
const STATUS_LABEL = { matched: "매칭완료", unmatched: "미매칭", stale: "연결끊김" };
const PLATFORM_LABEL = { naver: "네이버", coupang: "쿠팡" };
const won = new Intl.NumberFormat("ko-KR");

/** @param {object} product */
export function formatPricingProductName(product) {
  const name = String(product?.productName || "").trim();
  const spec = String(product?.specification || "").trim();
  return spec && !name.toLocaleLowerCase("ko-KR").includes(spec.toLocaleLowerCase("ko-KR"))
    ? `${name} ${spec}`
    : name;
}

/**
 * @param {HTMLElement} host
 * @param {{onProductsChanged?:() => void|Promise<void>}} [options]
 */
export function renderOrderProductPricingPanel(host, options = {}) {
  let alive = true;
  let historyCount = 0;
  let dateSummaries = [];
  let selectedDateKey = "";
  let orderProducts = [];
  let pricing = { items: [], matchedCount: 0, unmatchedCount: 0, staleCount: 0 };
  let activeFilter = "all";
  let activeRow = null;
  let activeSource = null;
  let productCount = 0;
  let searchSequence = 0;
  const cleanups = [];

  host.innerHTML = `
    <section class="panel order-price-panel">
      <div class="order-price-heading">
        <div><h2 class="result-title">주문제품 가격표</h2><p class="order-price-description">연결된 동일 제품은 하나로 통합하고, 판매 플랫폼은 전체 Mapping DB를 기준으로 표시합니다.</p></div>
        <label class="order-price-date-label" for="orderPriceDate">주문 날짜<select id="orderPriceDate" class="form-select form-select-sm" disabled><option>불러오는 중…</option></select></label>
      </div>
      <div id="orderPricingNotice" class="order-pricing-notice d-none" role="status"></div>
      <div id="orderPriceFilters" class="order-price-filters d-none">
        <button type="button" class="btn btn-sm is-active" data-price-filter="all">전체 <span data-filter-count="all">0</span></button>
        <button type="button" class="btn btn-sm" data-price-filter="matched">매칭완료 <span data-filter-count="matched">0</span></button>
        <button type="button" class="btn btn-sm" data-price-filter="unmatched">미매칭 <span data-filter-count="unmatched">0</span></button>
        <button type="button" class="btn btn-sm" data-price-filter="stale">연결끊김 <span data-filter-count="stale">0</span></button>
      </div>
      <div id="orderPriceTableWrap" class="price-table-wrap order-price-table-wrap d-none">
        <table class="price-table order-price-table"><thead><tr><th>상품명</th><th>플랫폼</th><th class="price-num">매입가</th><th class="price-num">네이버 판매가</th><th class="price-num">쿠팡 판매가</th><th>매칭상태</th><th>관리</th></tr></thead><tbody id="orderPriceTableBody"></tbody></table>
      </div>
    </section>
    <dialog id="productMappingDialog" class="product-mapping-dialog">
      <div class="product-mapping-header"><div><h2>상품 연결 관리</h2><p id="mappingProductTitle" class="product-mapping-platform"></p></div><button type="button" class="btn btn-outline-secondary btn-sm" data-close-mapping>닫기</button></div>
      <div id="mappingEntries" class="product-mapping-entries"></div>
      <section id="mappingSearchSection" class="product-mapping-search-section d-none">
        <div id="mappingSelectedSource" class="product-mapping-order"></div>
        <label class="product-mapping-search-label" for="mappingSearch">제품DB 검색</label>
        <input type="search" id="mappingSearch" class="form-control" autocomplete="off" placeholder="제품명 또는 규격 검색" />
        <div id="mappingCandidates" class="product-mapping-candidates"></div>
        <div class="manual-product-entry"><span>찾는 제품이 없나요?</span><button type="button" class="btn btn-outline-primary btn-sm" id="openManualProductBtn">+ 제품 직접 등록</button></div>
      </section>
      <div class="product-mapping-footer"><button type="button" class="btn btn-outline-secondary btn-sm" data-close-mapping>닫기</button></div>
    </dialog>
    <dialog id="manualConnectDialog" class="product-mapping-dialog manual-product-dialog">
      <div class="product-mapping-header"><h2>제품 직접 등록</h2><button type="button" class="btn btn-outline-secondary btn-sm" data-close-manual>닫기</button></div>
      <form id="manualConnectForm" class="manual-product-form">
        <label>제품명 *<input id="manualConnectName" class="form-control" required /></label>
        <label>규격<input id="manualConnectSpec" class="form-control" /></label>
        <label>매입가 *<input id="manualConnectPrice" class="form-control" inputmode="numeric" required /></label>
        <div id="manualPricePreview" class="manual-price-preview">매입가를 입력하면 판매가가 표시됩니다.</div>
        <div id="manualConnectError" class="text-danger small"></div>
        <div class="product-mapping-footer"><button type="button" class="btn btn-outline-secondary" data-close-manual>취소</button><button type="submit" class="btn btn-primary">등록하고 연결</button></div>
      </form>
    </dialog>`;

  const get = (selector) => host.querySelector(selector);
  const dateSelect = get("#orderPriceDate");
  const notice = get("#orderPricingNotice");
  const filters = get("#orderPriceFilters");
  const tableWrap = get("#orderPriceTableWrap");
  const tableBody = get("#orderPriceTableBody");
  const mappingDialog = get("#productMappingDialog");
  const entriesBox = get("#mappingEntries");
  const searchSection = get("#mappingSearchSection");
  const selectedSourceBox = get("#mappingSelectedSource");
  const mappingSearch = get("#mappingSearch");
  const candidatesBox = get("#mappingCandidates");
  const manualDialog = get("#manualConnectDialog");
  const manualForm = get("#manualConnectForm");
  const manualName = get("#manualConnectName");
  const manualSpec = get("#manualConnectSpec");
  const manualPrice = get("#manualConnectPrice");
  const manualPreview = get("#manualPricePreview");
  const manualError = get("#manualConnectError");

  function on(target, event, handler) {
    target?.addEventListener(event, handler);
    cleanups.push(() => target?.removeEventListener(event, handler));
  }

  function setNotice(message, type = "info") {
    notice.textContent = message;
    notice.className = `order-pricing-notice is-${type}`;
  }

  function price(value) {
    return Number(value) > 0 ? `${won.format(Number(value))}원` : "—";
  }

  function cell(value, className = "") {
    const node = document.createElement("td");
    node.textContent = String(value ?? "");
    if (className) node.className = className;
    return node;
  }

  function renderDates() {
    dateSelect.replaceChildren();
    if (!dateSummaries.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "선택할 날짜 없음";
      dateSelect.appendChild(option);
      dateSelect.disabled = true;
      return;
    }
    for (const item of dateSummaries) {
      const option = document.createElement("option");
      option.value = item.dateKey;
      option.textContent = `${formatOrderDate(item.dateKey)} · 상품 ${item.productCount}개`;
      dateSelect.appendChild(option);
    }
    dateSelect.disabled = false;
    dateSelect.value = selectedDateKey;
  }

  function productName(row) {
    return row.status === "matched"
      ? formatPricingProductName(row.targetProduct || row.wholesaleProduct)
      : row.orderProduct.displayProductName || row.orderProduct.rawProductName || "—";
  }

  function renderTable() {
    const counts = { all: pricing.items.length, matched: pricing.matchedCount, unmatched: pricing.unmatchedCount, stale: pricing.staleCount };
    host.querySelectorAll("[data-filter-count]").forEach((node) => { node.textContent = String(counts[node.dataset.filterCount] || 0); });
    host.querySelectorAll("[data-price-filter]").forEach((button) => button.classList.toggle("is-active", button.dataset.priceFilter === activeFilter));
    const visible = pricing.items.map((item, index) => ({ item, index }))
      .filter(({ item }) => activeFilter === "all" || item.status === activeFilter)
      .sort((a, b) => STATUS_ORDER[a.item.status] - STATUS_ORDER[b.item.status] || a.index - b.index)
      .map(({ item }) => item);
    tableBody.replaceChildren();
    if (!visible.length) {
      const row = document.createElement("tr");
      const empty = cell("선택한 상태의 상품이 없습니다.", "price-empty-row");
      empty.colSpan = 7;
      row.appendChild(empty);
      tableBody.appendChild(row);
    }
    for (const item of visible) {
      const row = document.createElement("tr");
      row.dataset.pricingRow = item.platformProductKey;
      const nameCell = cell(productName(item));
      nameCell.title = item.sourceOrderProducts.map((product) => product.rawProductName).filter(Boolean).join(" / ");
      const platformCell = document.createElement("td");
      for (const platformName of item.salesPlatforms) {
        const badge = document.createElement("span");
        badge.className = `order-platform-badge is-${platformName}`;
        badge.textContent = PLATFORM_LABEL[platformName] || platformName;
        platformCell.appendChild(badge);
      }
      const statusCell = document.createElement("td");
      const status = document.createElement("span");
      status.className = `order-match-badge is-${item.status}`;
      status.textContent = STATUS_LABEL[item.status];
      statusCell.appendChild(status);
      const actionCell = document.createElement("td");
      const action = document.createElement("button");
      action.type = "button";
      action.className = "btn btn-outline-primary btn-sm order-map-button";
      action.dataset.manageRow = item.platformProductKey;
      action.textContent = item.status === "matched" ? "관리" : item.status === "stale" ? "다시 연결" : "상품 연결";
      actionCell.appendChild(action);
      row.append(
        nameCell,
        platformCell,
        cell(price(item.prices?.purchasePrice), "price-num"),
        cell(price(item.prices?.naverPrice), "price-num price-col-naver"),
        cell(price(item.prices?.coupangPrice), "price-num price-col-coupang"),
        statusCell,
        actionCell
      );
      tableBody.appendChild(row);
    }
  }

  function render() {
    const hasRows = dateSummaries.length && orderProducts.length;
    filters.classList.toggle("d-none", !hasRows);
    tableWrap.classList.toggle("d-none", !hasRows);
    if (!dateSummaries.length) {
      setNotice(historyCount ? "저장된 주문상품이 없습니다. 기존 저장 기록에는 상품 식별정보가 포함되지 않았습니다." : "저장된 주문내역이 없습니다. 주문내역 고객정보 추출기에서 주문을 저장해주세요.");
      return;
    }
    if (!orderProducts.length) {
      setNotice("선택한 날짜에 저장된 주문상품이 없습니다.");
      return;
    }
    if (!productCount) setNotice("등록된 제품이 없습니다. 상품 연결에서 제품을 직접 등록할 수 있습니다.", "warning");
    else notice.classList.add("d-none");
    renderTable();
  }

  async function refreshPricing() {
    if (!selectedDateKey) {
      orderProducts = [];
      pricing = { items: [], matchedCount: 0, unmatchedCount: 0, staleCount: 0 };
    } else {
      orderProducts = await getOrderProductsByDate(selectedDateKey);
      pricing = await resolveOrderProductPricingRows(orderProducts);
    }
    if (alive) render();
  }

  async function loadDates() {
    const [batches, dates] = await Promise.all([loadOrderBatches(), getOrderDatesWithProducts()]);
    historyCount = batches.length;
    dateSummaries = dates;
    if (!dates.some((item) => item.dateKey === selectedDateKey)) selectedDateKey = dates[0]?.dateKey || "";
    if (!alive) return;
    renderDates();
    await refreshPricing();
  }

  async function refreshProductDatabase() {
    productCount = (await getAllProducts()).length;
    if (alive) await refreshPricing();
  }

  function sourceCard(entry) {
    const card = document.createElement("div");
    card.className = "mapping-source-card";
    const badge = document.createElement("span");
    badge.className = `order-platform-badge is-${entry.orderProduct.platform}`;
    badge.textContent = PLATFORM_LABEL[entry.orderProduct.platform] || entry.orderProduct.platform;
    const name = document.createElement("strong");
    name.textContent = entry.orderProduct.rawProductName || entry.orderProduct.displayProductName || "—";
    const option = document.createElement("span");
    option.textContent = `옵션: ${entry.orderProduct.rawOptionName || "—"}`;
    const actions = document.createElement("div");
    actions.className = "mapping-source-actions";
    const change = document.createElement("button");
    change.type = "button";
    change.className = "btn btn-outline-primary btn-sm";
    change.dataset.changeMapping = entry.mapping?.platformProductKey || activeRow.platformProductKeys[0];
    change.textContent = entry.mapping ? "변경" : "상품 연결";
    actions.appendChild(change);
    if (entry.mapping) {
      const unlink = document.createElement("button");
      unlink.type = "button";
      unlink.className = "btn btn-outline-danger btn-sm";
      unlink.dataset.unlinkMapping = entry.mapping.platformProductKey;
      unlink.textContent = "연결 해제";
      actions.appendChild(unlink);
    }
    card.append(badge, name, option, actions);
    return card;
  }

  function findSource(key) {
    const entry = activeRow.mappingEntries.find((item) => item.mapping?.platformProductKey === key);
    if (entry) return entry.orderProduct;
    const index = activeRow.platformProductKeys.indexOf(key);
    return activeRow.sourceOrderProducts[index] || activeRow.sourceOrderProducts[0];
  }

  async function showSearch(orderProduct) {
    activeSource = orderProduct;
    selectedSourceBox.replaceChildren();
    const label = document.createElement("strong");
    label.textContent = `${PLATFORM_LABEL[orderProduct.platform] || orderProduct.platform} 쇼핑몰 상품`;
    const name = document.createElement("span");
    name.textContent = orderProduct.rawProductName || orderProduct.displayProductName || "—";
    const option = document.createElement("small");
    option.textContent = `옵션: ${orderProduct.rawOptionName || "—"}`;
    selectedSourceBox.append(label, name, option);
    searchSection.classList.remove("d-none");
    mappingSearch.value = orderProduct.displayProductName || orderProduct.rawProductName || "";
    await searchCandidates();
  }

  async function openManage(row) {
    activeRow = row;
    activeSource = null;
    get("#mappingProductTitle").textContent = productName(row);
    entriesBox.replaceChildren();
    const entries = row.mappingEntries.length
      ? row.mappingEntries
      : [{ mapping: null, orderProduct: row.sourceOrderProducts[0] }];
    entries.forEach((entry) => entriesBox.appendChild(sourceCard(entry)));
    searchSection.classList.add("d-none");
    mappingDialog.showModal();
    if (row.status !== "matched") await showSearch(entries[0].orderProduct);
  }

  function renderCandidates(items, loading = false) {
    candidatesBox.replaceChildren();
    if (loading) { candidatesBox.textContent = "검색 중입니다…"; return; }
    if (!items.length) { candidatesBox.textContent = "검색 결과가 없습니다."; return; }
    for (const product of items.slice(0, 50)) {
      const row = document.createElement("div");
      row.className = "product-mapping-candidate";
      const info = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = product.productName;
      const detail = document.createElement("span");
      detail.textContent = `${product.specification || "규격 없음"} · ${price(product.purchasePrice)}`;
      const source = document.createElement("em");
      source.className = `product-source-badge is-${product.source}`;
      source.textContent = product.source === "manual" ? "직접등록" : "회원2가";
      info.append(name, detail, source);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-primary btn-sm";
      button.dataset.connectProduct = product.id;
      button.textContent = "연결";
      row.append(info, button);
      candidatesBox.appendChild(row);
    }
  }

  async function searchCandidates() {
    if (!activeSource) return;
    const sequence = ++searchSequence;
    renderCandidates([], true);
    try {
      const items = await searchWholesaleCandidates(activeSource, mappingSearch.value);
      if (alive && sequence === searchSequence) renderCandidates(items);
    } catch (error) {
      console.error("[product-price] search:", error);
      candidatesBox.textContent = "제품 검색 중 오류가 발생했습니다.";
    }
  }

  function closeMapping() {
    searchSequence += 1;
    activeRow = null;
    activeSource = null;
    if (mappingDialog.open) mappingDialog.close();
  }

  async function connect(productId, button) {
    if (!activeSource) return;
    button.disabled = true;
    try {
      await connectProductMapping(activeSource, productId);
      closeMapping();
      await refreshPricing();
    } catch (error) {
      candidatesBox.textContent = error?.message || "상품을 연결하지 못했습니다.";
      button.disabled = false;
    }
  }

  async function unlink(key) {
    if (!window.confirm("이 쇼핑몰 상품의 연결을 해제할까요?")) return;
    await deleteProductMapping(key);
    closeMapping();
    await refreshPricing();
  }

  function updateManualPreview() {
    const value = Number(String(manualPrice.value).replace(/[,₩원\s]/g, ""));
    if (!(value > 0)) {
      manualPreview.textContent = "매입가를 입력하면 판매가가 표시됩니다.";
      return;
    }
    const prices = calculateMarketplacePrices(value);
    manualPreview.textContent = `네이버 판매가 ${price(prices.naverPrice)} · 쿠팡 판매가 ${price(prices.coupangPrice)}`;
  }

  function openManual() {
    if (!activeSource) return;
    manualForm.reset();
    manualName.value = activeSource.displayProductName || activeSource.rawProductName || "";
    manualError.textContent = "";
    updateManualPreview();
    manualDialog.showModal();
  }

  async function registerAndConnect(event) {
    event.preventDefault();
    manualError.textContent = "";
    try {
      const product = await createManualProduct({ productName: manualName.value, specification: manualSpec.value, purchasePrice: manualPrice.value });
      await connectProductMapping(activeSource, product.id);
      if (manualDialog.open) manualDialog.close();
      closeMapping();
      productCount += 1;
      await refreshPricing();
      await options.onProductsChanged?.();
    } catch (error) {
      manualError.textContent = error?.message || "직접등록 제품을 저장하지 못했습니다.";
    }
  }

  on(dateSelect, "change", async () => { selectedDateKey = dateSelect.value; activeFilter = "all"; await refreshPricing(); });
  on(mappingSearch, "input", searchCandidates);
  on(get("#openManualProductBtn"), "click", openManual);
  on(manualPrice, "input", updateManualPreview);
  on(manualForm, "submit", registerAndConnect);
  on(mappingDialog, "cancel", (event) => { event.preventDefault(); closeMapping(); });
  on(manualDialog, "cancel", (event) => { event.preventDefault(); manualDialog.close(); });
  on(host, "click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.priceFilter) { activeFilter = button.dataset.priceFilter; renderTable(); }
    else if (button.dataset.manageRow) {
      const row = pricing.items.find((item) => item.platformProductKey === button.dataset.manageRow);
      if (row) openManage(row);
    } else if (button.dataset.changeMapping) showSearch(findSource(button.dataset.changeMapping));
    else if (button.dataset.unlinkMapping) unlink(button.dataset.unlinkMapping);
    else if (button.dataset.connectProduct) connect(button.dataset.connectProduct, button);
    else if ("closeMapping" in button.dataset) closeMapping();
    else if ("closeManual" in button.dataset && manualDialog.open) manualDialog.close();
  });

  Promise.all([loadDates(), refreshProductDatabase()]).catch((error) => {
    console.error("[product-price] pricing panel:", error);
    setNotice("주문상품 가격정보를 불러오지 못했습니다.", "error");
  });

  return {
    cleanup() {
      alive = false;
      searchSequence += 1;
      cleanups.splice(0).forEach((cleanup) => cleanup());
      if (mappingDialog.open) mappingDialog.close();
      if (manualDialog.open) manualDialog.close();
    },
    refreshProductDatabase,
  };
}
