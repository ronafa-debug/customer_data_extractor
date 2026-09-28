/**
 * 주문내역 고객정보 추출기 — 마운트 가능한 엔트리
 * 툴킷 SPA의 OrderExtractorView에서 호출한다.
 */
import {
  OUTPUT_MODE,
  THEME_STORAGE_KEY,
  ERROR_MESSAGE,
  SEARCH_DEBOUNCE_MS,
} from "./constants.js";
import { loadExcelFile } from "./services/ExcelService.js";
import {
  buildExportText,
  copyAll,
  downloadTxt,
} from "./services/ExportService.js";
import {
  filterCustomers,
  filterProducts,
  debounce,
} from "./services/SearchService.js";
import { mergeAllProducts } from "./utils/MergeProduct.js";
import { calculateStatistics } from "./services/StatisticsService.js";
import { ParserFactory } from "./parser/ParserFactory.js";
import { Renderer } from "./views/Renderer.js";
import {
  deleteOrderBatch,
  deleteOrderDate,
  loadOrderBatches,
  saveOrderBatch,
} from "./services/OrderHistoryStore.js";
import {
  formatOrderDate,
  getBatchesForDate,
  getCustomersForDate,
  summarizeOrderBatches,
} from "./model/OrderBatch.js";

/**
 * @param {ParentNode} root
 * @returns {Record<string, HTMLElement>}
 */
function queryElements(root) {
  const ids = [
    "dropZone",
    "fileInput",
    "fileMeta",
    "mallBadge",
    "fileName",
    "clearFileBtn",
    "convertBtn",
    "saveOrderBtn",
    "copyBtn",
    "downloadBtn",
    "resetBtn",
    "searchInput",
    "statsSection",
    "statCustomers",
    "statProducts",
    "statQty",
    "statMessages",
    "alertBox",
    "resultOutput",
    "resultCount",
    "resultTitle",
    "orderHistoryList",
    "orderHistoryDetail",
    "themeToggle",
  ];

  /** @type {Record<string, HTMLElement>} */
  const els = {};
  for (const id of ids) {
    const el = root.querySelector(`#${id}`);
    if (!el) throw new Error(`필수 DOM 요소 없음: #${id}`);
    els[id] = /** @type {HTMLElement} */ (el);
  }
  return els;
}

/**
 * @param {ParentNode} root
 * @returns {{ destroy: () => void }}
 */
export function mountOrderExtractor(root) {
  /** @type {{
   *   file: File | null,
   *   workbook: object | null,
   *   mallId: string,
   *   mallLabel: string,
   *   customers: import('./model/Customer.js').Customer[],
   *   outputMode: string,
   *   lastRenderedText: string,
   *   resultSource: 'none'|'extracted'|'saved',
   *   orderBatches: object[],
   *   selectedDateKey: string,
   *   saving: boolean
   * }} */
  const state = {
    file: null,
    workbook: null,
    mallId: "",
    mallLabel: "",
    customers: [],
    outputMode: OUTPUT_MODE.BASIC,
    lastRenderedText: "",
    resultSource: "none",
    orderBatches: [],
    selectedDateKey: "",
    saving: false,
  };

  const els = queryElements(root);
  const renderer = new Renderer(els);
  /** @type {Array<[EventTarget, string, EventListener]>} */
  const listeners = [];

  /**
   * @param {EventTarget} target
   * @param {string} type
   * @param {EventListener} handler
   */
  function on(target, type, handler) {
    target.addEventListener(type, handler);
    listeners.push([target, type, handler]);
  }

  /**
   * @param {'light'|'dark'} theme
   */
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (_) {
      /* ignore */
    }
  }

  function initTheme() {
    let saved = null;
    try {
      saved = localStorage.getItem(THEME_STORAGE_KEY);
    } catch (_) {
      saved = null;
    }
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(
      saved === "dark" || saved === "light"
        ? saved
        : prefersDark
          ? "dark"
          : "light"
    );
  }

  function toggleTheme() {
    const current =
      document.documentElement.getAttribute("data-theme") || "light";
    applyTheme(current === "dark" ? "light" : "dark");
  }

  function refreshView() {
    renderer.renderStats(state.customers);
    state.lastRenderedText = renderer.renderResult(
      state.customers,
      state.outputMode,
      /** @type {HTMLInputElement} */ (renderer.els.searchInput).value
    );
  }

  function resetResultTitle() {
    els.resultTitle.textContent = "변환 결과";
  }

  function updateSaveButton() {
    renderer.setSaveEnabled(
      state.resultSource === "extracted" &&
        state.customers.length > 0 &&
        !state.saving
    );
  }

  function resetFile() {
    state.file = null;
    state.workbook = null;
    state.mallId = "";
    state.mallLabel = "";
    /** @type {HTMLInputElement} */ (renderer.els.fileInput).value = "";
    renderer.hideFileMeta();
    renderer.setConvertEnabled(false);
  }

  function fullReset() {
    resetFile();
    state.customers = [];
    state.outputMode = OUTPUT_MODE.BASIC;
    state.lastRenderedText = "";
    state.resultSource = "none";
    const basic = root.querySelector("#modeBasic");
    if (basic) /** @type {HTMLInputElement} */ (basic).checked = true;
    renderer.setResultActionsEnabled(false);
    updateSaveButton();
    renderer.setResetEnabled(false);
    refreshView();
    renderer.hideAlert();
    resetResultTitle();
  }

  /**
   * @param {File} file
   */
  async function handleFile(file) {
    renderer.hideAlert();
    state.customers = [];
    state.resultSource = "none";
    renderer.setResultActionsEnabled(false);
    updateSaveButton();
    resetResultTitle();
    refreshView();
    if (!file) return;

    try {
      renderer.setConvertEnabled(false);
      renderer.showAlert("파일을 분석하는 중…", "info");
      const workbook = await loadExcelFile(file);
      const parser = ParserFactory.detect(workbook);
      state.file = file;
      state.workbook = workbook;
      state.mallId = parser.mallId;
      state.mallLabel = parser.mallLabel;
      renderer.showFileMeta(file.name, parser.mallLabel, parser.mallId);
      renderer.setConvertEnabled(true);
      renderer.setResetEnabled(true);
      renderer.showAlert(
        `${parser.mallLabel}로 인식되었습니다. 변환을 눌러주세요.`,
        "success"
      );
    } catch (err) {
      console.error("[order] handleFile:", err);
      resetFile();
      renderer.showAlert(err.message || ERROR_MESSAGE.OPEN_FAIL, "error");
    }
  }

  async function convert() {
    if (!state.workbook) {
      renderer.showAlert("먼저 Excel 파일을 업로드해주세요.", "error");
      return;
    }
    try {
      renderer.setConvertEnabled(false);
      renderer.showAlert("변환 중…", "info");
      await new Promise((r) => setTimeout(r, 0));
      const { parser, customers } = ParserFactory.parse(state.workbook);
      state.mallId = parser.mallId;
      state.mallLabel = parser.mallLabel;
      state.customers = customers;
      state.resultSource = customers.length ? "extracted" : "none";
      renderer.updateMallBadge(parser.mallLabel, parser.mallId);
      refreshView();
      renderer.setResultActionsEnabled(customers.length > 0);
      updateSaveButton();
      resetResultTitle();
      renderer.setResetEnabled(true);
      if (!customers.length) {
        renderer.showAlert(ERROR_MESSAGE.NO_ORDER_DATA, "error");
      } else {
        const stats = calculateStatistics(customers);
        renderer.showAlert(
          `변환 완료 — 고객 ${stats.totalCustomers}명, 상품 ${stats.totalProductKinds}종`,
          "success"
        );
      }
    } catch (err) {
      console.error("[order] convert:", err);
      renderer.showAlert(err.message || "변환 중 오류가 발생했습니다.", "error");
    } finally {
      renderer.setConvertEnabled(Boolean(state.workbook));
    }
  }

  /** @param {Date} date */
  function formatTime(date) {
    return new Intl.DateTimeFormat("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }

  function renderHistory() {
    const summaries = summarizeOrderBatches(state.orderBatches);
    els.orderHistoryList.replaceChildren();

    if (!summaries.length) {
      const empty = document.createElement("p");
      empty.className = "order-history-empty";
      empty.textContent = "아직 저장된 주문내역이 없습니다.";
      els.orderHistoryList.appendChild(empty);
      els.orderHistoryDetail.classList.add("d-none");
      els.orderHistoryDetail.replaceChildren();
      return;
    }

    const frag = document.createDocumentFragment();
    for (const summary of summaries) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "order-history-date";
      button.dataset.dateKey = summary.dateKey;

      const date = document.createElement("strong");
      date.textContent = formatOrderDate(summary.dateKey);
      const meta = document.createElement("span");
      meta.textContent = `고객 ${summary.customerCount}명 · 저장 ${summary.batchCount}회`;
      const arrow = document.createElement("span");
      arrow.className = "order-history-arrow";
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = ">";
      button.append(date, meta, arrow);
      frag.appendChild(button);
    }
    els.orderHistoryList.appendChild(frag);
  }

  /** @param {string} dateKey */
  function renderHistoryDetail(dateKey) {
    const batches = getBatchesForDate(state.orderBatches, dateKey);
    const total = batches.reduce((sum, batch) => sum + batch.customerCount, 0);
    const detail = els.orderHistoryDetail;
    detail.replaceChildren();
    if (!batches.length) {
      detail.classList.add("d-none");
      return;
    }

    const header = document.createElement("div");
    header.className = "order-history-detail-header";
    const titleWrap = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = formatOrderDate(dateKey);
    const count = document.createElement("p");
    count.textContent = `전체 고객 ${total}명 · 저장 ${batches.length}회`;
    titleWrap.append(title, count);

    const deleteDateBtn = document.createElement("button");
    deleteDateBtn.type = "button";
    deleteDateBtn.className = "btn btn-sm btn-outline-danger";
    deleteDateBtn.dataset.deleteDate = dateKey;
    deleteDateBtn.textContent = "이 날짜 전체 삭제";
    header.append(titleWrap, deleteDateBtn);

    const label = document.createElement("h4");
    label.className = "order-history-batch-title";
    label.textContent = "저장 기록";
    const list = document.createElement("div");
    list.className = "order-history-batches";
    for (const batch of batches) {
      const row = document.createElement("div");
      row.className = "order-history-batch";
      const meta = document.createElement("span");
      const createdAt = new Date(batch.createdAt);
      meta.textContent = `${formatTime(createdAt)} · 고객 ${batch.customerCount}명`;
      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn btn-sm btn-outline-danger";
      del.dataset.deleteBatch = batch.id;
      del.dataset.customerCount = String(batch.customerCount);
      del.textContent = "삭제";
      row.append(meta, del);
      list.appendChild(row);
    }
    detail.append(header, label, list);
    detail.classList.remove("d-none");
  }

  async function reloadHistory() {
    try {
      state.orderBatches = await loadOrderBatches();
      renderHistory();
      if (state.selectedDateKey) {
        renderHistoryDetail(state.selectedDateKey);
      }
    } catch (err) {
      console.error("[order] history load:", err);
      els.orderHistoryList.textContent =
        "저장된 주문내역을 불러오지 못했습니다. 기존 Excel 변환 기능은 계속 사용할 수 있습니다.";
    }
  }

  async function saveCurrentOrders() {
    if (state.saving) return;
    if (state.resultSource !== "extracted" || !state.customers.length) {
      renderer.showAlert("저장할 고객정보가 없습니다.", "error");
      return;
    }
    state.saving = true;
    updateSaveButton();
    try {
      const batch = await saveOrderBatch(state.customers);
      await reloadHistory();
      renderer.showAlert(
        `✓ ${formatOrderDate(batch.dateKey)} 주문내역에 고객 ${batch.customerCount}명을 저장했습니다.`,
        "success"
      );
    } catch (err) {
      console.error("[order] history save:", err);
      renderer.showAlert(
        "주문내역을 이 브라우저에 저장하지 못했습니다. 추출 결과는 그대로 유지됩니다.",
        "error"
      );
    } finally {
      state.saving = false;
      updateSaveButton();
    }
  }

  /** @param {string} dateKey */
  function openSavedDate(dateKey) {
    const customers = getCustomersForDate(state.orderBatches, dateKey);
    if (!customers.length) {
      renderer.showAlert("이 날짜에 표시할 저장 주문이 없습니다.", "error");
      return;
    }
    state.selectedDateKey = dateKey;
    state.customers = customers;
    state.resultSource = "saved";
    /** @type {HTMLInputElement} */ (els.searchInput).value = "";
    renderer.setResultActionsEnabled(true);
    updateSaveButton();
    els.resultTitle.textContent = `${formatOrderDate(dateKey)} 저장된 주문내역`;
    refreshView();
    renderHistoryDetail(dateKey);
    renderer.showAlert(
      `${formatOrderDate(dateKey)} 저장 주문 고객 ${customers.length}명을 열었습니다.`,
      "success"
    );
  }

  async function removeBatch(id, customerCount) {
    if (!window.confirm(
      `이 저장 기록을 삭제하시겠습니까?\n저장된 고객 ${customerCount}명의 정보가 삭제됩니다.`
    )) return;
    try {
      await deleteOrderBatch(id);
      await reloadHistory();
      if (state.selectedDateKey) {
        const remaining = getCustomersForDate(
          state.orderBatches,
          state.selectedDateKey
        );
        if (state.resultSource === "saved") {
          state.customers = remaining;
          renderer.setResultActionsEnabled(remaining.length > 0);
          refreshView();
          if (!remaining.length) {
            state.resultSource = "none";
            state.selectedDateKey = "";
            resetResultTitle();
          }
          updateSaveButton();
        }
      }
      renderer.showAlert("저장 기록을 삭제했습니다.", "success");
    } catch (err) {
      console.error("[order] history delete batch:", err);
      renderer.showAlert("저장 기록을 삭제하지 못했습니다.", "error");
    }
  }

  async function removeDate(dateKey) {
    const batches = getBatchesForDate(state.orderBatches, dateKey);
    const total = batches.reduce((sum, batch) => sum + batch.customerCount, 0);
    if (!window.confirm(
      `${formatOrderDate(dateKey)}에 저장된 모든 주문내역을 삭제하시겠습니까?\n총 고객 ${total}명의 저장 정보가 삭제됩니다.`
    )) return;
    try {
      await deleteOrderDate(dateKey);
      if (state.resultSource === "saved" && state.selectedDateKey === dateKey) {
        state.customers = [];
        state.resultSource = "none";
        state.selectedDateKey = "";
        renderer.setResultActionsEnabled(false);
        refreshView();
        resetResultTitle();
        updateSaveButton();
      }
      await reloadHistory();
      renderer.showAlert("해당 날짜의 저장 주문을 모두 삭제했습니다.", "success");
    } catch (err) {
      console.error("[order] history delete date:", err);
      renderer.showAlert("날짜별 저장 주문을 삭제하지 못했습니다.", "error");
    }
  }

  function getCurrentText() {
    const query = /** @type {HTMLInputElement} */ (renderer.els.searchInput)
      .value;
    if (state.outputMode === OUTPUT_MODE.PICKING) {
      const filtered = filterProducts(mergeAllProducts(state.customers), query);
      return buildExportText(state.customers, state.outputMode, filtered);
    }
    const filtered = filterCustomers(state.customers, query);
    return buildExportText(filtered, state.outputMode);
  }

  function bindEvents() {
    on(els.themeToggle, "click", toggleTheme);
    on(els.dropZone, "click", () => {
      /** @type {HTMLInputElement} */ (els.fileInput).click();
    });
    on(els.dropZone, "keydown", (e) => {
      const ke = /** @type {KeyboardEvent} */ (e);
      if (ke.key === "Enter" || ke.key === " ") {
        ke.preventDefault();
        /** @type {HTMLInputElement} */ (els.fileInput).click();
      }
    });
    on(els.fileInput, "change", (e) => {
      const input = /** @type {HTMLInputElement} */ (e.target);
      const file = input.files && input.files[0];
      if (file) handleFile(file);
    });
    ["dragenter", "dragover"].forEach((evt) => {
      on(els.dropZone, evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        renderer.setDropDragover(true);
      });
    });
    ["dragleave", "drop"].forEach((evt) => {
      on(els.dropZone, evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        renderer.setDropDragover(false);
      });
    });
    on(els.dropZone, "drop", (e) => {
      const dt = /** @type {DragEvent} */ (e).dataTransfer;
      const file = dt?.files?.[0];
      if (file) handleFile(file);
    });
    on(els.clearFileBtn, "click", () => {
      resetFile();
      state.customers = [];
      state.resultSource = "none";
      renderer.setResultActionsEnabled(false);
      updateSaveButton();
      resetResultTitle();
      refreshView();
      renderer.hideAlert();
    });
    on(els.convertBtn, "click", () => convert());
    on(els.saveOrderBtn, "click", () => saveCurrentOrders());
    on(els.copyBtn, "click", async () => {
      try {
        await copyAll(getCurrentText());
        renderer.showAlert("전체 내용을 클립보드에 복사했습니다.", "success");
      } catch (err) {
        console.error("[order] copy:", err);
        renderer.showAlert(err.message || ERROR_MESSAGE.COPY_FAIL, "error");
      }
    });
    on(els.downloadBtn, "click", () => {
      try {
        downloadTxt(getCurrentText());
        renderer.showAlert("TXT 파일을 다운로드했습니다.", "success");
      } catch (err) {
        console.error("[order] download:", err);
        renderer.showAlert(err.message || "다운로드에 실패했습니다.", "error");
      }
    });
    on(els.resetBtn, "click", () => fullReset());
    on(els.orderHistoryList, "click", (e) => {
      const button = /** @type {HTMLElement} */ (e.target).closest?.(
        "[data-date-key]"
      );
      const dateKey = button?.getAttribute("data-date-key");
      if (dateKey) openSavedDate(dateKey);
    });
    on(els.orderHistoryDetail, "click", (e) => {
      const target = /** @type {HTMLElement} */ (e.target);
      const batchButton = target.closest?.("[data-delete-batch]");
      if (batchButton) {
        removeBatch(
          batchButton.getAttribute("data-delete-batch") || "",
          Number(batchButton.getAttribute("data-customer-count")) || 0
        );
        return;
      }
      const dateButton = target.closest?.("[data-delete-date]");
      const dateKey = dateButton?.getAttribute("data-delete-date");
      if (dateKey) removeDate(dateKey);
    });

    const onSearch = debounce(() => refreshView(), SEARCH_DEBOUNCE_MS);
    on(els.searchInput, "input", /** @type {EventListener} */ (onSearch));

    root.querySelectorAll('input[name="outputMode"]').forEach((input) => {
      on(input, "change", (e) => {
        state.outputMode = /** @type {HTMLInputElement} */ (e.target).value;
        refreshView();
      });
    });
  }

  initTheme();
  bindEvents();
  reloadHistory();

  return {
    destroy() {
      for (const [target, type, handler] of listeners) {
        target.removeEventListener(type, handler);
      }
      listeners.length = 0;
    },
  };
}
