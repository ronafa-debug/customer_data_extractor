/** OCR-제품가격관리 — 영수증 OCR 후보 확인 및 가격 저장 */
import { go } from "../router/Router.js";
import { detectReceipts, releaseReceiptResult } from "../receipt/ReceiptDetector.js";
import { analyzeReceiptsSequentially } from "../receipt/ReceiptOcrService.js";
import { calculateSalePrices, findDuplicateProduct, normalizeNewProductName, searchNewProducts, validateNewProduct } from "../new-price/NewPriceModel.js";
import { addNewProduct, deleteNewProduct, listNewProducts, updateNewProduct } from "../new-price/NewPriceStore.js";

const won = new Intl.NumberFormat("ko-KR");

/** @param {HTMLElement} root @returns {() => void} */
export function renderNewPriceManagerView(root) {
  const params = new URLSearchParams(window.location.search);
  const debugMode = params.has("debug");
  const skipOcr = params.has("skipOcr");
  let result = null;
  let sourceUrl = "";
  let processing = false;
  let alive = true;
  let draftSequence = 0;
  let drafts = [];
  let savedProducts = [];
  const analyses = new Map();

  root.innerHTML = `
    <div class="tool-shell">
      <div class="tool-topbar">
        <button type="button" class="btn btn-outline-secondary btn-sm" id="backHomeBtn">← 홈</button>
        <div class="tool-topbar-brand"><h1 class="tool-page-title">OCR-제품가격관리</h1><p class="tool-page-sub">영수증 인식 결과를 확인하고 판매가격을 계산해 저장합니다</p></div>
        <button type="button" id="themeToggle" class="btn btn-theme" aria-label="다크모드 전환"><span class="theme-icon" aria-hidden="true">◐</span></button>
      </div>
      <section class="panel">
        <div class="result-header"><h2 class="result-title">제품 직접 등록</h2><span class="result-count">영수증 없이 등록</span></div>
        <div class="new-price-manual-form">
          <label>제품명<input type="text" id="manualProductName" class="form-control" autocomplete="off" /></label>
          <label>매입가<input type="number" id="manualPurchasePrice" class="form-control" min="1" step="1" inputmode="numeric" /></label>
          <div class="new-price-calculated" id="manualCalculated">네이버 0원 · 쿠팡 0원</div>
          <button type="button" class="btn btn-primary" id="manualSaveBtn">제품 등록</button>
        </div>
      </section>
      <section class="panel"><div id="receiptDropZone" class="drop-zone" tabindex="0" role="button" aria-label="영수증 사진 업로드 영역">
        <input type="file" id="receiptFileInput" accept="image/jpeg,image/png,image/webp" hidden />
        <div class="drop-zone-inner"><span class="drop-icon" aria-hidden="true">⇪</span><p class="drop-title">영수증 사진 업로드</p><p class="drop-hint">여러 영수증이 함께 촬영된 사진을 선택하세요</p><p class="drop-formats">JPG · PNG · WebP</p></div>
      </div></section>
      <div id="receiptAlert" class="alert-box d-none" role="status" aria-live="polite"></div>
      <section id="receiptSourcePanel" class="panel d-none"><div class="result-header"><h2 class="result-title">원본 이미지</h2><span id="receiptSourceMeta" class="result-count"></span></div><img id="receiptSourceImage" class="receipt-source-image" alt="업로드한 원본 영수증 사진" /></section>
      <section id="receiptResultPanel" class="panel d-none"><div class="result-header"><h2 class="result-title">영수증별 제품 후보</h2><span id="receiptCount" class="result-count"></span></div><div id="receiptGrid" class="receipt-grid"></div></section>
      <section id="newPriceReviewPanel" class="panel d-none"><div class="result-header"><h2 class="result-title">최종 확인</h2><button type="button" id="saveReceiptProductsBtn" class="btn btn-primary btn-sm">확인한 제품 저장</button></div><div class="price-table-wrap"><table class="new-price-table"><thead><tr><th>제품명</th><th>매입가</th><th>네이버</th><th>쿠팡</th><th>상태</th></tr></thead><tbody id="newPriceReviewBody"></tbody></table></div></section>
      <section class="panel"><div class="result-header"><h2 class="result-title">저장된 새 제품가격</h2><span id="savedNewPriceCount" class="result-count">0건</span></div><div class="price-search-row" role="search"><input type="search" id="newPriceSearch" class="form-control search-input" placeholder="제품명 검색" autocomplete="off" /></div><div class="price-table-wrap"><table class="new-price-table"><thead><tr><th>제품명</th><th>매입가</th><th>네이버</th><th>쿠팡</th><th>수정일</th><th>관리</th></tr></thead><tbody id="savedNewPriceBody"></tbody></table></div></section>
      <section id="receiptDebugPanel" class="panel d-none"><div class="result-header"><h2 class="result-title">탐지 디버그</h2><span class="result-count">후보: 주황/빨강 · 최종: 초록</span></div><pre id="receiptDiagnostics" class="receipt-diagnostics"></pre><img id="receiptDebugImage" class="receipt-source-image" alt="영수증 탐지 후보 디버그 오버레이" /></section>
      <dialog id="duplicatePriceDialog" class="new-price-dialog"><form method="dialog"><h2>같은 제품명이 이미 있습니다</h2><div id="duplicatePriceComparison"></div><p>기존 항목을 갱신하거나 별도 항목으로 추가할 수 있습니다.</p><div class="new-price-dialog-actions"><button value="cancel" class="btn btn-outline-secondary">취소</button><button value="add" class="btn btn-outline-primary">새 항목 추가</button><button value="update" class="btn btn-primary">기존 항목 갱신</button></div></form></dialog>
    </div>`;

  const get = (selector) => root.querySelector(selector);
  const dropZone = get("#receiptDropZone");
  const fileInput = get("#receiptFileInput");
  const alertBox = get("#receiptAlert");
  const sourcePanel = get("#receiptSourcePanel");
  const sourceImage = get("#receiptSourceImage");
  const sourceMeta = get("#receiptSourceMeta");
  const resultPanel = get("#receiptResultPanel");
  const receiptCount = get("#receiptCount");
  const receiptGrid = get("#receiptGrid");
  const reviewPanel = get("#newPriceReviewPanel");
  const reviewBody = get("#newPriceReviewBody");
  const savedBody = get("#savedNewPriceBody");
  const savedCount = get("#savedNewPriceCount");
  const searchInput = get("#newPriceSearch");
  const manualName = get("#manualProductName");
  const manualPrice = get("#manualPurchasePrice");
  const manualCalculated = get("#manualCalculated");
  const duplicateDialog = get("#duplicatePriceDialog");
  const duplicateComparison = get("#duplicatePriceComparison");
  const debugPanel = get("#receiptDebugPanel");
  const diagnostics = get("#receiptDiagnostics");
  const debugImage = get("#receiptDebugImage");

  function showStatus(message, type = "info") {
    alertBox.textContent = message;
    alertBox.className = `alert-box is-${type}`;
  }

  function makeDraft(item = {}, receiptIndex = null, source = "receipt") {
    return { id: `draft-${++draftSequence}`, receiptIndex, source, productName: normalizeNewProductName(item.productName || ""), purchasePrice: item.purchasePrice ? String(item.purchasePrice) : "", reviewRequired: Boolean(item.reviewRequired) };
  }

  function renderDraftRow(draft) {
    const row = document.createElement("div");
    row.className = "new-price-draft-row";
    row.dataset.draftId = draft.id;
    const nameLabel = document.createElement("label");
    nameLabel.textContent = "제품명";
    const name = document.createElement("input");
    name.type = "text"; name.className = "form-control new-price-draft-input"; name.dataset.field = "productName"; name.value = draft.productName;
    nameLabel.appendChild(name);
    const priceLabel = document.createElement("label");
    priceLabel.textContent = "매입가";
    const price = document.createElement("input");
    price.type = "number"; price.min = "1"; price.step = "1"; price.inputMode = "numeric"; price.className = "form-control new-price-draft-input"; price.dataset.field = "purchasePrice"; price.value = draft.purchasePrice;
    priceLabel.appendChild(price);
    const prices = calculateSalePrices(draft.purchasePrice);
    const calculated = document.createElement("span");
    calculated.className = "new-price-calculated"; calculated.dataset.role = "calculated"; calculated.textContent = `네이버 ${won.format(prices.naverPrice)}원 · 쿠팡 ${won.format(prices.coupangPrice)}원`;
    const badge = document.createElement("em");
    badge.className = draft.reviewRequired ? "receipt-review-badge" : "new-price-ok-badge"; badge.textContent = draft.reviewRequired ? "⚠ 확인 필요" : "✓ 인식 완료";
    const remove = document.createElement("button");
    remove.type = "button"; remove.className = "btn btn-outline-danger btn-sm"; remove.dataset.action = "remove-draft"; remove.textContent = "삭제";
    row.append(nameLabel, priceLabel, calculated, badge, remove);
    return row;
  }

  function renderReceiptDrafts(receiptIndex) {
    const container = receiptGrid.querySelector(`[data-receipt-index="${receiptIndex}"]`);
    if (!container) return;
    container.replaceChildren();
    const heading = document.createElement("strong"); heading.textContent = "제품 후보"; container.appendChild(heading);
    const current = drafts.filter((draft) => draft.receiptIndex === receiptIndex);
    if (!current.length) {
      const empty = document.createElement("p"); empty.className = "receipt-analysis-empty"; empty.textContent = "제품 후보가 없습니다. 필요하면 직접 추가해주세요."; container.appendChild(empty);
    } else {
      const list = document.createElement("div"); list.className = "new-price-draft-list"; current.forEach((draft) => list.appendChild(renderDraftRow(draft))); container.appendChild(list);
    }
    const add = document.createElement("button"); add.type = "button"; add.className = "btn btn-outline-primary btn-sm"; add.dataset.action = "add-draft"; add.dataset.receiptIndex = String(receiptIndex); add.textContent = "+ 제품 추가"; container.appendChild(add);
    const analysis = analyses.get(receiptIndex);
    if (debugMode && analysis) {
      const details = document.createElement("details"); details.className = "receipt-ocr-debug";
      const summary = document.createElement("summary"); summary.textContent = "OCR 디버그 정보";
      const pre = document.createElement("pre"); pre.textContent = JSON.stringify(analysis, null, 2);
      details.append(summary, pre); container.appendChild(details);
    }
  }

  function renderReview() {
    reviewBody.replaceChildren();
    reviewPanel.classList.toggle("d-none", drafts.length === 0);
    for (const draft of drafts) {
      const checked = validateNewProduct(draft);
      const row = document.createElement("tr");
      [draft.productName || "(제품명 없음)", `${won.format(checked.value.purchasePrice)}원`, `${won.format(checked.value.naverPrice)}원`, `${won.format(checked.value.coupangPrice)}원`, checked.valid ? (draft.reviewRequired ? "확인 필요" : "저장 가능") : "입력 확인"].forEach((value) => { const cell = document.createElement("td"); cell.textContent = value; row.appendChild(cell); });
      if (!checked.valid) row.classList.add("is-invalid");
      reviewBody.appendChild(row);
    }
  }

  function renderReceipts(receipts) {
    receiptGrid.replaceChildren();
    for (const receipt of receipts) {
      const figure = document.createElement("figure"); figure.className = "receipt-card";
      const title = document.createElement("figcaption"); title.textContent = `영수증 ${receipt.index}`;
      const image = document.createElement("img"); image.src = receipt.url; image.alt = `분리된 영수증 ${receipt.index}`; image.loading = "lazy";
      const meta = document.createElement("span"); meta.textContent = `${receipt.width} × ${receipt.height}px`;
      const analysis = document.createElement("div"); analysis.className = "receipt-analysis"; analysis.dataset.receiptIndex = String(receipt.index);
      const pending = document.createElement("p"); pending.className = "receipt-analysis-empty"; pending.textContent = skipOcr ? "제품을 직접 추가할 수 있습니다." : "분석 대기 중…"; analysis.appendChild(pending);
      figure.append(title, image, meta, analysis); receiptGrid.appendChild(figure);
    }
    if (skipOcr) receipts.forEach((receipt) => renderReceiptDrafts(receipt.index));
  }

  function acceptAnalysis(analysis) {
    analyses.set(analysis.receiptIndex, analysis);
    drafts.push(...analysis.items.map((item) => makeDraft(item, analysis.receiptIndex, "receipt")));
    renderReceiptDrafts(analysis.receiptIndex);
    renderReview();
  }

  function clearReceiptResult() {
    releaseReceiptResult(result); result = null; drafts = []; analyses.clear(); receiptGrid.replaceChildren(); renderReview(); resultPanel.classList.add("d-none"); debugPanel.classList.add("d-none"); debugImage.removeAttribute("src");
    if (sourceUrl) URL.revokeObjectURL(sourceUrl); sourceUrl = "";
  }

  async function handleFile(file) {
    if (processing) return;
    clearReceiptResult();
    if (!file?.type?.startsWith("image/")) { showStatus("JPG, PNG 또는 WebP 이미지 파일을 선택해주세요.", "error"); return; }
    processing = true; dropZone.classList.add("is-processing"); sourceUrl = URL.createObjectURL(file); sourceImage.src = sourceUrl; sourceMeta.textContent = file.name; sourcePanel.classList.remove("d-none");
    try {
      result = await detectReceipts(file, { debug: debugMode, onProgress: (message) => showStatus(message, "info") });
      if (!alive) return;
      if (debugMode && result.debug) { diagnostics.textContent = JSON.stringify(result.diagnostics, null, 2); debugImage.src = result.debug.url; debugPanel.classList.remove("d-none"); }
      receiptCount.textContent = `영수증 ${result.receipts.length}장`; sourceMeta.textContent = `${file.name} · ${result.source.width} × ${result.source.height}px`;
      if (!result.receipts.length) { showStatus("영수증을 찾지 못했습니다. 밝은 바닥에서 영수증 사이 간격이 보이도록 다시 촬영해주세요.", "error"); return; }
      renderReceipts(result.receipts); resultPanel.classList.remove("d-none");
      if (skipOcr) { showStatus(`영수증 ${result.receipts.length}장을 찾았습니다.`, "success"); return; }
      showStatus(`영수증 분석 중… 0 / ${result.receipts.length}`, "info");
      const ocrResults = await analyzeReceiptsSequentially(result.receipts, { onProgress: ({ current, total, ocrProgress }) => { const percent = Number.isFinite(ocrProgress) && ocrProgress > 0 ? ` · ${Math.round(ocrProgress * 100)}%` : ""; showStatus(`영수증 분석 중… ${current} / ${total}${percent}`, "info"); }, onResult: acceptAnalysis });
      const itemCount = ocrResults.reduce((sum, analysis) => sum + analysis.items.length, 0);
      showStatus(`영수증 ${result.receipts.length}장 분석을 완료했습니다. 제품 ${itemCount}개를 확인해주세요.`, "success");
    } catch (error) { console.error("[receipt] detect:", error); showStatus(error?.message || "이미지를 처리하지 못했습니다.", "error"); }
    finally { processing = false; dropZone.classList.remove("is-processing"); fileInput.value = ""; }
  }

  function renderSavedProducts() {
    savedBody.replaceChildren();
    const visible = searchNewProducts(savedProducts, searchInput.value);
    savedCount.textContent = `${visible.length.toLocaleString("ko-KR")} / ${savedProducts.length.toLocaleString("ko-KR")}건`;
    if (!visible.length) { const row = document.createElement("tr"); const cell = document.createElement("td"); cell.colSpan = 6; cell.className = "new-price-empty-cell"; cell.textContent = searchInput.value ? "검색 결과가 없습니다." : "저장된 제품이 없습니다."; row.appendChild(cell); savedBody.appendChild(row); return; }
    for (const product of visible) {
      const row = document.createElement("tr"); row.dataset.productId = product.id;
      [product.productName, `${won.format(product.purchasePrice)}원`, `${won.format(product.naverPrice)}원`, `${won.format(product.coupangPrice)}원`, new Date(product.updatedAt).toLocaleDateString("ko-KR")].forEach((value) => { const cell = document.createElement("td"); cell.textContent = value; row.appendChild(cell); });
      const actions = document.createElement("td"); actions.className = "new-price-table-actions";
      for (const [action, label, className] of [["edit-saved", "수정", "btn btn-outline-primary btn-sm"], ["delete-saved", "삭제", "btn btn-outline-danger btn-sm"]]) { const button = document.createElement("button"); button.type = "button"; button.dataset.action = action; button.className = className; button.textContent = label; actions.appendChild(button); }
      row.appendChild(actions); savedBody.appendChild(row);
    }
  }

  async function reloadSavedProducts() { savedProducts = await listNewProducts(); if (alive) renderSavedProducts(); }

  function askDuplicate(existing, incoming) {
    duplicateComparison.replaceChildren(); const table = document.createElement("table"); table.className = "new-price-duplicate-table";
    for (const [label, item] of [["기존", existing], ["새 값", incoming]]) { const row = document.createElement("tr"); [label, item.productName, `${won.format(item.purchasePrice)}원`, `네이버 ${won.format(item.naverPrice)}원`, `쿠팡 ${won.format(item.coupangPrice)}원`].forEach((value) => { const cell = document.createElement("td"); cell.textContent = value; row.appendChild(cell); }); table.appendChild(row); }
    duplicateComparison.appendChild(table);
    return new Promise((resolve) => { const close = () => { duplicateDialog.removeEventListener("close", close); resolve(duplicateDialog.returnValue || "cancel"); }; duplicateDialog.addEventListener("close", close); duplicateDialog.showModal(); });
  }

  async function persistDraft(draft) {
    const checked = validateNewProduct(draft); if (!checked.valid) throw new Error("제품명과 매입가를 확인해주세요.");
    const duplicate = findDuplicateProduct(savedProducts, checked.value.productName);
    if (duplicate) { const choice = await askDuplicate(duplicate, checked.value); if (choice === "cancel") return false; if (choice === "update") await updateNewProduct(duplicate.id, { ...checked.value, source: draft.source }); else await addNewProduct({ ...checked.value, source: draft.source }); }
    else await addNewProduct({ ...checked.value, source: draft.source });
    await reloadSavedProducts(); return true;
  }

  async function saveReceiptDrafts() {
    if (!drafts.length) return;
    const invalid = drafts.filter((draft) => !validateNewProduct(draft).valid);
    if (invalid.length) { showStatus(`입력이 필요한 제품이 ${invalid.length}개 있습니다. 제품명과 매입가를 확인해주세요.`, "error"); return; }
    const savedIds = [];
    try { for (const draft of drafts) if (await persistDraft(draft)) savedIds.push(draft.id); drafts = drafts.filter((draft) => !savedIds.includes(draft.id)); result?.receipts.forEach((receipt) => renderReceiptDrafts(receipt.index)); renderReview(); showStatus(`제품 ${savedIds.length}개를 저장했습니다.`, "success"); }
    catch (error) { console.error("[new-price] save receipt products:", error); showStatus(error?.message || "제품을 저장하지 못했습니다.", "error"); }
  }

  function updateManualCalculated() { const prices = calculateSalePrices(manualPrice.value); manualCalculated.textContent = `네이버 ${won.format(prices.naverPrice)}원 · 쿠팡 ${won.format(prices.coupangPrice)}원`; }

  async function saveManualProduct() {
    const draft = makeDraft({ productName: manualName.value, purchasePrice: manualPrice.value }, null, "manual");
    if (!validateNewProduct(draft).valid) { showStatus("직접 등록할 제품명과 0보다 큰 매입가를 입력해주세요.", "error"); return; }
    try { if (await persistDraft(draft)) { manualName.value = ""; manualPrice.value = ""; updateManualCalculated(); showStatus("제품을 직접 등록했습니다.", "success"); } }
    catch (error) { console.error("[new-price] manual save:", error); showStatus(error?.message || "제품을 저장하지 못했습니다.", "error"); }
  }

  function startSavedEdit(row, product) {
    row.replaceChildren();
    const nameCell = document.createElement("td"); const name = document.createElement("input"); name.className = "form-control"; name.value = product.productName; name.dataset.role = "edit-name"; nameCell.appendChild(name);
    const priceCell = document.createElement("td"); const price = document.createElement("input"); price.type = "number"; price.min = "1"; price.className = "form-control"; price.value = String(product.purchasePrice); price.dataset.role = "edit-price"; priceCell.appendChild(price);
    const calculated = document.createElement("td"); calculated.colSpan = 3; calculated.dataset.role = "edit-calculated"; calculated.textContent = `네이버 ${won.format(product.naverPrice)}원 · 쿠팡 ${won.format(product.coupangPrice)}원`;
    const actions = document.createElement("td"); actions.className = "new-price-table-actions";
    for (const [action, label, className] of [["save-edit", "저장", "btn btn-primary btn-sm"], ["cancel-edit", "취소", "btn btn-outline-secondary btn-sm"]]) { const button = document.createElement("button"); button.type = "button"; button.dataset.action = action; button.className = className; button.textContent = label; actions.appendChild(button); }
    row.append(nameCell, priceCell, calculated, actions);
  }

  root.addEventListener("input", (event) => {
    const target = event.target;
    if (target === manualPrice) updateManualCalculated();
    if (target === searchInput) renderSavedProducts();
    if (target.classList.contains("new-price-draft-input")) {
      const row = target.closest("[data-draft-id]"); const draft = drafts.find((item) => item.id === row?.dataset.draftId); if (!draft) return;
      draft[target.dataset.field] = target.value; draft.reviewRequired = false;
      const prices = calculateSalePrices(draft.purchasePrice); const calculated = row.querySelector('[data-role="calculated"]'); if (calculated) calculated.textContent = `네이버 ${won.format(prices.naverPrice)}원 · 쿠팡 ${won.format(prices.coupangPrice)}원`;
      const badge = row.querySelector("em"); if (badge) { badge.className = "new-price-ok-badge"; badge.textContent = "✓ 인식 완료"; } renderReview();
    }
    if (target.matches('[data-role="edit-price"]')) { const calculated = target.closest("tr")?.querySelector('[data-role="edit-calculated"]'); const prices = calculateSalePrices(target.value); if (calculated) calculated.textContent = `네이버 ${won.format(prices.naverPrice)}원 · 쿠팡 ${won.format(prices.coupangPrice)}원`; }
  });

  root.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]"); if (!button) return; const action = button.dataset.action;
    if (action === "add-draft") { const receiptIndex = Number(button.dataset.receiptIndex); drafts.push(makeDraft({}, receiptIndex, "receipt")); renderReceiptDrafts(receiptIndex); renderReview(); return; }
    if (action === "remove-draft") { const id = button.closest("[data-draft-id]")?.dataset.draftId; const receiptIndex = drafts.find((draft) => draft.id === id)?.receiptIndex; drafts = drafts.filter((draft) => draft.id !== id); if (receiptIndex) renderReceiptDrafts(receiptIndex); renderReview(); return; }
    const row = button.closest("tr[data-product-id]"); const product = savedProducts.find((item) => item.id === row?.dataset.productId); if (!row || !product) return;
    try {
      if (action === "edit-saved") startSavedEdit(row, product);
      if (action === "cancel-edit") renderSavedProducts();
      if (action === "save-edit") { const productName = row.querySelector('[data-role="edit-name"]')?.value; const purchasePrice = row.querySelector('[data-role="edit-price"]')?.value; const checked = validateNewProduct({ productName, purchasePrice }); if (!checked.valid) { showStatus("수정할 제품명과 매입가를 확인해주세요.", "error"); return; } await updateNewProduct(product.id, { ...checked.value, source: product.source }); await reloadSavedProducts(); showStatus("제품 가격을 수정했습니다.", "success"); }
      if (action === "delete-saved") { if (!window.confirm(`“${product.productName}” 제품을 삭제할까요?`)) return; await deleteNewProduct(product.id); await reloadSavedProducts(); showStatus("제품을 삭제했습니다.", "success"); }
    } catch (error) { console.error("[new-price] saved action:", error); showStatus(error?.message || "요청을 처리하지 못했습니다.", "error"); }
  });

  const openPicker = () => { if (!processing) fileInput.click(); };
  dropZone.addEventListener("click", openPicker);
  dropZone.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openPicker(); } });
  fileInput.addEventListener("change", () => { if (fileInput.files?.[0]) handleFile(fileInput.files[0]); });
  for (const name of ["dragenter", "dragover"]) dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.add("is-dragover"); });
  for (const name of ["dragleave", "drop"]) dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.remove("is-dragover"); });
  dropZone.addEventListener("drop", (event) => { if (event.dataTransfer?.files?.[0]) handleFile(event.dataTransfer.files[0]); });
  get("#saveReceiptProductsBtn")?.addEventListener("click", saveReceiptDrafts);
  get("#manualSaveBtn")?.addEventListener("click", saveManualProduct);
  get("#backHomeBtn")?.addEventListener("click", () => go("/"));
  get("#themeToggle")?.addEventListener("click", () => { const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark"; document.documentElement.setAttribute("data-theme", next); try { localStorage.setItem("oce-theme", next); } catch (_) { /* ignore */ } });
  reloadSavedProducts().catch((error) => { console.error("[new-price] restore:", error); showStatus("저장된 새 제품가격을 불러오지 못했습니다.", "error"); });

  return () => { alive = false; clearReceiptResult(); if (duplicateDialog.open) duplicateDialog.close("cancel"); };
}
