/**
 * Customer 모델 — 모든 Parser의 공통 반환 형식
 */
export class Customer {
  /**
   * @param {object} [params]
   * @param {string} [params.name]
   * @param {string} [params.phone]
   * @param {string} [params.address]
   * @param {string} [params.zipcode]
   * @param {string} [params.deliveryMessage]
   * @param {import('./Product.js').Product[]} [params.products]
   */
  constructor({
    name = "",
    phone = "",
    address = "",
    zipcode = "",
    deliveryMessage = "",
    products = [],
  } = {}) {
    /** @type {string} */
    this.name = String(name || "").trim();
    /** @type {string} */
    this.phone = String(phone || "").trim();
    /** @type {string} */
    this.address = String(address || "").trim();
    /** @type {string} */
    this.zipcode = String(zipcode || "").trim();
    /** @type {string} */
    this.deliveryMessage = String(deliveryMessage || "").trim();
    /** @type {import('./Product.js').Product[]} */
    this.products = Array.isArray(products) ? products : [];
  }

  /**
   * 출력용 주소 (우편번호 + 주소)
   * @returns {string}
   */
  get fullAddress() {
    const zip = this.zipcode;
    const addr = this.address;
    if (zip && addr) {
      if (addr.startsWith(zip)) return addr;
      return `${zip} ${addr}`;
    }
    return addr || zip;
  }
}
