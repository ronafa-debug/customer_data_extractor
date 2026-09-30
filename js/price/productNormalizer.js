/** @param {unknown} value */
export function normalizeProductText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/** @param {unknown} value */
export function normalizeProductKeyText(value) {
  return normalizeProductText(value).toLocaleLowerCase("en-US");
}

/** @param {unknown} productName @param {unknown} specification */
export function makeWholesaleProductKey(productName, specification) {
  return `${normalizeProductKeyText(productName)}::${normalizeProductKeyText(specification)}`;
}

/** @param {unknown} productName @param {unknown} specification */
export function makeWholesaleProductId(productName, specification) {
  return `wholesale:${encodeURIComponent(makeWholesaleProductKey(productName, specification))}`;
}

/** @param {Array<{productName?: string, specification?: string}>} products @param {unknown} query */
export function searchWholesaleProducts(products, query) {
  const needle = normalizeProductKeyText(query);
  if (!needle) return [...products];
  return (products || []).filter((product) =>
    `${normalizeProductKeyText(product.productName)} ${normalizeProductKeyText(product.specification)}`.includes(needle)
  );
}
