/**
 * DownloadService — 선택 PNG 다운로드 (ZIP 없음)
 *
 * 여러 장은 한 장씩 순차 다운로드한다.
 * (동시에 여러 blob 다운로드를 띄우면 Windows/Chrome이 .tmp를 남기는 경우가 있음)
 */
import { sanitizeFilename } from "./ImageService.js";

/** 다음 파일 시작 전 대기 (브라우저가 이전 파일을 확정할 시간) */
const BETWEEN_DOWNLOAD_MS = 700;
/** object URL 해제 전 대기 */
const REVOKE_AFTER_MS = 2000;

/**
 * @param {{ filename: string, mimeType?: string, dataBase64: string }} image
 * @returns {Blob}
 */
function toBlob(image) {
  const mime = image.mimeType || "image/png";
  const bin = atob(image.dataBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * @param {string} name
 * @param {Set<string>} used
 * @returns {string}
 */
function uniqueFilename(name, used) {
  let base = sanitizeFilename(name || "image.png");
  if (!/\.png$/i.test(base)) base += ".png";
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  const stem = base.replace(/\.png$/i, "");
  let i = 2;
  while (used.has(`${stem} (${i}).png`)) i += 1;
  const next = `${stem} (${i}).png`;
  used.add(next);
  return next;
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * blob URL + <a download> 한 장 저장 (FileSaver 미사용 — .tmp 잔여 방지)
 * @param {Blob} blob
 * @param {string} filename
 * @returns {Promise<void>}
 */
function saveBlobAsPng(blob, filename) {
  return new Promise((resolve, reject) => {
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.rel = "noopener";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => {
        URL.revokeObjectURL(url);
        resolve();
      }, REVOKE_AFTER_MS);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * @param {{ filename: string, mimeType?: string, dataBase64: string }} image
 * @returns {Promise<void>}
 */
export function downloadPng(image) {
  const name = sanitizeFilename(image.filename || "image.png");
  const safe = /\.png$/i.test(name) ? name : `${name}.png`;
  return saveBlobAsPng(toBlob(image), safe);
}

/**
 * 여러 PNG를 한 장씩 순차 다운로드한다 (.tmp 잔여 완화).
 * @param {Array<{ filename: string, mimeType?: string, dataBase64: string }>} images
 * @returns {Promise<void>}
 */
export async function downloadPngsDirect(images) {
  const used = new Set();
  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const name = uniqueFilename(image.filename || "image.png", used);
    await saveBlobAsPng(toBlob(image), name);
    if (i < images.length - 1) {
      await sleep(BETWEEN_DOWNLOAD_MS);
    }
  }
}

/**
 * @param {'folder' | 'direct'} method
 * @param {number} count
 * @returns {string}
 */
export function downloadSuccessMessage(method, count) {
  if (method === "folder") {
    return `${count}개 PNG를 선택한 폴더에 저장했습니다.`;
  }
  return `${count}개 PNG를 다운로드했습니다.`;
}

/**
 * @param {Array<{ filename: string, mimeType?: string, dataBase64: string }>} images
 * @returns {Promise<void>}
 */
export async function downloadSelected(images) {
  if (!images?.length) {
    throw new Error("다운로드할 이미지를 선택해주세요.");
  }
  if (images.length === 1) {
    await downloadPng(images[0]);
    return;
  }
  await downloadPngsDirect(images);
}

export const DownloadService = {
  downloadPng,
  downloadPngsDirect,
  downloadSelected,
  downloadSuccessMessage,
};
