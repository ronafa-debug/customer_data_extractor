/**
 * 제품가격관리표 브라우저 저장 (IndexedDB)
 */

const DB_NAME = "dauto-price";
const DB_VERSION = 1;
const STORE = "workbook";
const RECORD_KEY = "current";

/**
 * @returns {Promise<IDBDatabase>}
 */
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB를 열 수 없습니다."));
  });
}

/**
 * @param {"readonly"|"readwrite"} mode
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
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/**
 * @returns {Promise<{
 *   rows: object[],
 *   uploadedRows?: object[],
 *   checkedSeqs: number[],
 *   uploadedCheckedSeqs?: number[],
 *   fileName: string,
 *   savedAt: number
 * } | null>}
 */
export async function loadPriceTable() {
  try {
    const record = await withStore("readonly", (store) => store.get(RECORD_KEY));
    if (!record) return null;
    const catalog = Array.isArray(record.rows) ? record.rows : [];
    const uploaded = Array.isArray(record.uploadedRows) ? record.uploadedRows : [];
    if (!catalog.length && !uploaded.length) {
      return null;
    }
    return record;
  } catch (err) {
    console.error("[priceStore] load:", err);
    return null;
  }
}

/**
 * @param {{
 *   rows: object[],
 *   uploadedRows?: object[],
 *   checkedSeqs: number[],
 *   uploadedCheckedSeqs?: number[],
 *   fileName: string,
 *   savedAt: number
 * }} record
 */
export async function savePriceTable(record) {
  await withStore("readwrite", (store) => store.put(record, RECORD_KEY));
}

export async function clearPriceTable() {
  await withStore("readwrite", (store) => store.delete(RECORD_KEY));
}
