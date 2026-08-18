/**
 * 제품가격관리 뷰 — 엑셀 업로드 → 표 생성 → IndexedDB 복원/검색
 */
import { go } from "../router/Router.js";
import { loadExcelFile } from "../order/services/ExcelService.js";
import { parsePriceWorkbook, rowMatchesQuery } from "../price/parsePriceWorkbook.js";
import {
  loadPriceTable,
  savePriceTable,
  clearPriceTable,
} from "../price/priceStore.js";

const THEME_KEY = "oce-theme";
const SEARCH_DEBOUNCE_MS = 150;
const SAVE_DEBOUNCE_MS = 280;

const TABLE_HEAD = `
  <tr>
    <th class="price-col-check" scope="col">
      <input type="checkbox" class="price-select-all" aria-label="전체 선택" />
    </th>
    <th class="price-col-seq" scope="col">순번</th>
    <th scope="col">품목명</th>
    <th scope="col">규격</th>
    <th class="price-num price-col-naver" scope="col">네이버가격</th>
    <th class="price-num price-col-coupang" scope="col">쿠팡가격</th>
    <th scope="col">제조사/수입사</th>
    <th scope="col">원산지</th>
    <th class="price-num" scope="col">공급가</th>
    <th class="price-num" scope="col">부가세</th>
    <th class="price-num" scope="col">제안가</th>
  </tr>
`;

/**
 * @param {unknown} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {number} n
 * @returns {string}
 */
function formatWon(n) {
  return Number(n || 0).toLocaleString("ko-KR");
}

/**
 * @param {number} ts
 * @returns {string}
 */
function formatSavedAt(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString("ko-KR");
  } catch (_) {
    return "";
  }
}

/**
 * @param {object} row
 * @param {boolean} isChecked
 * @returns {string}
 */
function renderRowHtml(row, isChecked) {
  const checkedAttr = isChecked ? " checked" : "";
  return `<tr data-id="${escapeHtml(row.id)}" data-seq="${row.seq}">
    <td class="price-col-check"><input type="checkbox" class="price-row-check" aria-label="${escapeHtml(row.name)} 선택"${checkedAttr} /></td>
    <td class="price-col-seq">${row.seq}</td>
    <td>${escapeHtml(row.name)}</td>
    <td>${escapeHtml(row.spec)}</td>
    <td class="price-num price-col-naver">${formatWon(row.naver)}</td>
    <td class="price-num price-col-coupang">${formatWon(row.coupang)}</td>
    <td>${escapeHtml(row.maker)}</td>
    <td>${escapeHtml(row.origin)}</td>
    <td class="price-num">${formatWon(row.supply)}</td>
    <td class="price-num">${formatWon(row.vat)}</td>
    <td class="price-num">${formatWon(row.offer)}</td>
  </tr>`;
}

/**
 * @param {object[]} list
 * @param {number} seq
 * @returns {object | undefined}
 */
function findById(list, id) {
  return list.find((row) => String(row.id) === String(id));
}

/**
 * @param {object} row
 * @returns {string}
 */
function rowId(row) {
  return String(row.id || row.seq);
}

/**
 * @param {object[]} list
 * @returns {object[]}
 */
function withRowIds(list) {
  return (list || []).map((row, index) => {
    if (row?.id) return row;
    return {
      ...row,
      id: `legacy-${index}-${row.seq}-${row.name}-${row.spec}-${row.maker}`,
    };
  });
}

/**
 * @param {object[]} list
 * @param {Array<string|number>} saved
 * @returns {Set<string>}
 */
function restoreChecked(list, saved) {
  const selected = new Set();
  const byId = new Map(list.map((row) => [String(row.id), row]));
  for (const raw of saved || []) {
    const key = String(raw);
    if (byId.has(key)) {
      selected.add(key);
      continue;
    }
    const seq = Number(raw);
    const row = Number.isFinite(seq)
      ? list.find((item) => item.seq === seq)
      : undefined;
    if (row) selected.add(rowId(row));
  }
  return selected;
}

/**
 * @param {{
 *   input: HTMLInputElement,
 *   meta: HTMLElement,
 *   prev: HTMLButtonElement,
 *   next: HTMLButtonElement,
 *   getRows: () => object[],
 *   getBody: () => HTMLElement,
 * }} opts
 */
function createTableSearch(opts) {
  /** @type {string[]} */
  let matchIds = [];
  let matchIndex = 0;
  let timer = 0;

  function clearUi() {
    matchIds = [];
    matchIndex = 0;
    opts.meta.textContent = "";
    opts.prev.disabled = true;
    opts.next.disabled = true;
    opts.getBody()
      .querySelectorAll("tr.is-search-match, tr.is-search-current")
      .forEach((el) => {
        el.classList.remove("is-search-match", "is-search-current");
      });
  }

  /**
   * @param {string} id
   * @param {boolean} [smooth]
   */
  function jumpToId(id, smooth = true) {
    const root = opts.getBody();
    root.querySelectorAll("tr.is-search-current").forEach((el) => {
      el.classList.remove("is-search-current");
    });
    const tr = /** @type {HTMLElement | null} */ (
      root.querySelector(`tr[data-id="${CSS.escape(String(id))}"]`)
    );
    if (!tr) return;
    tr.classList.add("is-search-current");
    tr.scrollIntoView({
      block: "center",
      behavior: smooth ? "smooth" : "auto",
    });
  }

  function paintMatches() {
    const root = opts.getBody();
    root.querySelectorAll("tr").forEach((tr) => {
      tr.classList.remove("is-search-match", "is-search-current");
    });
    const matchSet = new Set(matchIds);
    root.querySelectorAll("tr[data-id]").forEach((tr) => {
      const id = tr.getAttribute("data-id");
      if (id && matchSet.has(id)) tr.classList.add("is-search-match");
    });
  }

  function updateMeta() {
    const q = opts.input.value.trim();
    if (!q) {
      opts.meta.textContent = "";
      opts.prev.disabled = true;
      opts.next.disabled = true;
      return;
    }
    if (!matchIds.length) {
      opts.meta.textContent = "일치하는 제품이 없습니다";
      opts.prev.disabled = true;
      opts.next.disabled = true;
      return;
    }
    opts.meta.textContent = `${matchIndex + 1} / ${matchIds.length}건`;
    opts.prev.disabled = false;
    opts.next.disabled = false;
  }

  /**
   * @param {string} query
   * @param {{ jump?: boolean }} [applyOpts]
   */
  function apply(query, applyOpts = {}) {
    const jump = applyOpts.jump !== false;
    const q = String(query || "").trim();
    if (!q) {
      clearUi();
      return;
    }
    matchIds = opts
      .getRows()
      .filter((row) => rowMatchesQuery(row, q))
      .map((row) => rowId(row));
    matchIndex = 0;
    paintMatches();
    updateMeta();
    if (jump && matchIds.length) {
      jumpToId(matchIds[0]);
    }
  }

  /**
   * @param {number} delta
   */
  function step(delta) {
    if (!matchIds.length) return;
    matchIndex = (matchIndex + delta + matchIds.length) % matchIds.length;
    updateMeta();
    jumpToId(matchIds[matchIndex]);
  }

  opts.input.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      apply(opts.input.value, { jump: true });
    }, SEARCH_DEBOUNCE_MS);
  });
  opts.input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      if (!matchIds.length) apply(opts.input.value, { jump: true });
      else step(ev.shiftKey ? -1 : 1);
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      opts.input.value = "";
      clearUi();
    }
  });
  opts.prev.addEventListener("click", () => step(-1));
  opts.next.addEventListener("click", () => step(1));

  return {
    reset() {
      opts.input.value = "";
      clearUi();
    },
    refresh() {
      apply(opts.input.value, { jump: false });
    },
    destroy() {
      window.clearTimeout(timer);
    },
  };
}

/**
 * @param {HTMLElement} root
 * @returns {() => void}
 */
export function renderPriceManagerView(root) {
  const appShell = document.getElementById("app");
  appShell?.classList.add("is-wide");

  root.innerHTML = `
    <div class="tool-shell">
      <div class="tool-topbar">
        <button type="button" class="btn btn-outline-secondary btn-sm" id="backHomeBtn">← 홈</button>
        <div class="tool-topbar-brand">
          <h1 class="tool-page-title">제품가격관리</h1>
          <p class="tool-page-sub">품목가격 엑셀 → 제안가·네이버·쿠팡 가격표</p>
        </div>
        <button type="button" id="themeToggle" class="btn btn-theme" aria-label="다크모드 전환" title="다크모드">
          <span class="theme-icon" aria-hidden="true">◐</span>
        </button>
      </div>

      <section class="panel upload-panel price-upload-panel">
        <div class="price-upload-row">
          <div id="dropZone" class="drop-zone" tabindex="0" role="button" aria-label="Excel 파일 업로드 영역">
            <input type="file" id="fileInput" accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden />
            <div class="drop-zone-inner">
              <span class="drop-icon" aria-hidden="true">⇪</span>
              <p class="drop-title">파일 업로드</p>
              <p class="drop-hint">클릭하거나 Drag &amp; Drop</p>
              <p class="drop-formats">품목가격 .xls / .xlsx</p>
            </div>
          </div>
          <div id="fileMeta" class="file-meta d-none">
            <div class="file-meta-row">
              <span id="fileName" class="file-name"></span>
              <span id="savedAtLabel" class="file-saved-at"></span>
            </div>
            <button type="button" id="clearSavedBtn" class="btn btn-sm btn-outline-secondary">저장된 표 지우기</button>
          </div>
        </div>
      </section>

      <div id="priceAlert" class="alert-box d-none" role="alert"></div>

      <section id="priceResult" class="panel price-result-panel d-none">
        <div class="result-header">
          <h2 class="result-title">제품가격관리표</h2>
          <span id="priceCount" class="result-count"></span>
        </div>
        <div class="price-search-row" role="search">
          <input type="search" id="priceSearch" class="form-control search-input" placeholder="품목명, 규격, 제조사 검색" autocomplete="off" />
          <span id="priceSearchMeta" class="price-search-meta" aria-live="polite"></span>
          <button type="button" id="priceSearchPrev" class="btn btn-outline-secondary btn-sm" disabled>이전</button>
          <button type="button" id="priceSearchNext" class="btn btn-outline-secondary btn-sm" disabled>다음</button>
        </div>
        <div class="price-table-wrap">
          <table class="price-table" id="priceTable" data-list="catalog">
            <thead>${TABLE_HEAD}</thead>
            <tbody id="priceTableBody"></tbody>
          </table>
        </div>

        <div class="price-move-bar" role="group" aria-label="제품 이동">
          <button type="button" id="moveUpBtn" class="btn btn-outline-primary price-move-btn" title="업로드한 제품을 가격표로 되돌리기" aria-label="위로 이동">▲</button>
          <button type="button" id="moveDownBtn" class="btn btn-primary price-move-btn" title="체크한 제품을 아래로 옮기기" aria-label="아래로 이동">▼</button>
        </div>

        <div class="result-header">
          <h2 class="result-title">업로드한 제품</h2>
          <div class="result-header-actions">
            <span id="uploadedCount" class="result-count"></span>
            <button type="button" id="deleteUploadedBtn" class="btn btn-outline-secondary btn-sm">선택 삭제</button>
          </div>
        </div>
        <div class="price-search-row" role="search">
          <input type="search" id="uploadedSearch" class="form-control search-input" placeholder="품목명, 규격, 제조사 검색" autocomplete="off" />
          <span id="uploadedSearchMeta" class="price-search-meta" aria-live="polite"></span>
          <button type="button" id="uploadedSearchPrev" class="btn btn-outline-secondary btn-sm" disabled>이전</button>
          <button type="button" id="uploadedSearchNext" class="btn btn-outline-secondary btn-sm" disabled>다음</button>
        </div>
        <div class="price-table-wrap is-uploaded">
          <table class="price-table" id="uploadedTable" data-list="uploaded">
            <thead>${TABLE_HEAD}</thead>
            <tbody id="uploadedTableBody"></tbody>
          </table>
        </div>
      </section>

      <footer class="app-footer">
        <p>가격 데이터는 이 브라우저에만 저장됩니다. 서버로 전송되지 않습니다.</p>
      </footer>
    </div>
  `;

  const themeToggle = root.querySelector("#themeToggle");
  themeToggle?.addEventListener("click", () => {
    const current =
      document.documentElement.getAttribute("data-theme") || "light";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (_) {
      /* ignore */
    }
  });

  root.querySelector("#backHomeBtn")?.addEventListener("click", () => go("/"));

  const dropZone = /** @type {HTMLElement} */ (root.querySelector("#dropZone"));
  const fileInput = /** @type {HTMLInputElement} */ (root.querySelector("#fileInput"));
  const fileMeta = /** @type {HTMLElement} */ (root.querySelector("#fileMeta"));
  const fileNameEl = /** @type {HTMLElement} */ (root.querySelector("#fileName"));
  const savedAtLabel = /** @type {HTMLElement} */ (root.querySelector("#savedAtLabel"));
  const clearSavedBtn = /** @type {HTMLButtonElement} */ (root.querySelector("#clearSavedBtn"));
  const alertBox = /** @type {HTMLElement} */ (root.querySelector("#priceAlert"));
  const resultPanel = /** @type {HTMLElement} */ (root.querySelector("#priceResult"));
  const priceCount = /** @type {HTMLElement} */ (root.querySelector("#priceCount"));
  const uploadedCount = /** @type {HTMLElement} */ (root.querySelector("#uploadedCount"));
  const tbody = /** @type {HTMLElement} */ (root.querySelector("#priceTableBody"));
  const uploadedBody = /** @type {HTMLElement} */ (root.querySelector("#uploadedTableBody"));
  const selectAll = /** @type {HTMLInputElement} */ (
    root.querySelector("#priceTable .price-select-all")
  );
  const selectAllUploaded = /** @type {HTMLInputElement} */ (
    root.querySelector("#uploadedTable .price-select-all")
  );
  const searchInput = /** @type {HTMLInputElement} */ (root.querySelector("#priceSearch"));
  const searchMeta = /** @type {HTMLElement} */ (root.querySelector("#priceSearchMeta"));
  const searchPrev = /** @type {HTMLButtonElement} */ (root.querySelector("#priceSearchPrev"));
  const searchNext = /** @type {HTMLButtonElement} */ (root.querySelector("#priceSearchNext"));
  const uploadedSearchInput = /** @type {HTMLInputElement} */ (
    root.querySelector("#uploadedSearch")
  );
  const uploadedSearchMeta = /** @type {HTMLElement} */ (
    root.querySelector("#uploadedSearchMeta")
  );
  const uploadedSearchPrev = /** @type {HTMLButtonElement} */ (
    root.querySelector("#uploadedSearchPrev")
  );
  const uploadedSearchNext = /** @type {HTMLButtonElement} */ (
    root.querySelector("#uploadedSearchNext")
  );
  const moveUpBtn = /** @type {HTMLButtonElement} */ (root.querySelector("#moveUpBtn"));
  const moveDownBtn = /** @type {HTMLButtonElement} */ (root.querySelector("#moveDownBtn"));
  const deleteUploadedBtn = /** @type {HTMLButtonElement} */ (
    root.querySelector("#deleteUploadedBtn")
  );

  /** @type {object[]} */
  let rows = [];
  /** @type {object[]} */
  let uploadedRows = [];
  /** @type {Set<string>} */
  let checked = new Set();
  /** @type {Set<string>} */
  let uploadedChecked = new Set();
  let fileName = "";
  let savedAt = 0;
  let saveTimer = 0;
  let generation = 0;
  let alive = true;

  const catalogSearch = createTableSearch({
    input: searchInput,
    meta: searchMeta,
    prev: searchPrev,
    next: searchNext,
    getRows: () => rows,
    getBody: () => tbody,
  });
  const uploadedSearch = createTableSearch({
    input: uploadedSearchInput,
    meta: uploadedSearchMeta,
    prev: uploadedSearchPrev,
    next: uploadedSearchNext,
    getRows: () => uploadedRows,
    getBody: () => uploadedBody,
  });

  /**
   * @param {string} message
   * @param {'info'|'success'|'error'} [type]
   */
  function showAlert(message, type = "info") {
    alertBox.textContent = message;
    alertBox.className = `alert-box is-${type}`;
  }

  function hideAlert() {
    alertBox.className = "alert-box d-none";
    alertBox.textContent = "";
  }

  function hasData() {
    return rows.length > 0 || uploadedRows.length > 0;
  }

  function scheduleSave() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      persist().catch((err) => console.error("[price] save:", err));
    }, SAVE_DEBOUNCE_MS);
  }

  async function persist() {
    if (!hasData()) return;
    savedAt = Date.now();
    await savePriceTable({
      rows,
      uploadedRows,
      checkedSeqs: Array.from(checked),
      uploadedCheckedSeqs: Array.from(uploadedChecked),
      fileName,
      savedAt,
    });
    renderMeta();
  }

  /**
   * @param {HTMLInputElement} headerCheck
   * @param {object[]} list
   * @param {Set<string>} selected
   */
  function syncSelectAll(headerCheck, list, selected) {
    if (!list.length) {
      headerCheck.checked = false;
      headerCheck.indeterminate = false;
      return;
    }
    const n = selected.size;
    headerCheck.checked = n === list.length;
    headerCheck.indeterminate = n > 0 && n < list.length;
  }

  function renderMeta() {
    if (!hasData()) {
      fileMeta.classList.add("d-none");
      dropZone.classList.remove("is-compact");
      return;
    }
    fileMeta.classList.remove("d-none");
    dropZone.classList.add("is-compact");
    fileNameEl.textContent = fileName || "저장된 가격표";
    const when = formatSavedAt(savedAt);
    savedAtLabel.textContent = when ? `저장 ${when}` : "";
    priceCount.textContent = `${rows.length.toLocaleString("ko-KR")}건`;
    uploadedCount.textContent = `${uploadedRows.length.toLocaleString("ko-KR")}건`;
  }

  /**
   * @param {HTMLElement} body
   * @param {object[]} list
   * @param {Set<string>} selected
   * @param {string} emptyText
   */
  function fillBody(body, list, selected, emptyText) {
    if (!list.length) {
      body.innerHTML = `<tr class="price-empty-row"><td colspan="11">${escapeHtml(emptyText)}</td></tr>`;
      return;
    }
    body.innerHTML = list.map((row) => renderRowHtml(row, selected.has(rowId(row)))).join("");
  }

  function renderTables() {
    if (!hasData()) {
      resultPanel.classList.add("d-none");
      tbody.innerHTML = "";
      uploadedBody.innerHTML = "";
      renderMeta();
      catalogSearch.reset();
      uploadedSearch.reset();
      return;
    }

    resultPanel.classList.remove("d-none");
    fillBody(tbody, rows, checked, "체크한 제품을 아래에서 위 화살표로 되돌릴 수 있습니다.");
    fillBody(
      uploadedBody,
      uploadedRows,
      uploadedChecked,
      "체크한 제품을 선택한 뒤 아래 화살표로 옮기거나, 선택 삭제로 지울 수 있습니다."
    );
    renderMeta();
    syncSelectAll(selectAll, rows, checked);
    syncSelectAll(selectAllUploaded, uploadedRows, uploadedChecked);
    catalogSearch.refresh();
    uploadedSearch.refresh();
  }

  /**
   * @param {object[]} nextRows
   * @param {{ fileName?: string, checkedSeqs?: number[], uploadedRows?: object[], uploadedCheckedSeqs?: number[], savedAt?: number, alert?: string }} [opts]
   */
  function applyWorkbook(nextRows, opts = {}) {
    rows = withRowIds(nextRows);
    uploadedRows = withRowIds(
      Array.isArray(opts.uploadedRows) ? opts.uploadedRows : []
    );
    fileName = opts.fileName || fileName;
    savedAt = opts.savedAt || Date.now();
    checked = restoreChecked(rows, opts.checkedSeqs || []);
    uploadedChecked = restoreChecked(uploadedRows, opts.uploadedCheckedSeqs || []);
    searchInput.value = "";
    catalogSearch.reset();
    uploadedSearch.reset();
    renderTables();
    if (opts.alert) showAlert(opts.alert, "success");
  }

  function moveDown() {
    const moving = rows.filter((row) => checked.has(rowId(row)));
    if (!moving.length) {
      showAlert("제품가격관리표에서 제품을 체크한 뒤 아래 화살표를 눌러주세요.", "info");
      return;
    }
    const movingIds = new Set(moving.map((row) => rowId(row)));
    rows = rows.filter((row) => !movingIds.has(rowId(row)));
    uploadedRows = [...uploadedRows, ...moving];
    checked.clear();
    renderTables();
    showAlert(`${moving.length.toLocaleString("ko-KR")}건을 업로드한 제품으로 옮겼습니다.`, "success");
    scheduleSave();
  }

  function moveUp() {
    const moving = uploadedRows.filter((row) => uploadedChecked.has(rowId(row)));
    if (!moving.length) {
      showAlert("업로드한 제품에서 제품을 체크한 뒤 위 화살표를 눌러주세요.", "info");
      return;
    }
    const movingIds = new Set(moving.map((row) => rowId(row)));
    uploadedRows = uploadedRows.filter((row) => !movingIds.has(rowId(row)));
    rows = [...rows, ...moving].sort((a, b) => a.seq - b.seq);
    uploadedChecked.clear();
    renderTables();
    showAlert(`${moving.length.toLocaleString("ko-KR")}건을 제품가격관리표로 되돌렸습니다.`, "success");
    scheduleSave();
  }

  function deleteUploaded() {
    const removing = uploadedRows.filter((row) => uploadedChecked.has(rowId(row)));
    if (!removing.length) {
      showAlert("업로드한 제품에서 품목을 체크한 뒤 선택 삭제를 눌러주세요.", "info");
      return;
    }
    const ok = window.confirm(
      `선택한 ${removing.length.toLocaleString("ko-KR")}건을 업로드한 제품에서 삭제할까요?`
    );
    if (!ok) return;
    const removingIds = new Set(removing.map((row) => rowId(row)));
    uploadedRows = uploadedRows.filter((row) => !removingIds.has(rowId(row)));
    uploadedChecked.clear();
    renderTables();
    showAlert(`${removing.length.toLocaleString("ko-KR")}건을 삭제했습니다.`, "success");
    scheduleSave();
  }

  async function onFile(file) {
    if (!file) return;
    const my = ++generation;
    hideAlert();
    showAlert("엑셀을 읽는 중입니다…", "info");
    try {
      const workbook = await loadExcelFile(file);
      if (!alive || my !== generation) return;
      const parsed = parsePriceWorkbook(workbook);
      const preservedUploaded = uploadedRows.slice();
      const preservedChecked = Array.from(uploadedChecked);
      const parts = [
        `제품가격관리표 ${parsed.rows.length.toLocaleString("ko-KR")}건을 새로 불러왔습니다.`,
      ];
      if (preservedUploaded.length) {
        parts.push(
          `업로드한 제품 ${preservedUploaded.length.toLocaleString("ko-KR")}건은 그대로 두었습니다.`
        );
      }
      applyWorkbook(parsed.rows, {
        fileName: file.name,
        checkedSeqs: [],
        uploadedRows: preservedUploaded,
        uploadedCheckedSeqs: preservedChecked,
        savedAt: Date.now(),
        alert: parts.join(" "),
      });
      try {
        await persist();
      } catch (saveErr) {
        console.error("[price] save:", saveErr);
        showAlert("표는 표시했지만 이 브라우저에 저장하지 못했습니다.", "error");
      }
    } catch (err) {
      if (!alive || my !== generation) return;
      console.error("[price] upload:", err);
      showAlert(err?.message || "파일을 처리할 수 없습니다.", "error");
    }
  }

  async function onClearSaved() {
    if (!hasData()) return;
    const ok = window.confirm("저장된 가격표를 지울까요? 원본 엑셀 파일은 그대로 있습니다.");
    if (!ok) return;
    generation += 1;
    rows = [];
    uploadedRows = [];
    checked = new Set();
    uploadedChecked = new Set();
    fileName = "";
    savedAt = 0;
    catalogSearch.reset();
    uploadedSearch.reset();
    renderTables();
    hideAlert();
    try {
      await clearPriceTable();
      showAlert("저장된 표를 지웠습니다.", "info");
    } catch (err) {
      console.error("[price] clear:", err);
      showAlert("저장된 표를 지우지 못했습니다.", "error");
    }
  }

  function openFilePicker() {
    fileInput.click();
  }

  /**
   * @param {Event} ev
   * @param {object[]} list
   * @param {Set<string>} selected
   * @param {HTMLInputElement} headerCheck
   */
  function onRowCheck(ev, list, selected, headerCheck) {
    const target = /** @type {HTMLInputElement} */ (ev.target);
    if (!target.classList.contains("price-row-check")) return;
    const tr = target.closest("tr");
    const id = tr?.getAttribute("data-id");
    if (!id || !findById(list, id)) return;
    if (target.checked) selected.add(id);
    else selected.delete(id);
    syncSelectAll(headerCheck, list, selected);
    scheduleSave();
  }

  /**
   * @param {HTMLInputElement} headerCheck
   * @param {HTMLElement} body
   * @param {object[]} list
   * @param {Set<string>} selected
   */
  function onSelectAll(headerCheck, body, list, selected) {
    const on = headerCheck.checked;
    if (on) list.forEach((row) => selected.add(rowId(row)));
    else selected.clear();
    body.querySelectorAll(".price-row-check").forEach((el) => {
      /** @type {HTMLInputElement} */ (el).checked = on;
    });
    headerCheck.indeterminate = false;
    scheduleSave();
  }

  dropZone.addEventListener("click", openFilePicker);
  dropZone.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      openFilePicker();
    }
  });
  dropZone.addEventListener("dragover", (ev) => {
    ev.preventDefault();
    dropZone.classList.add("is-dragover");
  });
  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("is-dragover");
  });
  dropZone.addEventListener("drop", (ev) => {
    ev.preventDefault();
    dropZone.classList.remove("is-dragover");
    const file = ev.dataTransfer?.files?.[0];
    if (file) onFile(file);
  });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (file) onFile(file);
  });
  clearSavedBtn.addEventListener("click", () => {
    onClearSaved();
  });

  tbody.addEventListener("change", (ev) => {
    onRowCheck(ev, rows, checked, selectAll);
  });
  uploadedBody.addEventListener("change", (ev) => {
    onRowCheck(ev, uploadedRows, uploadedChecked, selectAllUploaded);
  });
  selectAll.addEventListener("change", () => {
    onSelectAll(selectAll, tbody, rows, checked);
  });
  selectAllUploaded.addEventListener("change", () => {
    onSelectAll(selectAllUploaded, uploadedBody, uploadedRows, uploadedChecked);
  });
  moveDownBtn.addEventListener("click", moveDown);
  moveUpBtn.addEventListener("click", moveUp);
  deleteUploadedBtn.addEventListener("click", deleteUploaded);

  loadPriceTable()
    .then((record) => {
      if (!alive || !record) return;
      applyWorkbook(record.rows || [], {
        fileName: record.fileName || "",
        checkedSeqs: record.checkedSeqs || [],
        uploadedRows: record.uploadedRows || [],
        uploadedCheckedSeqs: record.uploadedCheckedSeqs || [],
        savedAt: record.savedAt || Date.now(),
      });
    })
    .catch((err) => {
      console.error("[price] restore:", err);
    });

  return () => {
    alive = false;
    generation += 1;
    catalogSearch.destroy();
    uploadedSearch.destroy();
    window.clearTimeout(saveTimer);
    appShell?.classList.remove("is-wide");
  };
}
