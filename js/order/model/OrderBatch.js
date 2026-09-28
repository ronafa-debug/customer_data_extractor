/**
 * 날짜별 주문 저장 batch 모델과 집계 유틸
 */
import { Customer } from "./Customer.js";
import { Product } from "./Product.js";

/**
 * 브라우저 사용자의 로컬 날짜를 YYYY-MM-DD로 만든다.
 * @param {Date} [date]
 * @returns {string}
 */
export function toLocalDateKey(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * @param {string} dateKey
 * @returns {string}
 */
export function formatOrderDate(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ""));
  return match ? `${match[1]}.${match[2]}.${match[3]}` : String(dateKey || "");
}

/**
 * @param {unknown} value
 * @returns {object}
 */
function snapshotProduct(value) {
  const product = /** @type {any} */ (value || {});
  const quantity = Number(product.quantity);
  return {
    name: String(product.name || "").trim(),
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
  };
}

/**
 * @param {unknown} value
 * @returns {object}
 */
export function snapshotCustomer(value) {
  const customer = /** @type {any} */ (value || {});
  return {
    name: String(customer.name || "").trim(),
    phone: String(customer.phone || "").trim(),
    address: String(customer.address || "").trim(),
    zipcode: String(customer.zipcode || "").trim(),
    deliveryMessage: String(customer.deliveryMessage || "").trim(),
    products: Array.isArray(customer.products)
      ? customer.products.map(snapshotProduct).filter((item) => item.name)
      : [],
  };
}

/**
 * @param {unknown} value
 * @returns {Customer}
 */
export function restoreCustomer(value) {
  const data = snapshotCustomer(value);
  return new Customer({
    ...data,
    products: data.products.map(
      (product) => new Product(product.name, product.quantity)
    ),
  });
}

/**
 * @param {import('./Customer.js').Customer[]} customers
 * @param {Date} [now]
 * @param {() => string} [idFactory]
 */
export function createOrderBatch(
  customers,
  now = new Date(),
  idFactory = () =>
    globalThis.crypto?.randomUUID?.() ||
    `batch-${Date.now()}-${Math.random().toString(36).slice(2)}`
) {
  const list = Array.isArray(customers) ? customers : [];
  if (!list.length) {
    throw new Error("저장할 고객정보가 없습니다.");
  }
  const snapshots = list.map(snapshotCustomer);
  return {
    id: idFactory(),
    dateKey: toLocalDateKey(now),
    createdAt: now.toISOString(),
    customers: snapshots,
    customerCount: snapshots.length,
  };
}

/**
 * 손상된 저장 레코드는 가능한 범위만 안전하게 복구한다.
 * @param {unknown} value
 * @returns {object | null}
 */
export function normalizeOrderBatch(value) {
  const batch = /** @type {any} */ (value || {});
  const id = String(batch.id || "").trim();
  const dateKey = String(batch.dateKey || "").trim();
  const createdAt = String(batch.createdAt || "").trim();
  if (
    !id ||
    !/^\d{4}-\d{2}-\d{2}$/.test(dateKey) ||
    !createdAt ||
    !Number.isFinite(Date.parse(createdAt))
  ) return null;
  const customers = Array.isArray(batch.customers)
    ? batch.customers.map(snapshotCustomer)
    : [];
  return { id, dateKey, createdAt, customers, customerCount: customers.length };
}

/**
 * @param {unknown[]} batches
 * @returns {object[]}
 */
export function normalizeOrderBatches(batches) {
  return (Array.isArray(batches) ? batches : [])
    .map(normalizeOrderBatch)
    .filter(Boolean);
}

/**
 * 최신 날짜가 먼저 오도록 날짜별 합계를 만든다.
 * @param {unknown[]} batches
 */
export function summarizeOrderBatches(batches) {
  const map = new Map();
  for (const batch of normalizeOrderBatches(batches)) {
    const current = map.get(batch.dateKey) || {
      dateKey: batch.dateKey,
      customerCount: 0,
      batchCount: 0,
    };
    current.customerCount += batch.customerCount;
    current.batchCount += 1;
    map.set(batch.dateKey, current);
  }
  return Array.from(map.values()).sort((a, b) =>
    b.dateKey.localeCompare(a.dateKey)
  );
}

/**
 * @param {unknown[]} batches
 * @param {string} dateKey
 * @returns {object[]}
 */
export function getBatchesForDate(batches, dateKey) {
  return normalizeOrderBatches(batches)
    .filter((batch) => batch.dateKey === dateKey)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * 기존 출력 로직에서 사용할 Customer[]를 새 인스턴스로 반환한다.
 * @param {unknown[]} batches
 * @param {string} dateKey
 * @returns {Customer[]}
 */
export function getCustomersForDate(batches, dateKey) {
  return getBatchesForDate(batches, dateKey).flatMap((batch) =>
    batch.customers.map(restoreCustomer)
  );
}

/**
 * 저장된 고객과 원본 batch 내 위치를 함께 반환한다.
 * @param {unknown[]} batches
 * @param {string} dateKey
 */
export function getCustomerEntriesForDate(batches, dateKey) {
  return getBatchesForDate(batches, dateKey).flatMap((batch) =>
    batch.customers.map((customer, customerIndex) => ({
      customer: restoreCustomer(customer),
      batchId: batch.id,
      customerIndex,
    }))
  );
}

/** @param {unknown[]} batches @param {string} id */
export function withoutOrderBatch(batches, id) {
  return normalizeOrderBatches(batches).filter((batch) => batch.id !== id);
}

/**
 * 특정 저장 기록 안의 고객 한 명을 제외한다.
 * 마지막 고객이면 빈 batch도 함께 제외한다.
 * @param {unknown[]} batches
 * @param {string} batchId
 * @param {number} customerIndex
 */
export function withoutOrderCustomer(batches, batchId, customerIndex) {
  const index = Number(customerIndex);
  return normalizeOrderBatches(batches).flatMap((batch) => {
    if (batch.id !== batchId || !Number.isInteger(index) || index < 0 || index >= batch.customers.length) {
      return [batch];
    }
    const customers = batch.customers.filter((_, i) => i !== index);
    return customers.length
      ? [{ ...batch, customers, customerCount: customers.length }]
      : [];
  });
}

/** @param {unknown[]} batches @param {string} dateKey */
export function withoutOrderDate(batches, dateKey) {
  return normalizeOrderBatches(batches).filter(
    (batch) => batch.dateKey !== dateKey
  );
}
