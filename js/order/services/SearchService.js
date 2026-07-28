/**
 * SearchService — 고객/상품 실시간 검색
 */
import { SEARCH_DEBOUNCE_MS } from "../constants.js";

/**
 * 고객 목록 필터 (고객명·전화·주소·상품명)
 * @param {import('../model/Customer.js').Customer[]} customers
 * @param {string} query
 * @returns {import('../model/Customer.js').Customer[]}
 */
export function filterCustomers(customers, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return customers || [];

  const queryDigits = q.replace(/\D/g, "");

  return (customers || []).filter((customer) => {
    const name = String(customer.name || "").toLowerCase();
    const phone = String(customer.phone || "").toLowerCase();
    const phoneDigits = phone.replace(/\D/g, "");
    const address = String(customer.fullAddress || customer.address || "").toLowerCase();

    if (name.includes(q)) return true;
    if (phone.includes(q)) return true;
    if (queryDigits && phoneDigits.includes(queryDigits)) return true;
    if (address.includes(q)) return true;

    return (customer.products || []).some((p) =>
      String(p.name || "").toLowerCase().includes(q)
    );
  });
}

/**
 * 피킹용 상품 검색
 * @param {import('../model/Product.js').Product[]} products
 * @param {string} query
 * @returns {import('../model/Product.js').Product[]}
 */
export function filterProducts(products, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return products || [];
  return (products || []).filter((p) =>
    String(p.name || "").toLowerCase().includes(q)
  );
}

/**
 * debounce 헬퍼
 * @param {Function} fn
 * @param {number} [wait]
 * @returns {Function & { cancel: () => void }}
 */
export function debounce(fn, wait = SEARCH_DEBOUNCE_MS) {
  let timer = null;

  function debounced(...args) {
    if (timer != null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  }

  debounced.cancel = () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return debounced;
}

export const SearchService = {
  filterCustomers,
  filterProducts,
  debounce,
};
