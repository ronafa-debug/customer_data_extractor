import { makeWholesaleProductId, makeWholesaleProductKey, normalizeProductText } from "./productNormalizer.js";

const HEADER_SCAN_ROWS = 20;

/** @param {unknown} value */
export function parseWholesalePrice(value) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : 0;
  const text = String(value ?? "").replace(/[,₩원\s]/g, "").trim();
  if (!text || !/^\d+(?:\.\d+)?$/.test(text)) return 0;
  const amount = Number(text);
  return Number.isFinite(amount) ? Math.round(amount) : 0;
}

/** @param {unknown} value */
function headerText(value) {
  return normalizeProductText(value).replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
}

/** @param {unknown[]} row @param {string[]} names */
function findHeaderColumn(row, names) {
  const wanted = names.map(headerText);
  return (row || []).findIndex((cell) => wanted.includes(headerText(cell)));
}

/** @param {Array<{name: string, data: any[][]}>} sheets */
function pickSheet(sheets) {
  const list = (sheets || []).filter((sheet) => Array.isArray(sheet?.data) && sheet.data.length);
  return list.slice().sort((a, b) => b.data.length - a.data.length)[0] || null;
}

/**
 * 회원2가 품목가격 Excel을 제품DB 행으로 정규화한다.
 * @param {{sheets: Array<{name: string, data: any[][]}>}} workbook
 */
export function parseWholesaleWorkbook(workbook) {
  const sheet = pickSheet(workbook?.sheets);
  if (!sheet) throw new Error("회원2가 제품DB 시트를 찾지 못했습니다.");

  let map = null;
  for (let rowIndex = 0; rowIndex < Math.min(HEADER_SCAN_ROWS, sheet.data.length); rowIndex += 1) {
    const row = sheet.data[rowIndex] || [];
    const productNameColumn = findHeaderColumn(row, ["품명"]);
    const specificationColumn = findHeaderColumn(row, ["규격"]);
    const purchasePriceColumn = findHeaderColumn(row, ["도매2가", "판매단가", "도매가"]);
    if (productNameColumn >= 0 && specificationColumn >= 0 && purchasePriceColumn >= 0) {
      map = { rowIndex, productNameColumn, specificationColumn, purchasePriceColumn };
    }
  }
  if (!map) {
    throw new Error("회원2가 제품DB 형식이 아닙니다. 품명 / 규격 / 도매2가 정보를 확인해주세요.");
  }

  const candidates = [];
  let excludedCount = 0;
  for (let rowIndex = map.rowIndex + 1; rowIndex < sheet.data.length; rowIndex += 1) {
    const row = sheet.data[rowIndex] || [];
    const productName = normalizeProductText(row[map.productNameColumn]);
    const specification = normalizeProductText(row[map.specificationColumn]);
    const purchasePrice = parseWholesalePrice(row[map.purchasePriceColumn]);
    if (!productName || purchasePrice <= 0) {
      if (row.some((cell) => normalizeProductText(cell))) excludedCount += 1;
      continue;
    }
    const id = makeWholesaleProductId(productName, specification);
    candidates.push({ id, productName, specification, purchasePrice, rowNumber: rowIndex + 1 });
  }

  const groups = new Map();
  for (const item of candidates) {
    const key = makeWholesaleProductKey(item.productName, item.specification);
    groups.set(key, [...(groups.get(key) || []), item]);
  }
  const duplicates = [];
  const products = [];
  for (const items of groups.values()) {
    if (items.length > 1) {
      duplicates.push({ productName: items[0].productName, specification: items[0].specification, rowNumbers: items.map((item) => item.rowNumber) });
      continue;
    }
    const { rowNumber, ...product } = items[0];
    products.push(product);
  }
  if (!products.length) {
    throw new Error("저장할 유효 제품이 없습니다. 품명과 0보다 큰 도매2가를 확인해주세요.");
  }
  return {
    products,
    excludedCount,
    duplicateCount: duplicates.reduce((sum, item) => sum + item.rowNumbers.length, 0),
    duplicates,
    sheetName: sheet.name,
    headerRowIndex: map.rowIndex,
    sourceRowCount: Math.max(0, sheet.data.length - map.rowIndex - 1),
  };
}
