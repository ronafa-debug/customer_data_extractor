import { validateNewProduct } from "./NewPriceModel.js";

export const NEW_PRICE_DB_NAME = "dauto-new-price";
export const NEW_PRICE_STORE_NAME = "products";
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NEW_PRICE_DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(NEW_PRICE_STORE_NAME)) {
        const store = db.createObjectStore(NEW_PRICE_STORE_NAME, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("새 제품가격 DB를 열 수 없습니다."));
  });
}

/** @param {"readonly"|"readwrite"} mode @param {(store: IDBObjectStore) => IDBRequest} run */
async function withStore(mode, run) {
  const db = /** @type {IDBDatabase} */ (await openDb());
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(NEW_PRICE_STORE_NAME, mode);
      const request = run(transaction.objectStore(NEW_PRICE_STORE_NAME));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error || request.error);
      transaction.onabort = () => reject(transaction.error || new Error("가격 정보를 저장하지 못했습니다."));
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function listNewProducts() {
  const products = /** @type {object[]} */ (await withStore("readonly", (store) => store.getAll()));
  return products.sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt));
}

/** @param {{productName: unknown, purchasePrice: unknown, source?: "receipt"|"manual"}} draft */
export async function addNewProduct(draft) {
  const checked = validateNewProduct(draft);
  if (!checked.valid) throw new Error("제품명과 매입가를 확인해주세요.");
  const now = Date.now();
  const record = {
    id: globalThis.crypto?.randomUUID?.() || `new-price-${now}-${Math.random().toString(16).slice(2)}`,
    ...checked.value,
    source: draft.source === "receipt" ? "receipt" : "manual",
    createdAt: now,
    updatedAt: now,
  };
  await withStore("readwrite", (store) => store.add(record));
  return record;
}

/** @param {string} id @param {{productName: unknown, purchasePrice: unknown, source?: "receipt"|"manual", createdAt?: number}} draft */
export async function updateNewProduct(id, draft) {
  const existing = await withStore("readonly", (store) => store.get(id));
  if (!existing) throw new Error("수정할 제품을 찾지 못했습니다.");
  const checked = validateNewProduct(draft);
  if (!checked.valid) throw new Error("제품명과 매입가를 확인해주세요.");
  const record = {
    ...existing,
    ...checked.value,
    source: draft.source || existing.source || "manual",
    updatedAt: Date.now(),
  };
  await withStore("readwrite", (store) => store.put(record));
  return record;
}

/** @param {string} id */
export async function deleteNewProduct(id) {
  await withStore("readwrite", (store) => store.delete(id));
}
