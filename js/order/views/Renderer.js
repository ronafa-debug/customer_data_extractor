/**
 * Renderer — DOM 렌더링 전담 (UI 계층)
 */
import { OUTPUT_MODE } from "../constants.js";
import { buildExportText } from "../services/ExportService.js";
import { filterCustomers, filterProducts } from "../services/SearchService.js";
import { mergeAllProducts } from "../utils/MergeProduct.js";
import { calculateStatistics } from "../services/StatisticsService.js";

export class Renderer {
  /**
   * @param {Record<string, HTMLElement>} els
   */
  constructor(els) {
    this.els = els;
  }

  /**
   * @param {string} message
   * @param {'info'|'success'|'error'} [type]
   */
  showAlert(message, type = "info") {
    const box = this.els.alertBox;
    box.textContent = message;
    box.className = `alert-box is-${type}`;
  }

  hideAlert() {
    const box = this.els.alertBox;
    box.className = "alert-box d-none";
    box.textContent = "";
  }

  /**
   * @param {string} label
   * @param {string} mallId
   */
  updateMallBadge(label, mallId) {
    const badge = this.els.mallBadge;
    badge.textContent = label || "—";
    badge.classList.remove("is-coupang", "is-naver");
    if (mallId === "coupang") badge.classList.add("is-coupang");
    if (mallId === "naver") badge.classList.add("is-naver");
  }

  /**
   * @param {string} fileName
   * @param {string} mallLabel
   * @param {string} mallId
   */
  showFileMeta(fileName, mallLabel, mallId) {
    this.els.fileName.textContent = fileName;
    this.updateMallBadge(mallLabel, mallId);
    this.els.fileMeta.classList.remove("d-none");
  }

  hideFileMeta() {
    this.els.fileMeta.classList.add("d-none");
    this.els.fileName.textContent = "";
    this.updateMallBadge("—", "");
  }

  /**
   * @param {import('../model/Customer.js').Customer[]} customers
   */
  renderStats(customers) {
    if (!customers.length) {
      this.els.statsSection.classList.add("d-none");
      return;
    }

    const stats = calculateStatistics(customers);
    this.els.statCustomers.textContent = String(stats.totalCustomers);
    this.els.statProducts.textContent = String(stats.totalProductKinds);
    this.els.statQty.textContent = String(stats.totalQuantity);
    this.els.statMessages.textContent = String(stats.messageCount);
    this.els.statsSection.classList.remove("d-none");
  }

  /**
   * @param {import('../model/Customer.js').Customer[]} customers
   * @param {string} mode
   * @param {string} query
   * @returns {string} 현재 화면에 표시된 텍스트
   */
  renderResult(customers, mode, query) {
    if (!customers.length) {
      this.els.resultOutput.textContent =
        "파일을 업로드한 뒤 변환을 눌러주세요.";
      this.els.resultCount.textContent = "";
      return "";
    }

    let text = "";
    let countLabel = "";

    if (mode === OUTPUT_MODE.PICKING) {
      const all = mergeAllProducts(customers);
      const filtered = filterProducts(all, query);
      text = buildExportText(customers, mode, filtered);
      if (!text) {
        text = query.trim() ? "검색 결과가 없습니다." : "주문 데이터가 없습니다.";
      } else {
        countLabel = `상품 ${filtered.length}종`;
      }
    } else {
      const filtered = filterCustomers(customers, query);
      text = buildExportText(filtered, mode);
      if (!text) {
        text = query.trim() ? "검색 결과가 없습니다." : "주문 데이터가 없습니다.";
      } else {
        countLabel = `고객 ${filtered.length}명`;
      }
    }

    this.els.resultOutput.textContent = text;
    this.els.resultCount.textContent = countLabel;
    return text;
  }

  /**
   * @param {boolean} enabled
   */
  setResultActionsEnabled(enabled) {
    this.els.copyBtn.disabled = !enabled;
    this.els.downloadBtn.disabled = !enabled;
    this.els.searchInput.disabled = !enabled;
    if (!enabled) this.els.searchInput.value = "";
  }

  /**
   * @param {boolean} enabled
   */
  setConvertEnabled(enabled) {
    this.els.convertBtn.disabled = !enabled;
  }

  /**
   * @param {boolean} enabled
   */
  setResetEnabled(enabled) {
    this.els.resetBtn.disabled = !enabled;
  }

  setDropDragover(active) {
    this.els.dropZone.classList.toggle("is-dragover", active);
  }
}
