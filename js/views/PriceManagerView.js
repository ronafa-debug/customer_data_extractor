/** 회원2가 제품DB 관리 화면 */
import { go } from "../router/Router.js";
import { renderOrderProductPricingPanel } from "../price/OrderProductPricingPanel.js";
import { loadExcelFile } from "../order/services/ExcelService.js";
import { calculateMarketplacePrices } from "../price/priceCalculator.js";
import { parseWholesaleWorkbook } from "../price/parseWholesaleWorkbook.js";
import { searchWholesaleProducts } from "../price/productNormalizer.js";
import {
  deleteManualProduct,
  loadProductPriceDatabase,
  replaceProductPriceDatabase,
  updateManualProduct,
} from "../price/productPriceStore.js";
import { getAllProductMappings } from "../price/productMappingStore.js";

import { renderProductPriceBackupPanel } from '../price/ProductPriceBackupPanel.js'

const PAGE_SIZE = 50;
const won = new Intl.NumberFormat("ko-KR");

/** @param {HTMLElement} root @returns {() => void} */
export function renderPriceManagerView(root) {
  let products = [];
  let manualProducts = [];
  let metadata = null;
  let page = 1;
  let sourceFilter = "all";
  let importing = false;
  let alive = true;
  let pricingPanel = null;

  root.innerHTML = `
    <div class="tool-shell">
      <div class="tool-topbar">
        <button type="button" class="btn btn-outline-secondary btn-sm" id="backHomeBtn">← 홈</button>
        <div class="tool-topbar-brand"><h1 class="tool-page-title">제품가격관리</h1><p class="tool-page-sub">회원2가 제품DB를 등록하면 주문 상품의 매입가와 네이버·쿠팡 판매가격을 자동으로 확인할 수 있습니다.</p></div>
        <button type="button" id="themeToggle" class="btn btn-theme" aria-label="다크모드 전환"><span class="theme-icon" aria-hidden="true">◐</span></button>
      </div>
      <section class="panel" id="productDbStatusPanel">
        <div class="result-header"><h2 class="result-title">회원2가 제품DB</h2><button type="button" class="btn btn-primary btn-sm" id="productDbUploadBtn">제품DB 업로드</button></div>
        <input type="file" id="productDbFileInput" accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden />
        <div id="productDbStatus" class="product-db-status">제품DB를 불러오는 중입니다…</div>
        <div id="productDbImportSummary" class="product-db-import-summary d-none"></div>
      </section>
      <div id="priceAlert" class="alert-box d-none" role="status" aria-live="polite"></div>
      <div id="productPriceBackupHost"></div>
      <div id="orderProductPricingHost"></div>
      <section id="productDbListPanel" class="panel d-none">
        <div class="result-header"><h2 class="result-title">전체 제품DB 관리</h2><span id="productDbCount" class="result-count"></span></div>
        <div id="productSourceFilters" class="order-price-filters product-source-filters">
          <button type="button" class="btn btn-sm is-active" data-source-filter="all">전체 제품</button>
          <button type="button" class="btn btn-sm" data-source-filter="wholesale">회원2가 제품</button>
          <button type="button" class="btn btn-sm" data-source-filter="manual">직접등록 제품</button>
        </div>
        <div class="price-search-row" role="search"><input type="search" id="productDbSearch" class="form-control search-input" placeholder="제품명 또는 규격 검색" autocomplete="off" /><span id="productDbSearchMeta" class="price-search-meta"></span></div>
        <div class="price-table-wrap"><table class="price-table product-db-table"><thead><tr><th>제품명</th><th>규격</th><th class="price-num">매입가</th><th class="price-num">네이버 판매가</th><th class="price-num">쿠팡 판매가</th><th>구분</th><th>관리</th></tr></thead><tbody id="productDbTableBody"></tbody></table></div>
        <div class="product-db-pagination"><button type="button" id="productDbPrev" class="btn btn-outline-secondary btn-sm">이전</button><span id="productDbPageMeta"></span><button type="button" id="productDbNext" class="btn btn-outline-secondary btn-sm">다음</button></div>
      </section>
    </div>
    <dialog id="manualEditDialog" class="product-mapping-dialog manual-product-dialog">
      <div class="product-mapping-header"><h2>직접등록 제품 수정</h2><button type="button" class="btn btn-outline-secondary btn-sm" data-close-manual-edit>닫기</button></div>
      <form id="manualEditForm" class="manual-product-form">
        <input type="hidden" id="manualEditId" />
        <label>제품명 *<input id="manualEditName" class="form-control" required /></label>
        <label>규격<input id="manualEditSpec" class="form-control" /></label>
        <label>매입가 *<input id="manualEditPrice" class="form-control" inputmode="numeric" required /></label>
        <div id="manualEditPreview" class="manual-price-preview"></div>
        <div id="manualEditError" class="text-danger small"></div>
        <div class="product-mapping-footer"><button type="button" class="btn btn-outline-secondary" data-close-manual-edit>취소</button><button type="submit" class="btn btn-primary">수정 저장</button></div>
      </form>
    </dialog>`;

  const get = (selector) => root.querySelector(selector);
  const status = get("#productDbStatus");
  const summary = get("#productDbImportSummary");
  const alertBox = get("#priceAlert");
  const uploadBtn = get("#productDbUploadBtn");
  const fileInput = get("#productDbFileInput");
  const listPanel = get("#productDbListPanel");
  const count = get("#productDbCount");
  const searchInput = get("#productDbSearch");
  const searchMeta = get("#productDbSearchMeta");
  const tableBody = get("#productDbTableBody");
  const prev = get("#productDbPrev");
  const next = get("#productDbNext");
  const pageMeta = get("#productDbPageMeta");
  const editDialog = get("#manualEditDialog");
  const editForm = get("#manualEditForm");
  pricingPanel = renderOrderProductPricingPanel(get("#orderProductPricingHost"), { onProductsChanged: reloadDatabase });

  const cleanupBackup = renderProductPriceBackupPanel(get('#productPriceBackupHost'), { onMerged: async () => { await reloadDatabase(); await pricingPanel.refreshProductDatabase(); } });

  function showAlert(message, type = "info") { alertBox.textContent = message; alertBox.className = `alert-box is-${type}`; }
  function formatImportedAt(value) { return value ? new Date(value).toLocaleString("ko-KR") : ""; }

  function renderStatus() {
    if (!metadata) {
      status.textContent = products.length ? `회원2가 제품 ${products.length.toLocaleString("ko-KR")}개 (등록 파일 정보 없음)` : "제품DB가 등록되지 않았습니다.";
      uploadBtn.textContent = "제품DB 업로드";
      listPanel.classList.toggle("d-none", !products.length && !manualProducts.length);
      return;
    }
    status.replaceChildren();
    const lines = [["파일", metadata.fileName], ["제품", `${Number(metadata.productCount || products.length).toLocaleString("ko-KR")}개`], ["업데이트", formatImportedAt(metadata.importedAt)]];
    for (const [label, value] of lines) { const line = document.createElement("p"); const strong = document.createElement("strong"); strong.textContent = `${label}: `; line.append(strong, document.createTextNode(value)); status.appendChild(line); }
    uploadBtn.textContent = "제품DB 업데이트";
    listPanel.classList.toggle("d-none", !products.length && !manualProducts.length);
  }

  function renderImportSummary(imported) {
    summary.replaceChildren();
    const text = document.createElement("p");
    text.textContent = `등록 제품 ${imported.products.length.toLocaleString("ko-KR")}개 · 제외 ${imported.excludedCount.toLocaleString("ko-KR")}개 · 중복 제외 ${imported.duplicateCount.toLocaleString("ko-KR")}행`;
    summary.appendChild(text);
    if (imported.duplicates.length) {
      const details = document.createElement("details"); const title = document.createElement("summary"); title.textContent = `중복 제품 ${imported.duplicates.length}개 그룹 확인`; const list = document.createElement("ul");
      imported.duplicates.slice(0, 20).forEach((item) => { const row = document.createElement("li"); row.textContent = `${item.productName} / ${item.specification || "규격 없음"} (행 ${item.rowNumbers.join(", ")})`; list.appendChild(row); });
      if (imported.duplicates.length > 20) { const more = document.createElement("li"); more.textContent = `외 ${imported.duplicates.length - 20}개 그룹`; list.appendChild(more); }
      details.append(title, list); summary.appendChild(details);
    }
    summary.classList.remove("d-none");
  }

  function renderProducts() {
    const sourceProducts = sourceFilter === "wholesale"
      ? products
      : sourceFilter === "manual"
        ? manualProducts
        : [...products, ...manualProducts];
    const filtered = searchWholesaleProducts(sourceProducts, searchInput.value);
    const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    page = Math.min(Math.max(page, 1), pageCount);
    const start = (page - 1) * PAGE_SIZE;
    const visible = filtered.slice(start, start + PAGE_SIZE);
    tableBody.replaceChildren();
    if (!visible.length) { const row = document.createElement("tr"); const cell = document.createElement("td"); cell.colSpan = 7; cell.className = "price-empty-row"; cell.textContent = searchInput.value ? "검색 결과가 없습니다." : "등록된 제품이 없습니다."; row.appendChild(cell); tableBody.appendChild(row); }
    for (const product of visible) {
      const sale = calculateMarketplacePrices(product.purchasePrice);
      const row = document.createElement("tr");
      [product.productName, product.specification || "—", `${won.format(product.purchasePrice)}원`, `${won.format(sale.naverPrice)}원`, `${won.format(sale.coupangPrice)}원`].forEach((value, index) => { const cell = document.createElement("td"); cell.textContent = value; if (index >= 2) cell.className = "price-num"; row.appendChild(cell); });
      const sourceCell = document.createElement("td");
      const sourceBadge = document.createElement("span");
      sourceBadge.className = `product-source-badge is-${product.source}`;
      sourceBadge.textContent = product.source === "manual" ? "직접등록" : "회원2가";
      sourceCell.appendChild(sourceBadge);
      const actionCell = document.createElement("td");
      if (product.source === "manual") {
        const edit = document.createElement("button"); edit.type = "button"; edit.className = "btn btn-outline-primary btn-sm"; edit.dataset.editManual = product.id; edit.textContent = "수정";
        const del = document.createElement("button"); del.type = "button"; del.className = "btn btn-outline-danger btn-sm"; del.dataset.deleteManual = product.id; del.textContent = "삭제";
        actionCell.className = "product-db-actions"; actionCell.append(edit, del);
      } else actionCell.textContent = "—";
      row.append(sourceCell, actionCell);
      tableBody.appendChild(row);
    }
    count.textContent = `${sourceProducts.length.toLocaleString("ko-KR")}개`;
    searchMeta.textContent = searchInput.value ? `${filtered.length.toLocaleString("ko-KR")}건` : "";
    pageMeta.textContent = `${page} / ${pageCount} 페이지`;
    prev.disabled = page <= 1; next.disabled = page >= pageCount;
  }

  async function reloadDatabase() {
    const loaded = await loadProductPriceDatabase();
    products = loaded.products;
    manualProducts = loaded.manualProducts;
    metadata = loaded.metadata;
    if (!alive) return;
    renderStatus();
    if (products.length || metadata || manualProducts.length) renderProducts();
  }

  function updateEditPreview() {
    const amount = Number(String(get("#manualEditPrice").value).replace(/[,₩원\s]/g, ""));
    if (!(amount > 0)) { get("#manualEditPreview").textContent = "매입가를 입력해주세요."; return; }
    const prices = calculateMarketplacePrices(amount);
    get("#manualEditPreview").textContent = `네이버 판매가 ${won.format(prices.naverPrice)}원 · 쿠팡 판매가 ${won.format(prices.coupangPrice)}원`;
  }

  function openManualEdit(id) {
    const product = manualProducts.find((item) => item.id === id);
    if (!product) return;
    get("#manualEditId").value = product.id;
    get("#manualEditName").value = product.productName;
    get("#manualEditSpec").value = product.specification;
    get("#manualEditPrice").value = product.purchasePrice;
    get("#manualEditError").textContent = "";
    updateEditPreview();
    editDialog.showModal();
  }

  async function saveManualEdit(event) {
    event.preventDefault();
    try {
      await updateManualProduct(get("#manualEditId").value, { productName: get("#manualEditName").value, specification: get("#manualEditSpec").value, purchasePrice: get("#manualEditPrice").value });
      editDialog.close();
      await reloadDatabase();
      await pricingPanel.refreshProductDatabase();
      showAlert("직접등록 제품을 수정하고 연결된 가격을 갱신했습니다.", "success");
    } catch (error) {
      get("#manualEditError").textContent = error?.message || "제품을 수정하지 못했습니다.";
    }
  }

  async function removeManualProduct(id) {
    const mappings = (await getAllProductMappings()).filter((mapping) => mapping.wholesaleProductId === id);
    const message = mappings.length
      ? `이 제품에는 쇼핑몰 상품 ${mappings.length}개가 연결되어 있습니다.\n제품을 삭제하면 해당 상품의 연결이 끊어진 상태가 됩니다.\n\n삭제할까요?`
      : "이 직접등록 제품을 삭제할까요?";
    if (!window.confirm(message)) return;
    await deleteManualProduct(id);
    await reloadDatabase();
    await pricingPanel.refreshProductDatabase();
    showAlert("직접등록 제품을 삭제했습니다. 기존 mapping은 유지됩니다.", "success");
  }

  async function importFile(file) {
    if (importing || !file) return;
    importing = true; uploadBtn.disabled = true; summary.classList.add("d-none"); showAlert("회원2가 제품DB를 읽는 중입니다…", "info");
    try {
      const workbook = await loadExcelFile(file);
      const imported = parseWholesaleWorkbook(workbook);
      await replaceProductPriceDatabase(imported.products, { fileName: file.name, importedAt: Date.now(), productCount: imported.products.length, excludedCount: imported.excludedCount, duplicateCount: imported.duplicateCount });
      products = imported.products.map((item) => ({ ...item, source: "wholesale" }));
      metadata = { fileName: file.name, importedAt: Date.now(), productCount: imported.products.length, excludedCount: imported.excludedCount, duplicateCount: imported.duplicateCount };
      page = 1; searchInput.value = "";
      renderStatus(); renderProducts(); renderImportSummary(imported);
      await pricingPanel.refreshProductDatabase();
      showAlert(`제품DB 업데이트 완료 — 제품 ${imported.products.length.toLocaleString("ko-KR")}개를 저장했습니다.`, "success");
    } catch (error) {
      console.error("[product-price] import:", error);
      showAlert(error?.message || "제품DB를 가져오지 못했습니다. 기존 제품DB는 유지됩니다.", "error");
    } finally { importing = false; uploadBtn.disabled = false; fileInput.value = ""; }
  }

  uploadBtn.addEventListener("click", () => { if (!importing) fileInput.click(); });
  fileInput.addEventListener("change", () => importFile(fileInput.files?.[0]));
  searchInput.addEventListener("input", () => { page = 1; renderProducts(); });
  get("#manualEditPrice").addEventListener("input", updateEditPreview);
  editForm.addEventListener("submit", saveManualEdit);
  root.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.sourceFilter) {
      sourceFilter = button.dataset.sourceFilter;
      page = 1;
      root.querySelectorAll("[data-source-filter]").forEach((item) => item.classList.toggle("is-active", item === button));
      renderProducts();
    } else if (button.dataset.editManual) openManualEdit(button.dataset.editManual);
    else if (button.dataset.deleteManual) removeManualProduct(button.dataset.deleteManual).catch((error) => { console.error("[product-price] manual delete:", error); showAlert("직접등록 제품을 삭제하지 못했습니다.", "error"); });
    else if ("closeManualEdit" in button.dataset && editDialog.open) editDialog.close();
  });
  prev.addEventListener("click", () => { page -= 1; renderProducts(); });
  next.addEventListener("click", () => { page += 1; renderProducts(); });
  get("#backHomeBtn")?.addEventListener("click", () => go("/"));
  get("#themeToggle")?.addEventListener("click", () => { const nextTheme = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark"; document.documentElement.setAttribute("data-theme", nextTheme); try { localStorage.setItem("oce-theme", nextTheme); } catch (_) { /* ignore */ } });
  reloadDatabase().catch((error) => { console.error("[product-price] load:", error); showAlert("저장된 제품DB를 불러오지 못했습니다.", "error"); });
  return () => { alive = false; cleanupBackup(); pricingPanel?.cleanup(); };
}
