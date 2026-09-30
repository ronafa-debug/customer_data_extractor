import { extractProductName } from "../utils/ProductExtractor.js";

/** @param {unknown} value */
export function orderCellText(value) {
  return String(value ?? "").trim();
}

/** @param {unknown} value */
function normalizeKeyText(value) {
  return orderCellText(value).replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
}

/**
 * @param {object} value
 * @returns {{platform:string,displayProductName:string,rawProductName:string,rawOptionName:string,platformProductId:string,platformOptionId:string,quantity:number,customerName:string,phone:string,address:string,zipcode:string,deliveryMessage:string}}
 */
export function createStandardOrderRow(value = {}) {
  const rawProductName = orderCellText(value.rawProductName);
  const displaySource = orderCellText(value.displayProductName || rawProductName);
  const quantityValue = Number(value.quantity);
  return {
    platform: orderCellText(value.platform).toLocaleLowerCase("en-US"),
    displayProductName: extractProductName(displaySource),
    rawProductName,
    rawOptionName: orderCellText(value.rawOptionName),
    platformProductId: orderCellText(value.platformProductId),
    platformOptionId: orderCellText(value.platformOptionId),
    quantity: Number.isFinite(quantityValue) && quantityValue > 0 ? quantityValue : 1,
    customerName: orderCellText(value.customerName),
    phone: orderCellText(value.phone),
    address: orderCellText(value.address),
    zipcode: orderCellText(value.zipcode),
    deliveryMessage: orderCellText(value.deliveryMessage),
  };
}

/** @param {ReturnType<typeof createStandardOrderRow>} row */
export function toCustomerGroupingRow(row) {
  return {
    name: row.customerName,
    phone: row.phone,
    address: row.address,
    zipcode: row.zipcode,
    deliveryMessage: row.deliveryMessage,
    productName: row.displayProductName,
    quantity: row.quantity,
  };
}

/** @param {{platform?:unknown,platformProductId?:unknown,platformOptionId?:unknown,rawProductName?:unknown,rawOptionName?:unknown}} product */
export function makePlatformProductKey(product) {
  const platform = normalizeKeyText(product?.platform);
  const productId = orderCellText(product?.platformProductId);
  const optionId = orderCellText(product?.platformOptionId);
  if (productId) return [platform, productId, optionId].filter(Boolean).join("::");
  return `${platform}::name::${normalizeKeyText(product?.rawProductName)}::${normalizeKeyText(product?.rawOptionName)}`;
}

/** 개인정보를 제외한 저장용 상품 스냅샷이다. @param {object} value */
export function snapshotOrderProduct(value) {
  const row = createStandardOrderRow(value);
  return {
    platform: row.platform,
    displayProductName: row.displayProductName,
    rawProductName: row.rawProductName,
    rawOptionName: row.rawOptionName,
    platformProductId: row.platformProductId,
    platformOptionId: row.platformOptionId,
    quantity: row.quantity,
  };
}

/** @param {object[]} values */
export function mergeOrderProducts(values) {
  const merged = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const product = snapshotOrderProduct(value);
    if (!product.platform || (!product.rawProductName && !product.displayProductName)) continue;
    const key = makePlatformProductKey(product);
    const current = merged.get(key);
    if (current) current.quantity += product.quantity;
    else merged.set(key, product);
  }
  return Array.from(merged.values());
}
