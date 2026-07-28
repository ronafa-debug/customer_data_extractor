/**
 * ImagePreview — 생성 이미지 미리보기 + 체크박스
 * status:"error" 슬롯은 사유를 표시하고 다운로드 대상에서 제외한다.
 */
import { toDataUrl } from "../services/ImageService.js";

/**
 * @param {HTMLElement} container
 * @param {Array<{
 *   id: string,
 *   label: string,
 *   filename: string,
 *   status?: 'success' | 'error',
 *   error?: string,
 *   mimeType?: string,
 *   dataBase64?: string,
 *   width?: number,
 *   height?: number
 * }>} images
 * @param {{ defaultChecked?: boolean }} [options]
 */
export function renderImagePreview(container, images, options = {}) {
  const defaultChecked = options.defaultChecked !== false;

  container.innerHTML = `
    <ul class="image-preview-list">
      ${images
        .map((img, index) => {
          const isError = img.status === "error" || !img.dataBase64;
          const id = `img-check-${img.id || index}`;
          if (isError) {
            return `
              <li class="image-preview-item is-error">
                <div class="image-preview-check">
                  <span>${img.label}</span>
                  <span class="image-status-badge">생성 실패</span>
                </div>
                <div class="image-preview-frame image-preview-frame-error">
                  <p class="image-error-reason">${escapeHtml(
                    img.error || "이미지를 생성하지 못했습니다."
                  )}</p>
                </div>
                <p class="image-preview-meta">${img.filename || ""}</p>
              </li>
            `;
          }

          const src = toDataUrl(img);
          return `
            <li class="image-preview-item">
              <label class="image-preview-check">
                <input type="checkbox" data-image-id="${img.id}" id="${id}" ${
                  defaultChecked ? "checked" : ""
                } />
                <span>${img.label}</span>
              </label>
              <div class="image-preview-frame">
                <img src="${src}" alt="${img.label}" loading="lazy" />
              </div>
              <p class="image-preview-meta">${img.width || "?"}×${img.height || "?"} · ${img.filename}</p>
            </li>
          `;
        })
        .join("")}
    </ul>
  `;
}

/**
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 체크된 성공 이미지 id 목록
 * @param {HTMLElement} container
 * @returns {string[]}
 */
export function getSelectedImageIds(container) {
  return Array.from(
    container.querySelectorAll('input[type="checkbox"][data-image-id]:checked')
  ).map((el) => /** @type {HTMLInputElement} */ (el).dataset.imageId || "");
}
