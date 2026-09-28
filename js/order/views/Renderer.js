/**
 * Renderer — DOM 렌더링 전담 (UI 계층)
 */
import { OUTPUT_MODE, CUSTOMER_SEPARATOR, ERROR_MESSAGE } from "../constants.js";
import {
  buildExportText,
  formatCustomerBlock,
  copyAll,
} from "../services/ExportService.js";
import { filterCustomers, filterProducts } from "../services/SearchService.js";
import { mergeAllProducts } from "../utils/MergeProduct.js";
import { calculateStatistics } from "../services/StatisticsService.js";

export class Renderer {
  /**
   * @param {Record<string, HTMLElement>} els
   */
  constructor(els) {
    this.els = els;
    /** @type {string[]} */
    this._blockTexts = [];
    this.els.resultOutput?.addEventListener("click", (e) => {
      this.#handleResultClick(/** @type {MouseEvent} */ (e));
    });
  }

  /**
   * @param {MouseEvent} e
   */
  async #handleResultClick(e) {
    const target = /** @type {HTMLElement} */ (e.target);
    const btn = target.closest?.(".btn-copy-customer");
    if (!btn || !this.els.resultOutput.contains(btn)) return;

    const index = Number(btn.getAttribute("data-index"));
    const text = this._blockTexts[index];
    if (!text?.trim()) {
      this.showAlert(ERROR_MESSAGE.COPY_EMPTY, "error");
      return;
    }

    try {
      await copyAll(text);
      btn.textContent = "복사완료";
      btn.classList.add("is-copied");
      btn.setAttribute("aria-label", "복사완료");
    } catch (err) {
      console.error("[order] copy customer:", err);
      this.showAlert(err?.message || ERROR_MESSAGE.COPY_FAIL, "error");
    }
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
   * 빈 상태 / 메시지 텍스트만 표시
   * @param {string} message
   */
  #renderPlainMessage(message) {
    this._blockTexts = [];
    const el = this.els.resultOutput;
    el.classList.add("is-plain");
    el.classList.remove("has-blocks");
    el.textContent = message;
  }

  /**
   * 피킹용 — 단일 pre 텍스트
   * @param {string} text
   */
  #renderPlainText(text) {
    this._blockTexts = [];
    const el = this.els.resultOutput;
    el.classList.add("is-plain");
    el.classList.remove("has-blocks");
    el.textContent = text;
  }

  /**
   * 고객별 블록 + 복사 버튼
   * @param {string[]} blocks
   */
  #renderCustomerBlocks(blocks) {
    this._blockTexts = blocks.slice();
    const el = this.els.resultOutput;
    el.classList.remove("is-plain");
    el.classList.add("has-blocks");
    el.replaceChildren();

    const frag = document.createDocumentFragment();
    blocks.forEach((blockText, index) => {
      const article = document.createElement("article");
      article.className = "customer-block";

      const pre = document.createElement("pre");
      pre.className = "customer-block-text";
      pre.textContent = blockText;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn-copy-customer";
      btn.dataset.index = String(index);
      btn.textContent = "복사하기";
      btn.setAttribute("aria-label", `${index + 1}번째 고객 정보 복사`);

      const sep = document.createElement("div");
      sep.className = "customer-block-sep";
      sep.setAttribute("aria-hidden", "true");
      sep.textContent = CUSTOMER_SEPARATOR;

      article.append(pre, btn, sep);
      frag.appendChild(article);
    });
    el.appendChild(frag);
  }

  /**
   * @param {import('../model/Customer.js').Customer[]} customers
   * @param {string} mode
   * @param {string} query
   * @returns {string} 전체 복사·다운로드용 텍스트
   */
  renderResult(customers, mode, query) {
    if (!customers.length) {
      this.#renderPlainMessage("파일을 업로드한 뒤 변환을 눌러주세요.");
      this.els.resultCount.textContent = "";
      return "";
    }

    let fullText = "";
    let countLabel = "";

    if (mode === OUTPUT_MODE.PICKING) {
      const all = mergeAllProducts(customers);
      const filtered = filterProducts(all, query);
      fullText = buildExportText(customers, mode, filtered);
      if (!fullText) {
        this.#renderPlainMessage(
          query.trim() ? "검색 결과가 없습니다." : "주문 데이터가 없습니다."
        );
      } else {
        this.#renderPlainText(fullText);
        countLabel = `상품 ${filtered.length}종`;
      }
    } else {
      const filtered = filterCustomers(customers, query);
      fullText = buildExportText(filtered, mode);
      if (!fullText) {
        this.#renderPlainMessage(
          query.trim() ? "검색 결과가 없습니다." : "주문 데이터가 없습니다."
        );
      } else {
        const blocks = filtered.map((c) => formatCustomerBlock(c, mode));
        this.#renderCustomerBlocks(blocks);
        countLabel = `고객 ${filtered.length}명`;
      }
    }

    this.els.resultCount.textContent = countLabel;
    return fullText;
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

  /** @param {boolean} enabled */
  setSaveEnabled(enabled) {
    this.els.saveOrderBtn.disabled = !enabled;
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
