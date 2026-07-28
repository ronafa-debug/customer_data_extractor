/**
 * ImageService — 미리보기용 data URL 등 클라이언트 이미지 유틸
 */

/**
 * @param {{ mimeType?: string, dataBase64: string }} image
 * @returns {string}
 */
export function toDataUrl(image) {
  const mime = image.mimeType || "image/png";
  return `data:${mime};base64,${image.dataBase64}`;
}

/**
 * 파일명에 사용할 수 없는 문자 제거
 * @param {string} name
 * @returns {string}
 */
export function sanitizeFilename(name) {
  return String(name || "product")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export const ImageService = { toDataUrl, sanitizeFilename };
