import { applyBackupTransaction } from './priceBackupTransaction.js'
export const PRODUCT_MAPPING_DB_NAME = "dauto-product-mapping";
export const PRODUCT_MAPPING_STORE_NAME = "mappings";
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PRODUCT_MAPPING_DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PRODUCT_MAPPING_STORE_NAME)) {
        db.createObjectStore(PRODUCT_MAPPING_STORE_NAME, { keyPath: "platformProductKey" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("상품 매핑 DB를 열 수 없습니다."));
  });
}

/** @param {string} platformProductKey */
export async function getProductMapping(platformProductKey) {
  const key = String(platformProductKey ?? "").trim();
  if (!key) return null;
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(PRODUCT_MAPPING_STORE_NAME, "readonly");
      const request = transaction.objectStore(PRODUCT_MAPPING_STORE_NAME).get(key);
      transaction.oncomplete = () => resolve(request.result || null);
      transaction.onerror = () => reject(transaction.error || request.error);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function getAllProductMappings() {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(PRODUCT_MAPPING_STORE_NAME, "readonly");
      const request = transaction.objectStore(PRODUCT_MAPPING_STORE_NAME).getAll();
      transaction.oncomplete = () => resolve(request.result || []);
      transaction.onerror = () => reject(transaction.error || request.error);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

/**
 * 개인정보를 제외한 상품 식별정보만 upsert한다.
 * @param {{platformProductKey:unknown,platform:unknown,platformProductId?:unknown,platformOptionId?:unknown,rawProductName?:unknown,rawOptionName?:unknown,wholesaleProductId:unknown}} mapping
 */
export async function saveProductMapping(mapping) {
  const platformProductKey = String(mapping?.platformProductKey ?? "").trim();
  const platform = String(mapping?.platform ?? "").trim().toLocaleLowerCase("en-US");
  const wholesaleProductId = String(mapping?.wholesaleProductId ?? "").trim();
  if (!platformProductKey) throw new Error("플랫폼 상품 key가 필요합니다.");
  if (!platform) throw new Error("플랫폼 정보가 필요합니다.");
  if (!wholesaleProductId) throw new Error("연결할 회원2가 제품 ID가 필요합니다.");

  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(PRODUCT_MAPPING_STORE_NAME, "readwrite");
      const store = transaction.objectStore(PRODUCT_MAPPING_STORE_NAME);
      const getRequest = store.get(platformProductKey);
      let saved = null;
      getRequest.onsuccess = () => {
        const existing = getRequest.result;
        const now = Date.now();
        saved = {
          platformProductKey,
          platform,
          platformProductId: String(mapping.platformProductId ?? "").trim(),
          platformOptionId: String(mapping.platformOptionId ?? "").trim(),
          rawProductName: String(mapping.rawProductName ?? "").trim(),
          rawOptionName: String(mapping.rawOptionName ?? "").trim(),
          wholesaleProductId,
          createdAt: existing?.createdAt || now,
          updatedAt: now,
        };
        store.put(saved);
      };
      getRequest.onerror = () => reject(getRequest.error);
      transaction.oncomplete = () => resolve(saved);
      transaction.onerror = () => reject(transaction.error || new Error("상품 매핑을 저장하지 못했습니다."));
      transaction.onabort = () => reject(transaction.error || new Error("상품 매핑 저장이 취소되었습니다."));
    });
  } finally { db.close(); }
}

/** @param {string} platformProductKey */
export async function deleteProductMapping(platformProductKey) {
  const key = String(platformProductKey ?? "").trim();
  if (!key) return;
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(PRODUCT_MAPPING_STORE_NAME, "readwrite");
      transaction.objectStore(PRODUCT_MAPPING_STORE_NAME).delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("상품 매핑을 삭제하지 못했습니다."));
      transaction.onabort = () => reject(transaction.error || new Error("상품 매핑 삭제가 취소되었습니다."));
    });
  } finally { db.close(); }
}

export async function applyMappingSnapshot(expected, next) {
  return applyBackupTransaction(openDb, [{ store: PRODUCT_MAPPING_STORE_NAME, key: 'platformProductKey', expected, next }])
}
