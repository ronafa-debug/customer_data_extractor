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
 * 플랫폼 주문행의 안정적인 식별값을 만든다. 고객 개인정보는 사용하지 않는다.
 * 네이버는 상품주문번호, 쿠팡은 주문번호와 상품·옵션 식별자를 사용한다.
 * @param {{platform?:unknown,productOrderId?:unknown,orderId?:unknown,platformProductId?:unknown,platformOptionId?:unknown,rawProductName?:unknown,rawOptionName?:unknown}} value
 */
export function makeOrderIdentityKey(value) {
  const platform = orderCellText(value?.platform).toLocaleLowerCase("en-US");
  const productOrderId = orderCellText(value?.productOrderId);
  const orderId = orderCellText(value?.orderId);
  if (platform === "naver" && productOrderId) return `naver::${productOrderId}`;
  if (platform !== "coupang" || !orderId) return "";
  const productId = orderCellText(value?.platformProductId);
  const optionId = orderCellText(value?.platformOptionId);
  const rawProductName = normalizeKeyText(value?.rawProductName);
  const rawOptionName = normalizeKeyText(value?.rawOptionName);
  const itemIdentity = [productId, optionId].filter(Boolean).join("::") ||
    (rawProductName || rawOptionName ? `name::${rawProductName}::${rawOptionName}` : "");
  return itemIdentity ? `coupang::${orderId}::${itemIdentity}` : "";
}

/**
 * @param {object} value
 * @returns {{platform:string,displayProductName:string,rawProductName:string,rawOptionName:string,platformProductId:string,platformOptionId:string,quantity:number,customerName:string,phone:string,address:string,zipcode:string,deliveryMessage:string}}
 */
export function createStandardOrderRow(value = {}) {
  const rawProductName = orderCellText(value.rawProductName);
  const displaySource = orderCellText(value.displayProductName || rawProductName);
  const quantityValue = Number(value.quantity);
  const row = {
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
  return { ...row, orderIdentityKey: makeOrderIdentityKey({ ...value, ...row }) };
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
