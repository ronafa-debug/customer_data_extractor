export const PRODUCT_PRICE_DB_NAME = "dauto-product-price";
export const PRODUCT_PRICE_PRODUCTS_STORE = "products";
export const PRODUCT_PRICE_METADATA_STORE = "metadata";
export const PRODUCT_PRICE_MANUAL_STORE = "manualProducts";
const DB_VERSION = 2;
const METADATA_KEY = "current";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PRODUCT_PRICE_DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PRODUCT_PRICE_PRODUCTS_STORE)) db.createObjectStore(PRODUCT_PRICE_PRODUCTS_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(PRODUCT_PRICE_METADATA_STORE)) db.createObjectStore(PRODUCT_PRICE_METADATA_STORE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(PRODUCT_PRICE_MANUAL_STORE)) db.createObjectStore(PRODUCT_PRICE_MANUAL_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("제품DB를 열 수 없습니다."));
  });
}

export async function loadProductPriceDatabase() {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction([PRODUCT_PRICE_PRODUCTS_STORE, PRODUCT_PRICE_METADATA_STORE, PRODUCT_PRICE_MANUAL_STORE], "readonly");
      const productsRequest = transaction.objectStore(PRODUCT_PRICE_PRODUCTS_STORE).getAll();
      const metadataRequest = transaction.objectStore(PRODUCT_PRICE_METADATA_STORE).get(METADATA_KEY);
      const manualRequest = transaction.objectStore(PRODUCT_PRICE_MANUAL_STORE).getAll();
      transaction.oncomplete = () => resolve({
        products: (productsRequest.result || []).map((item) => ({ ...item, source: "wholesale" })),
        manualProducts: manualRequest.result || [],
        metadata: metadataRequest.result || null,
      });
      transaction.onerror = () => reject(transaction.error || productsRequest.error || metadataRequest.error || manualRequest.error);
    });
  } finally { db.close(); }
}

/** @param {string} id */
export async function getWholesaleProductById(id) {
  const key = String(id ?? "").trim();
  if (!key) return null;
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(PRODUCT_PRICE_PRODUCTS_STORE, "readonly");
      const request = transaction.objectStore(PRODUCT_PRICE_PRODUCTS_STORE).get(key);
      transaction.oncomplete = () => resolve(request.result ? { ...request.result, source: "wholesale" } : null);
      transaction.onerror = () => reject(transaction.error || request.error);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

/** @param {{productName?:unknown,specification?:unknown,purchasePrice?:unknown}} value */
export function validateManualProductInput(value) {
  const productName = String(value?.productName ?? "").replace(/\s+/g, " ").trim();
  const specification = String(value?.specification ?? "").replace(/\s+/g, " ").trim();
  const purchasePrice = Number(String(value?.purchasePrice ?? "").replace(/[,₩원\s]/g, ""));
  if (!productName) return { valid: false, message: "제품명을 입력해주세요." };
  if (!Number.isFinite(purchasePrice) || purchasePrice <= 0) return { valid: false, message: "매입가는 0보다 큰 숫자로 입력해주세요." };
  return { valid: true, product: { productName, specification, purchasePrice } };
}

function makeManualProductId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `manual::${uuid || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

/** @param {{productName?:unknown,specification?:unknown,purchasePrice?:unknown}} value */
export async function createManualProduct(value) {
  const validated = validateManualProductInput(value);
  if (!validated.valid) throw new Error(validated.message);
  const now = Date.now();
  const product = { id: makeManualProductId(), ...validated.product, source: "manual", createdAt: now, updatedAt: now };
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(PRODUCT_PRICE_MANUAL_STORE, "readwrite");
      tx.objectStore(PRODUCT_PRICE_MANUAL_STORE).add(product);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("직접등록 제품을 저장하지 못했습니다."));
    });
    return product;
  } finally { db.close(); }
}

/** @param {string} id */
export async function getManualProductById(id) {
  const key = String(id ?? "").trim();
  if (!key) return null;
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(PRODUCT_PRICE_MANUAL_STORE, "readonly");
      const request = tx.objectStore(PRODUCT_PRICE_MANUAL_STORE).get(key);
      tx.oncomplete = () => resolve(request.result || null);
      tx.onerror = () => reject(tx.error || request.error);
    });
  } finally { db.close(); }
}

export async function getAllManualProducts() {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(PRODUCT_PRICE_MANUAL_STORE, "readonly");
      const request = tx.objectStore(PRODUCT_PRICE_MANUAL_STORE).getAll();
      tx.oncomplete = () => resolve(request.result || []);
      tx.onerror = () => reject(tx.error || request.error);
    });
  } finally { db.close(); }
}

/** @param {string} id @param {{productName?:unknown,specification?:unknown,purchasePrice?:unknown}} value */
export async function updateManualProduct(id, value) {
  const existing = await getManualProductById(id);
  if (!existing) throw new Error("수정할 직접등록 제품을 찾지 못했습니다.");
  const validated = validateManualProductInput(value);
  if (!validated.valid) throw new Error(validated.message);
  const product = { ...existing, ...validated.product, id: existing.id, source: "manual", updatedAt: Date.now() };
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(PRODUCT_PRICE_MANUAL_STORE, "readwrite");
      tx.objectStore(PRODUCT_PRICE_MANUAL_STORE).put(product);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("직접등록 제품을 수정하지 못했습니다."));
    });
    return product;
  } finally { db.close(); }
}

/** mapping은 삭제하지 않는다. @param {string} id */
export async function deleteManualProduct(id) {
  const key = String(id ?? "").trim();
  if (!key) return;
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(PRODUCT_PRICE_MANUAL_STORE, "readwrite");
      tx.objectStore(PRODUCT_PRICE_MANUAL_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("직접등록 제품을 삭제하지 못했습니다."));
    });
  } finally { db.close(); }
}

/** 기존 회원2가 제품과 직접등록 제품을 함께 조회한다. @param {string} id */
export async function getProductById(id) {
  const key = String(id ?? "").trim();
  if (!key) return null;
  if (key.startsWith("manual::")) return getManualProductById(key);
  return (await getWholesaleProductById(key)) || getManualProductById(key);
}

export async function getAllProducts() {
  const database = await loadProductPriceDatabase();
  return [...database.products, ...database.manualProducts];
}

/** @param {Array<{id: string, productName: string, specification: string, purchasePrice: number}>} products @param {{fileName: string, importedAt?: number, productCount?: number, excludedCount?: number, duplicateCount?: number}} metadata */
export async function replaceProductPriceDatabase(products, metadata) {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction([PRODUCT_PRICE_PRODUCTS_STORE, PRODUCT_PRICE_METADATA_STORE], "readwrite");
      const productStore = transaction.objectStore(PRODUCT_PRICE_PRODUCTS_STORE);
      productStore.clear();
      for (const product of products) productStore.put({ id: product.id, productName: product.productName, specification: product.specification, purchasePrice: product.purchasePrice });
      transaction.objectStore(PRODUCT_PRICE_METADATA_STORE).put({ key: METADATA_KEY, fileName: metadata.fileName, importedAt: metadata.importedAt || Date.now(), productCount: metadata.productCount ?? products.length, excludedCount: metadata.excludedCount || 0, duplicateCount: metadata.duplicateCount || 0 });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("제품DB를 교체하지 못했습니다."));
      transaction.onabort = () => reject(transaction.error || new Error("제품DB 교체가 취소되었습니다."));
    });
  } finally { db.close(); }
}
