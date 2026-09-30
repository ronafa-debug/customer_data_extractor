const NAVER_RATE = 1.15;
const COUPANG_RATE = 1.25;

/** @param {number} value */
export function ceilToTen(value) {
  return Math.ceil(Number(value) / 10) * 10;
}

/** @param {number|string} purchasePrice */
export function calculateSalePrices(purchasePrice) {
  const purchase = Number(String(purchasePrice).replaceAll(",", ""));
  if (!Number.isFinite(purchase) || purchase <= 0) {
    return { naverPrice: 0, coupangPrice: 0 };
  }
  return {
    naverPrice: ceilToTen(purchase * NAVER_RATE),
    coupangPrice: ceilToTen(purchase * COUPANG_RATE),
  };
}

/**
 * OCR 제품명 끝의 수량 표기만 제거한다. 의미가 있는 괄호 표기는 보존한다.
 * @param {unknown} value
 */
export function normalizeNewProductName(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s*\(\s*\d+\s*\)\s*$/, "")
    .trim();
}

/** @param {unknown} value */
export function parsePurchasePrice(value) {
  const text = String(value ?? "").replaceAll(",", "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) return 0;
  const amount = Number(text);
  return Number.isFinite(amount) ? amount : 0;
}

/** @param {{productName?: unknown, purchasePrice?: unknown}} draft */
export function validateNewProduct(draft) {
  const productName = normalizeNewProductName(draft.productName);
  const purchasePrice = parsePurchasePrice(draft.purchasePrice);
  const errors = {};
  if (!productName) errors.productName = "제품명을 입력해주세요.";
  if (purchasePrice <= 0) errors.purchasePrice = "0보다 큰 매입가를 입력해주세요.";
  return {
    valid: Object.keys(errors).length === 0,
    errors,
    value: {
      productName,
      purchasePrice,
      ...calculateSalePrices(purchasePrice),
    },
  };
}

/** @param {unknown} value */
export function productNameKey(value) {
  return normalizeNewProductName(value).replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
}

/** @param {Array<{productName?: string}>} products @param {string} query */
export function searchNewProducts(products, query) {
  const needle = String(query ?? "").trim().toLocaleLowerCase("ko-KR");
  if (!needle) return [...products];
  return products.filter((product) =>
    String(product.productName ?? "").toLocaleLowerCase("ko-KR").includes(needle)
  );
}

/** @param {Array<{productName?: string}>} products @param {string} productName */
export function findDuplicateProduct(products, productName) {
  const key = productNameKey(productName);
  return key ? products.find((product) => productNameKey(product.productName) === key) || null : null;
}
