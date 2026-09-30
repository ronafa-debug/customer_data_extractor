/**
 * 주문내역 날짜별 batch 저장소 — 현재 브라우저 IndexedDB 전용
 */
import {
  createOrderBatch,
  getOrderProductsForDate,
  normalizeOrderBatches,
  summarizeOrderProductDates,
} from "../model/OrderBatch.js";

const DB_NAME = "dauto-order-history";
const DB_VERSION = 1;
const STORE = "batches";
const DATE_INDEX = "dateKey";

/** @returns {Promise<IDBDatabase>} */
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex(DATE_INDEX, "dateKey", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error || new Error("저장된 주문내역을 열 수 없습니다."));
  });
}

/**
 * @param {'readonly'|'readwrite'} mode
 * @param {(store: IDBObjectStore) => IDBRequest} run
 */
async function withStore(mode, run) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error || req.error);
      tx.onabort = () => reject(tx.error || new Error("주문 저장 작업이 취소되었습니다."));
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** @returns {Promise<object[]>} */
export async function loadOrderBatches() {
  const records = await withStore("readonly", (store) => store.getAll());
  return normalizeOrderBatches(Array.isArray(records) ? records : []);
}

/** 주문상품이 있는 저장 날짜를 최신순으로 반환한다. */
export async function getOrderDatesWithProducts() {
  return summarizeOrderProductDates(await loadOrderBatches());
}

/** @param {string} dateKey */
export async function getOrderProductsByDate(dateKey) {
  return getOrderProductsForDate(await loadOrderBatches(), dateKey);
}

/**
 * @param {import('../model/Customer.js').Customer[]} customers
 * @param {Date} [now]
 * @param {object[]} [orderRows]
 */
export async function saveOrderBatch(customers, now = new Date(), orderRows = []) {
  const batch = createOrderBatch(customers, now, undefined, orderRows);
  await withStore("readwrite", (store) => store.add(batch));
  return batch;
}

/** @param {string} id */
export async function deleteOrderBatch(id) {
  await withStore("readwrite", (store) => store.delete(id));
}

/**
 * @param {string} batchId
 * @param {number} customerIndex
 */
export async function deleteOrderCustomer(batchId, customerIndex) {
  const index = Number(customerIndex);
  if (!Number.isInteger(index) || index < 0) return;

  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const req = store.get(batchId);
      req.onsuccess = () => {
        const batch = normalizeOrderBatches([req.result])[0];
        if (!batch || index >= batch.customers.length) return;
        const customers = batch.customers.filter((_, i) => i !== index);
        if (customers.length) {
          store.put({ ...batch, customers, customerCount: customers.length });
        } else {
          store.delete(batchId);
        }
      };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || req.error);
      tx.onabort = () => reject(tx.error || new Error("개별 주문 삭제가 취소되었습니다."));
    });
  } finally {
    db.close();
  }
}

/** @param {string} dateKey */
export async function deleteOrderDate(dateKey) {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const index = tx.objectStore(STORE).index(DATE_INDEX);
      const req = index.openKeyCursor(IDBKeyRange.only(dateKey));
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        tx.objectStore(STORE).delete(cursor.primaryKey);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || req.error);
      tx.onabort = () => reject(tx.error || new Error("날짜별 주문 삭제가 취소되었습니다."));
    });
  } finally {
    db.close();
  }
}
