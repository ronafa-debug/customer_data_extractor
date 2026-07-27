/**
 * 동일 고객 그룹화
 * Key: 이름 + 전화번호 + 주소
 */
import { Customer } from "../model/Customer.js";
import { extractProductName } from "./ProductExtractor.js";
import { mergeProducts } from "./MergeProduct.js";

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * @param {string} phone
 * @returns {string}
 */
function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

/**
 * 고객 식별 키
 * @param {{ name: string, phone: string, address: string }} customer
 * @returns {string}
 */
export function makeCustomerKey(customer) {
  return [
    normalizeText(customer.name),
    normalizePhone(customer.phone),
    normalizeText(customer.address),
  ].join("|");
}

/**
 * 주문 행을 Customer[] 로 그룹화·상품 병합한다.
 * @param {Array<{
 *   name: string,
 *   phone: string,
 *   address: string,
 *   zipcode?: string,
 *   deliveryMessage?: string,
 *   productName: string,
 *   quantity: number
 * }>} rows
 * @returns {Customer[]}
 */
export function groupCustomers(rows) {
  /** @type {string[]} */
  const order = [];
  /** @type {Map<string, { customer: Customer, products: Array<{name:string,quantity:number}> }>} */
  const map = new Map();

  for (const row of rows || []) {
    const name = String(row.name || "").trim();
    const phone = String(row.phone || "").trim();
    const address = String(row.address || "").trim();
    const zipcode = String(row.zipcode || "").trim();
    if (!name && !phone && !address) continue;

    const key = makeCustomerKey({ name, phone, address });
    const productName = extractProductName(row.productName);
    const qty = Number(row.quantity);
    const quantity = Number.isFinite(qty) && qty > 0 ? qty : 1;
    const deliveryMessage = String(row.deliveryMessage || "").trim();

    if (!map.has(key)) {
      const customer = new Customer({
        name,
        phone,
        address,
        zipcode,
        deliveryMessage,
        products: [],
      });
      map.set(key, {
        customer,
        products: productName ? [{ name: productName, quantity }] : [],
      });
      order.push(key);
    } else {
      const entry = map.get(key);
      if (!entry.customer.deliveryMessage && deliveryMessage) {
        entry.customer.deliveryMessage = deliveryMessage;
      }
      if (!entry.customer.zipcode && zipcode) {
        entry.customer.zipcode = zipcode;
      }
      if (productName) {
        entry.products.push({ name: productName, quantity });
      }
    }
  }

  return order.map((key) => {
    const entry = map.get(key);
    entry.customer.products = mergeProducts(entry.products);
    return entry.customer;
  });
}
