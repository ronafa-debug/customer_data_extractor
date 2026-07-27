/**
 * 동일 상품 수량 합산
 */
import { Product } from "../model/Product.js";

/**
 * 상품 배열에서 동일 상품명을 합산한다.
 * @param {Array<{ name: string, quantity?: number }>} products
 * @returns {Product[]}
 */
export function mergeProducts(products) {
  if (!Array.isArray(products) || products.length === 0) return [];

  /** @type {Map<string, number>} */
  const map = new Map();

  for (const item of products) {
    const name = String(item.name || "").trim();
    if (!name) continue;

    const qty = Number(item.quantity);
    const addQty = Number.isFinite(qty) && qty > 0 ? qty : 1;
    map.set(name, (map.get(name) || 0) + addQty);
  }

  return Array.from(map.entries()).map(
    ([name, quantity]) => new Product(name, quantity)
  );
}

/**
 * 여러 고객의 상품을 상품별 총합으로 합친다 (피킹용).
 * @param {import('../model/Customer.js').Customer[]} customers
 * @returns {Product[]}
 */
export function mergeAllProducts(customers) {
  const flat = [];
  for (const customer of customers || []) {
    for (const product of customer.products || []) {
      flat.push(product);
    }
  }
  return mergeProducts(flat);
}
