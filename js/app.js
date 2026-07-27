/**
 * app.js — SPA 엔트리포인트
 * UI 이벤트와 서비스/파서를 연결한다. (비즈니스 로직 없음)
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
import { filterCustomers, filterProducts, debounce } from "./services/SearchService.js";
import { mergeAllProducts } from "./utils/MergeProduct.js";
import { calculateStatistics } from "./services/StatisticsService.js";
import { ParserFactory } from "./parser/ParserFactory.js";
import { Renderer } from "./views/Renderer.js";

/**
 * @returns {Record<string, HTMLElement>}
 */
function queryElements() {
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
    const el = document.getElementById(id);
    if (!el) throw new Error(`필수 DOM 요소 없음: #${id}`);
    els[id] = el;
  }
  return els;
}

/**
 * 앱 상태 (모듈 스코프 — 전역 오염 없음)
 * @type {{
 *   file: File | null,
 *   workbook: object | null,
 *   mallId: string,
 *   mallLabel: string,
 *   customers: import('./model/Customer.js').Customer[],
 *   outputMode: string,
 *   lastRenderedText: string
 * }}
 */
const state = {
  file: null,
  workbook: null,
  mallId: "",
  mallLabel: "",
  customers: [],
  outputMode: OUTPUT_MODE.BASIC,
  lastRenderedText: "",
};

/**
 * @param {'light'|'dark'} theme
 */
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (_) {
    // 개인정보 저장 금지 — 테마만 시도, 실패해도 무시
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
  applyTheme(saved === "dark" || saved === "light" ? saved : prefersDark ? "dark" : "light");
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  applyTheme(current === "dark" ? "light" : "dark");
}

/**
 * @param {Renderer} renderer
 */
function refreshView(renderer) {
  renderer.renderStats(state.customers);
  state.lastRenderedText = renderer.renderResult(
    state.customers,
    state.outputMode,
    /** @type {HTMLInputElement} */ (renderer.els.searchInput).value
  );
}

/**
 * @param {Renderer} renderer
 */
function resetFile(renderer) {
  state.file = null;
  state.workbook = null;
  state.mallId = "";
  state.mallLabel = "";
  /** @type {HTMLInputElement} */ (renderer.els.fileInput).value = "";
  renderer.hideFileMeta();
  renderer.setConvertEnabled(false);
}

/**
 * @param {Renderer} renderer
 */
function fullReset(renderer) {
  resetFile(renderer);
  state.customers = [];
  state.outputMode = OUTPUT_MODE.BASIC;
  state.lastRenderedText = "";
  const basic = document.getElementById("modeBasic");
  if (basic) /** @type {HTMLInputElement} */ (basic).checked = true;
  renderer.setResultActionsEnabled(false);
  renderer.setResetEnabled(false);
  refreshView(renderer);
  renderer.hideAlert();
}

/**
 * @param {File} file
 * @param {Renderer} renderer
 */
async function handleFile(file, renderer) {
  renderer.hideAlert();
  state.customers = [];
  renderer.setResultActionsEnabled(false);
  refreshView(renderer);

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
    console.error("[app] handleFile:", err);
    resetFile(renderer);
    renderer.showAlert(err.message || ERROR_MESSAGE.OPEN_FAIL, "error");
  }
}

/**
 * @param {Renderer} renderer
 */
async function convert(renderer) {
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
    refreshView(renderer);
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
    console.error("[app] convert:", err);
    renderer.showAlert(err.message || "변환 중 오류가 발생했습니다.", "error");
  } finally {
    renderer.setConvertEnabled(Boolean(state.workbook));
  }
}

/**
 * 현재 화면/검색 기준 텍스트
 * @param {Renderer} renderer
 * @returns {string}
 */
function getCurrentText(renderer) {
  const query = /** @type {HTMLInputElement} */ (renderer.els.searchInput).value;
  if (state.outputMode === OUTPUT_MODE.PICKING) {
    const filtered = filterProducts(mergeAllProducts(state.customers), query);
    return buildExportText(state.customers, state.outputMode, filtered);
  }
  const filtered = filterCustomers(state.customers, query);
  return buildExportText(filtered, state.outputMode);
}

/**
 * @param {Renderer} renderer
 */
function bindEvents(renderer) {
  const els = renderer.els;

  els.themeToggle.addEventListener("click", toggleTheme);

  els.dropZone.addEventListener("click", () => {
    /** @type {HTMLInputElement} */ (els.fileInput).click();
  });

  els.dropZone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      /** @type {HTMLInputElement} */ (els.fileInput).click();
    }
  });

  els.fileInput.addEventListener("change", (e) => {
    const input = /** @type {HTMLInputElement} */ (e.target);
    const file = input.files && input.files[0];
    if (file) handleFile(file, renderer);
  });

  ["dragenter", "dragover"].forEach((evt) => {
    els.dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      renderer.setDropDragover(true);
    });
  });

  ["dragleave", "drop"].forEach((evt) => {
    els.dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      renderer.setDropDragover(false);
    });
  });

  els.dropZone.addEventListener("drop", (e) => {
    const dt = /** @type {DragEvent} */ (e).dataTransfer;
    const file = dt?.files?.[0];
    if (file) handleFile(file, renderer);
  });

  els.clearFileBtn.addEventListener("click", () => {
    resetFile(renderer);
    state.customers = [];
    renderer.setResultActionsEnabled(false);
    refreshView(renderer);
    renderer.hideAlert();
  });

  els.convertBtn.addEventListener("click", () => convert(renderer));

  els.copyBtn.addEventListener("click", async () => {
    try {
      const text = getCurrentText(renderer);
      await copyAll(text);
      renderer.showAlert("전체 내용을 클립보드에 복사했습니다.", "success");
    } catch (err) {
      console.error("[app] copy:", err);
      renderer.showAlert(err.message || ERROR_MESSAGE.COPY_FAIL, "error");
    }
  });

  els.downloadBtn.addEventListener("click", () => {
    try {
      const text = getCurrentText(renderer);
      downloadTxt(text);
      renderer.showAlert("TXT 파일을 다운로드했습니다.", "success");
    } catch (err) {
      console.error("[app] download:", err);
      renderer.showAlert(err.message || "다운로드에 실패했습니다.", "error");
    }
  });

  els.resetBtn.addEventListener("click", () => fullReset(renderer));

  const onSearch = debounce(() => {
    refreshView(renderer);
  }, SEARCH_DEBOUNCE_MS);

  els.searchInput.addEventListener("input", onSearch);

  document.querySelectorAll('input[name="outputMode"]').forEach((input) => {
    input.addEventListener("change", (e) => {
      state.outputMode = /** @type {HTMLInputElement} */ (e.target).value;
      refreshView(renderer);
    });
  });
}

function main() {
  const els = queryElements();
  const renderer = new Renderer(els);
  initTheme();
  bindEvents(renderer);
}

main();
