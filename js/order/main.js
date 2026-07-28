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
   *   lastRenderedText: string
   * }} */
  const state = {
    file: null,
    workbook: null,
    mallId: "",
    mallLabel: "",
    customers: [],
    outputMode: OUTPUT_MODE.BASIC,
    lastRenderedText: "",
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
    const basic = root.querySelector("#modeBasic");
    if (basic) /** @type {HTMLInputElement} */ (basic).checked = true;
    renderer.setResultActionsEnabled(false);
    renderer.setResetEnabled(false);
    refreshView();
    renderer.hideAlert();
  }

  /**
   * @param {File} file
   */
  async function handleFile(file) {
    renderer.hideAlert();
    state.customers = [];
    renderer.setResultActionsEnabled(false);
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
      renderer.updateMallBadge(parser.mallLabel, parser.mallId);
      refreshView();
      renderer.setResultActionsEnabled(customers.length > 0);
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
      renderer.setResultActionsEnabled(false);
      refreshView();
      renderer.hideAlert();
    });
    on(els.convertBtn, "click", () => convert());
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

  return {
    destroy() {
      for (const [target, type, handler] of listeners) {
        target.removeEventListener(type, handler);
      }
      listeners.length = 0;
    },
  };
}
