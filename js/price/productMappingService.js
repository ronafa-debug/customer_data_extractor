import { makePlatformProductKey, snapshotOrderProduct } from "../order/model/StandardOrderRow.js";
import { calculateMarketplacePrices } from "./priceCalculator.js";
import { getAllProducts, getProductById } from "./productPriceStore.js";
import { searchWholesaleProducts } from "./productNormalizer.js";
import { getProductMapping, saveProductMapping } from "./productMappingStore.js";

/** @param {object} orderProduct @param {string} wholesaleProductId */
export async function connectProductMapping(orderProduct, wholesaleProductId) {
  const id = String(wholesaleProductId ?? "").trim();
  const targetProduct = await getProductById(id);
  if (!targetProduct) throw new Error("연결할 제품을 현재 제품DB에서 찾지 못했습니다.");
  const product = snapshotOrderProduct(orderProduct);
  const platformProductKey = makePlatformProductKey(product);
  return saveProductMapping({
    platformProductKey,
    platform: product.platform,
    platformProductId: product.platformProductId,
    platformOptionId: product.platformOptionId,
    rawProductName: product.rawProductName,
    rawOptionName: product.rawOptionName,
    wholesaleProductId: id,
  });
}

/** @param {object} orderProduct */
export async function resolveProductMapping(orderProduct) {
  const product = snapshotOrderProduct(orderProduct);
  const platformProductKey = makePlatformProductKey(product);
  const mapping = await getProductMapping(platformProductKey);
  if (!mapping) return { status: "unmatched", platformProductKey, orderProduct: product, mapping: null, wholesaleProduct: null, targetProduct: null };
  const targetProduct = await getProductById(mapping.wholesaleProductId);
  if (!targetProduct) return { status: "stale", platformProductKey, orderProduct: product, mapping, wholesaleProduct: null, targetProduct: null };
  return { status: "matched", platformProductKey, orderProduct: product, mapping, wholesaleProduct: targetProduct, targetProduct };
}

/** @param {object} orderProduct */
export async function resolveProductPricing(orderProduct) {
  const resolved = await resolveProductMapping(orderProduct);
  if (resolved.status !== "matched") return { ...resolved, prices: null };
  const purchasePrice = resolved.targetProduct.purchasePrice;
  return { ...resolved, prices: { purchasePrice, ...calculateMarketplacePrices(purchasePrice) } };
}

/** @param {object[]} orderProducts */
export async function resolveOrderProducts(orderProducts) {
  const items = await Promise.all((Array.isArray(orderProducts) ? orderProducts : []).map(resolveProductPricing));
  return {
    items,
    matchedCount: items.filter((item) => item.status === "matched").length,
    unmatchedCount: items.filter((item) => item.status === "unmatched").length,
    staleCount: items.filter((item) => item.status === "stale").length,
  };
}

/** 후보만 반환하며 mapping을 저장하지 않는다. @param {object} orderProduct @param {string} [query] */
export async function searchWholesaleCandidates(orderProduct, query = "") {
  const product = snapshotOrderProduct(orderProduct);
  const searchText = String(query || product.displayProductName || product.rawProductName).trim();
  return searchWholesaleProducts(await getAllProducts(), searchText);
}
