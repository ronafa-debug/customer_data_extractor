/**
 * ExportService — 텍스트 포맷 · 복사 · TXT 다운로드
 */
import {
  CUSTOMER_SEPARATOR,
  PICKING_SEPARATOR,
  OUTPUT_MODE,
  ERROR_MESSAGE,
} from "../constants.js";
import { formatProductLine } from "../utils/ProductExtractor.js";
import { mergeAllProducts } from "../utils/MergeProduct.js";
import { copyText } from "../utils/Clipboard.js";
import { buildOrderTxtFilename } from "../utils/DateUtil.js";

/**
 * 주소 내 줄바꿈을 공백으로 합친다.
 * @param {string} address
 * @returns {string}
 */
function flattenAddress(address) {
  return String(address || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 기본형 출력
 * 이름 / 전화 / 주소 / (배송메시지) / 상품 사이를 빈 줄로 구분한다.
 * 배송메시지가 없으면 해당 블록 자체를 생략한다.
 * @param {import('../model/Customer.js').Customer} customer
 * @returns {string}
 */
export function formatBasic(customer) {
  /** @type {string[]} */
  const blocks = [];

  if (customer.name) blocks.push(customer.name);
  if (customer.phone) blocks.push(customer.phone);

  const address = flattenAddress(customer.fullAddress);
  if (address) blocks.push(address);

  if (customer.deliveryMessage) {
    blocks.push(customer.deliveryMessage);
  }

  const productLines = (customer.products || []).map((product) =>
    formatProductLine(product.name, product.quantity)
  );
  if (productLines.length) {
    blocks.push(productLines.join("\n"));
  }

  blocks.push(CUSTOMER_SEPARATOR);
  return blocks.join("\n\n");
}

/**
 * 택배기사용
 * @param {import('../model/Customer.js').Customer} customer
 * @returns {string}
 */
export function formatDelivery(customer) {
  /** @type {string[]} */
  const blocks = [];

  if (customer.name) blocks.push(customer.name);

  const address = flattenAddress(customer.fullAddress);
  if (address) blocks.push(address);

  if (customer.deliveryMessage) {
    blocks.push(customer.deliveryMessage);
  }

  blocks.push(CUSTOMER_SEPARATOR);
  return blocks.join("\n\n");
}

/**
 * 피킹용 — 상품별 총합
 * @param {import('../model/Product.js').Product[]} products
 * @returns {string}
 */
export function formatPicking(products) {
  const blocks = [];
  for (const product of products) {
    blocks.push(
      `${product.name}\n\n${product.quantity}개\n\n${PICKING_SEPARATOR}`
    );
  }
  return blocks.join("\n");
}

/**
 * 현재 모드 기준 전체 텍스트 생성
 * @param {import('../model/Customer.js').Customer[]} customers
 * @param {string} mode
 * @param {import('../model/Product.js').Product[]} [pickingProducts]
 * @returns {string}
 */
export function buildExportText(customers, mode, pickingProducts) {
  if (mode === OUTPUT_MODE.PICKING) {
    const list = pickingProducts || mergeAllProducts(customers);
    if (!list.length) return "";
    const sorted = [...list].sort(
      (a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, "ko")
    );
    return formatPicking(sorted);
  }

  if (!customers.length) return "";

  const formatter =
    mode === OUTPUT_MODE.DELIVERY ? formatDelivery : formatBasic;
  return customers.map(formatter).join("\n\n");
}

/**
 * 단일 고객 블록 텍스트 (구분선 제외 — 화면/개별 복사용)
 * @param {import('../model/Customer.js').Customer} customer
 * @param {string} mode
 * @returns {string}
 */
export function formatCustomerBlock(customer, mode) {
  const raw =
    mode === OUTPUT_MODE.DELIVERY
      ? formatDelivery(customer)
      : formatBasic(customer);
  const sep = CUSTOMER_SEPARATOR;
  let text = String(raw || "").trimEnd();
  if (text.endsWith(sep)) {
    text = text.slice(0, -sep.length).trimEnd();
  }
  return text;
}

/**
 * @param {string} text
 * @returns {Promise<void>}
 */
export async function copyAll(text) {
  await copyText(text);
}

/**
 * TXT 다운로드 (FileSaver.js)
 * @param {string} text
 * @param {Date} [date]
 */
export function downloadTxt(text, date = new Date()) {
  const content = String(text || "");
  if (!content.trim()) {
    throw new Error(ERROR_MESSAGE.DOWNLOAD_EMPTY);
  }

  const filename = buildOrderTxtFilename(date);
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });

  if (typeof globalThis.saveAs === "function") {
    globalThis.saveAs(blob, filename);
    return;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const ExportService = {
  formatBasic,
  formatDelivery,
  formatPicking,
  formatCustomerBlock,
  buildExportText,
  copyAll,
  downloadTxt,
};
