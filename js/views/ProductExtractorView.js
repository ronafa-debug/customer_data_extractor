/**
 * 제품 정보 추출기 뷰
 */
import { go } from "../router/Router.js";
import { ProductParserFactory } from "../product/ProductParserFactory.js";
import { captureProduct } from "../services/CaptureService.js";
import {
  downloadPng,
  downloadPngsDirect,
  downloadSuccessMessage,
} from "../services/DownloadService.js";
import {
  renderImagePreview,
  getSelectedImageIds,
} from "../components/ImagePreview.js";

/**
 * @param {HTMLElement} root
 * @returns {() => void}
 */
export function renderProductExtractorView(root) {
  /** @type {Array<object>} */
  let images = [];

  root.innerHTML = `
    <div class="tool-shell">
      <div class="tool-topbar">
        <button type="button" class="btn btn-outline-secondary btn-sm" id="backHomeBtn">← 홈</button>
        <div class="tool-topbar-brand">
          <h1 class="tool-page-title">제품 정보 추출기</h1>
          <p class="tool-page-sub">상품 URL → 대표·상세·필수정보·추가 이미지 자동 생성</p>
        </div>
        <button type="button" id="themeToggle" class="btn btn-theme" aria-label="다크모드 전환" title="다크모드">
          <span class="theme-icon" aria-hidden="true">◐</span>
        </button>
      </div>

      <section class="panel product-input-panel">
        <label class="form-label" for="productUrl">제품 URL</label>
        <div class="product-url-row">
          <input
            type="url"
            id="productUrl"
            class="form-control search-input"
            placeholder="https://m.monomart.com/goods/goods_view.php?goodsNo=..."
            autocomplete="off"
          />
          <button type="button" id="captureBtn" class="btn btn-primary">이미지 생성</button>
        </div>
        <p class="drop-formats mt-2 mb-0">현재 지원: 모노마트 (Monomart)</p>
      </section>

      <div id="productAlert" class="alert-box d-none" role="alert"></div>

      <section class="panel product-result-panel d-none" id="productResult">
        <div class="result-header">
          <h2 class="result-title" id="productNameTitle">생성된 이미지</h2>
          <button type="button" id="downloadSelectedBtn" class="btn btn-outline-primary btn-sm">선택 다운로드</button>
        </div>
        <div id="imagePreviewRoot"></div>
      </section>
    </div>
  `;

  const themeKey = "oce-theme";
  const themeToggle = root.querySelector("#themeToggle");
  themeToggle?.addEventListener("click", () => {
    const current =
      document.documentElement.getAttribute("data-theme") || "light";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(themeKey, next);
    } catch (_) {
      /* ignore */
    }
  });

  root.querySelector("#backHomeBtn")?.addEventListener("click", () => go("/"));

  const alertBox = /** @type {HTMLElement} */ (root.querySelector("#productAlert"));
  const captureBtn = /** @type {HTMLButtonElement} */ (
    root.querySelector("#captureBtn")
  );
  const urlInput = /** @type {HTMLInputElement} */ (
    root.querySelector("#productUrl")
  );
  const resultPanel = /** @type {HTMLElement} */ (
    root.querySelector("#productResult")
  );
  const previewRoot = /** @type {HTMLElement} */ (
    root.querySelector("#imagePreviewRoot")
  );
  const nameTitle = /** @type {HTMLElement} */ (
    root.querySelector("#productNameTitle")
  );
  const downloadBtn = /** @type {HTMLButtonElement} */ (
    root.querySelector("#downloadSelectedBtn")
  );

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

  async function onCapture() {
    hideAlert();
    const url = urlInput.value.trim();
    if (!url) {
      showAlert("제품 URL을 입력해주세요.", "error");
      return;
    }

    try {
      // eslint-disable-next-line no-new
      new URL(url);
    } catch {
      showAlert("올바른 URL 형식이 아닙니다.", "error");
      return;
    }

    try {
      ProductParserFactory.detect(url);
    } catch (err) {
      showAlert(err.message || "지원하지 않는 쇼핑몰입니다.", "error");
      return;
    }

    captureBtn.disabled = true;
    showAlert("이미지를 생성하는 중… (최대 약 수 초 소요)", "info");
    resultPanel.classList.add("d-none");
    images = [];

    try {
      const result = await captureProduct(url);
      images = (result.images || []).filter(Boolean);
      if (!images.length) {
        throw new Error("상품 정보를 찾을 수 없습니다.");
      }
      nameTitle.textContent = result.productName
        ? `${result.productName} — 생성된 이미지`
        : "생성된 이미지";
      renderImagePreview(previewRoot, images, { defaultChecked: true });
      resultPanel.classList.remove("d-none");

      const ok = images.filter((i) => i.status !== "error" && i.dataBase64).length;
      const fail = images.length - ok;
      if (fail > 0) {
        showAlert(
          `이미지 ${ok}/4개 생성 완료. ${fail}개는 실패 사유를 확인하세요.`,
          ok > 0 ? "info" : "error"
        );
      } else {
        showAlert("이미지 4개가 모두 생성되었습니다.", "success");
      }
    } catch (err) {
      console.error("[ProductExtractorView] capture:", err);
      showAlert(err.message || "이미지 생성에 실패했습니다.", "error");
    } finally {
      captureBtn.disabled = false;
    }
  }

  function onDownload() {
    hideAlert();
    const ids = new Set(getSelectedImageIds(previewRoot));
    const selected = images.filter(
      (img) => ids.has(img.id) && img.status !== "error" && img.dataBase64
    );

    if (!selected.length) {
      showAlert("다운로드할 이미지를 선택해주세요.", "error");
      return;
    }

    downloadBtn.disabled = true;
    showAlert(
      selected.length > 1
        ? `${selected.length}개 파일을 순서대로 저장하는 중…`
        : "파일을 다운로드하는 중…",
      "info"
    );

    const run =
      selected.length === 1
        ? downloadPng(selected[0])
        : downloadPngsDirect(selected);

    run
      .then(() => {
        showAlert(
          selected.length === 1
            ? "파일을 다운로드했습니다."
            : downloadSuccessMessage("direct", selected.length),
          "success"
        );
      })
      .catch((err) => {
        console.error("[ProductExtractorView] download:", err);
        showAlert(err.message || "다운로드에 실패했습니다.", "error");
      })
      .finally(() => {
        downloadBtn.disabled = false;
      });
  }

  captureBtn.addEventListener("click", onCapture);
  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") onCapture();
  });
  downloadBtn.addEventListener("click", onDownload);

  return () => {
    images = [];
  };
}
