/**
 * 상품명 추출 — 용량(단위)까지만 남긴다.
 * 정규식은 이 파일에서만 관리한다.
 */

/** @type {RegExp} */
const PRODUCT_UNIT_REGEX = /^.*?(?:\d+(?:\.\d+)?\s?(kg|g|ml|mL|L|l))/i;

/**
 * 원본 상품명에서 단위까지 잘라낸다.
 * @param {string} rawName
 * @returns {string}
 */
export function extractProductName(rawName) {
  if (rawName == null) return "";
  const text = String(rawName).replace(/\s+/g, " ").trim();
  if (!text) return "";

  const match = text.match(PRODUCT_UNIT_REGEX);
  if (match && match[0]) {
    return match[0].trim();
  }
  return text;
}

/**
 * "상품명 N개" 형식 한 줄
 * @param {string} name
 * @param {number} quantity
 * @returns {string}
 */
export function formatProductLine(name, quantity) {
  const safeName = extractProductName(name);
  const qty = Number(quantity);
  const safeQty = Number.isFinite(qty) && qty > 0 ? qty : 1;
  return `${safeName} ${safeQty}개`;
}

export { PRODUCT_UNIT_REGEX };
