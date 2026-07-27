/**
 * Product 모델
 */
export class Product {
  /**
   * @param {string} name
   * @param {number} quantity
   */
  constructor(name, quantity) {
    /** @type {string} */
    this.name = String(name || "").trim();
    const qty = Number(quantity);
    /** @type {number} */
    this.quantity = Number.isFinite(qty) && qty > 0 ? qty : 1;
  }
}
