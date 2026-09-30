import { resolveOrderProducts } from "./productMappingService.js";
import { getAllProductMappings } from "./productMappingStore.js";

const PLATFORM_ORDER = { naver: 0, coupang: 1 };

/** @param {object[]} mappings @param {string} targetProductId */
export function getSalesPlatformsForProduct(mappings, targetProductId) {
  return Array.from(new Set(
    (Array.isArray(mappings) ? mappings : [])
      .filter((mapping) => mapping.wholesaleProductId === targetProductId)
      .map((mapping) => String(mapping.platform || "").trim())
      .filter(Boolean)
  )).sort((a, b) => (PLATFORM_ORDER[a] ?? 99) - (PLATFORM_ORDER[b] ?? 99) || a.localeCompare(b));
}

/** @param {object} mapping */
function mappingOrderProduct(mapping) {
  return {
    platform: mapping.platform,
    displayProductName: mapping.rawProductName,
    rawProductName: mapping.rawProductName,
    rawOptionName: mapping.rawOptionName,
    platformProductId: mapping.platformProductId,
    platformOptionId: mapping.platformOptionId,
    quantity: 0,
  };
}

/**
 * matched 항목만 target product id로 통합한다. unmatched/stale은 key별로 유지한다.
 * @param {object[]} resolvedItems
 * @param {object[]} allMappings
 */
export function buildOrderPricingRows(resolvedItems, allMappings) {
  const rows = [];
  const matchedRows = new Map();
  const currentByKey = new Map((resolvedItems || []).map((item) => [item.platformProductKey, item.orderProduct]));

  for (const item of Array.isArray(resolvedItems) ? resolvedItems : []) {
    if (item.status !== "matched") {
      rows.push({
        ...item,
        targetProductId: item.mapping?.wholesaleProductId || null,
        sourceOrderProducts: [item.orderProduct],
        platformProductKeys: [item.platformProductKey],
        mappingEntries: item.mapping ? [{ mapping: item.mapping, orderProduct: item.orderProduct }] : [],
        quantity: item.orderProduct.quantity,
        salesPlatforms: [item.mapping?.platform || item.orderProduct.platform].filter(Boolean),
      });
      continue;
    }

    const targetProductId = item.mapping.wholesaleProductId;
    let row = matchedRows.get(targetProductId);
    if (!row) {
      const targetMappings = (allMappings || []).filter((mapping) => mapping.wholesaleProductId === targetProductId);
      row = {
        ...item,
        platformProductKey: `target::${targetProductId}`,
        targetProductId,
        sourceOrderProducts: [],
        platformProductKeys: [],
        mappingEntries: targetMappings.map((mapping) => ({
          mapping,
          orderProduct: currentByKey.get(mapping.platformProductKey) || mappingOrderProduct(mapping),
        })),
        quantity: 0,
        salesPlatforms: getSalesPlatformsForProduct(allMappings, targetProductId),
      };
      matchedRows.set(targetProductId, row);
      rows.push(row);
    }
    row.sourceOrderProducts.push(item.orderProduct);
    row.platformProductKeys.push(item.platformProductKey);
    row.quantity += Number(item.orderProduct.quantity) || 0;
  }

  return {
    items: rows,
    matchedCount: rows.filter((item) => item.status === "matched").length,
    unmatchedCount: rows.filter((item) => item.status === "unmatched").length,
    staleCount: rows.filter((item) => item.status === "stale").length,
  };
}

/** @param {object[]} orderProducts */
export async function resolveOrderProductPricingRows(orderProducts) {
  const [resolved, mappings] = await Promise.all([
    resolveOrderProducts(orderProducts),
    getAllProductMappings(),
  ]);
  return buildOrderPricingRows(resolved.items, mappings);
}
