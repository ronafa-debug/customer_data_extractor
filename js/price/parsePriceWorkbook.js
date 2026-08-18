/**
 * 2단 헤더 품목가격 엑셀 → 제품가격관리 행
 * 판매가 그룹이 아니라 제안가 그룹의 공급가/부가세만 사용한다.
 */

const HEADER_SCAN_ROWS = 15;
const NAVER_RATE = 1.15;
const COUPANG_RATE = 1.25;

/**
 * @param {unknown} value
 * @returns {string}
 */
export function cellText(value) {
  return String(value ?? "").replace(/\s+/g, "").trim();
}

/**
 * @param {unknown} value
 * @returns {number}
 */
export function parseWon(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value) : 0;
  }
  const raw = String(value).replace(/[,\s원₩]/g, "").trim();
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeSearchText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, "");
}

/**
 * @param {unknown[]} row
 * @param {(text: string) => boolean} pred
 * @param {number} [from]
 * @param {number} [to]
 * @returns {number}
 */
function findCol(row, pred, from = 0, to = row.length) {
  const end = Math.min(to, row.length);
  for (let i = from; i < end; i += 1) {
    if (pred(cellText(row[i]))) return i;
  }
  return -1;
}

/**
 * @param {any[][]} data
 */
function mapHeaders(data) {
  const scan = Math.min(HEADER_SCAN_ROWS, data.length);
  let detailRowIndex = -1;
  for (let i = 0; i < scan; i += 1) {
    const row = data[i] || [];
    if (findCol(row, (t) => t === "품목명") >= 0) {
      detailRowIndex = i;
      break;
    }
  }
  if (detailRowIndex < 0) {
    throw new Error("품목명 헤더를 찾을 수 없습니다. 품목가격 엑셀인지 확인해주세요.");
  }

  const detail = data[detailRowIndex] || [];
  const group = detailRowIndex > 0 ? data[detailRowIndex - 1] || [] : [];
  const width = Math.max(detail.length, group.length);

  const nameCol = findCol(detail, (t) => t === "품목명");
  const specCol = findCol(detail, (t) => t === "규격");
  const makerCol = findCol(detail, (t) => t.startsWith("제조사"));
  const originCol = findCol(detail, (t) => t === "원산지");

  let offerStart = findCol(group, (t) => t === "제안가");
  let offerEnd = width;

  if (offerStart >= 0) {
    for (let c = offerStart + 1; c < width; c += 1) {
      if (cellText(group[c])) {
        offerEnd = c;
        break;
      }
    }
  } else {
    const lastSupply = lastIndex(detail, (t) => t === "공급가");
    const lastVat = lastIndex(detail, (t) => t === "부가세");
    if (lastSupply >= 0 && lastVat >= 0) {
      offerStart = Math.min(lastSupply, lastVat);
      offerEnd = Math.max(lastSupply, lastVat) + 1;
    }
  }

  let supplyCol = findCol(detail, (t) => t === "공급가", Math.max(0, offerStart), offerEnd);
  let vatCol = findCol(detail, (t) => t === "부가세", Math.max(0, offerStart), offerEnd);
  if (supplyCol < 0 || vatCol < 0) {
    supplyCol = lastIndex(detail, (t) => t === "공급가");
    vatCol = lastIndex(detail, (t) => t === "부가세");
  }

  if (nameCol < 0 || supplyCol < 0 || vatCol < 0) {
    throw new Error("제안가 공급가/부가세 열을 찾을 수 없습니다. 엑셀 헤더를 확인해주세요.");
  }

  return {
    dataStart: detailRowIndex + 1,
    nameCol,
    specCol,
    makerCol,
    originCol,
    supplyCol,
    vatCol,
  };
}

/**
 * @param {unknown[]} row
 * @param {(text: string) => boolean} pred
 * @returns {number}
 */
function lastIndex(row, pred) {
  for (let i = row.length - 1; i >= 0; i -= 1) {
    if (pred(cellText(row[i]))) return i;
  }
  return -1;
}

/**
 * @param {Array<{ name: string, data: any[][] }>} sheets
 */
function pickSheet(sheets) {
  const list = (sheets || []).filter((s) => Array.isArray(s?.data) && s.data.length);
  if (!list.length) return null;
  const named = list.find((s) =>
    /BAM2200|ItemPriceData|품목|가격/i.test(String(s.name || ""))
  );
  if (named) return named;
  return list.slice().sort((a, b) => b.data.length - a.data.length)[0];
}

/**
 * @param {object} row
 * @param {string} query
 * @returns {boolean}
 */
export function rowMatchesQuery(row, query) {
  const q = normalizeSearchText(query);
  if (!q) return false;
  const hay = row.searchKey || normalizeSearchText(`${row.name}${row.spec}${row.maker}`);
  return hay.includes(q);
}

/**
 * @param {{ sheets: Array<{ name: string, data: any[][] }> }} workbook
 * @returns {{ rows: object[], sheetName: string }}
 */
export function parsePriceWorkbook(workbook) {
  const sheet = pickSheet(workbook?.sheets);
  if (!sheet) {
    throw new Error("시트를 찾을 수 없습니다.");
  }

  const map = mapHeaders(sheet.data);
  const rows = [];

  for (let r = map.dataStart; r < sheet.data.length; r += 1) {
    const line = sheet.data[r] || [];
    const name = String(line[map.nameCol] ?? "").trim();
    if (!name) continue;

    const spec = map.specCol >= 0 ? String(line[map.specCol] ?? "").trim() : "";
    const maker = map.makerCol >= 0 ? String(line[map.makerCol] ?? "").trim() : "";
    const origin = map.originCol >= 0 ? String(line[map.originCol] ?? "").trim() : "";
    const supply = parseWon(line[map.supplyCol]);
    const vat = parseWon(line[map.vatCol]);
    const offer = supply + vat;

    rows.push({
      id: `r${Date.now().toString(36)}-${rows.length + 1}`,
      seq: rows.length + 1,
      name,
      spec,
      maker,
      origin,
      supply,
      vat,
      offer,
      naver: Math.round(offer * NAVER_RATE),
      coupang: Math.round(offer * COUPANG_RATE),
      searchKey: normalizeSearchText(`${name}${spec}${maker}`),
    });
  }

  if (!rows.length) {
    throw new Error("품목 데이터가 없습니다.");
  }

  return { rows, sheetName: sheet.name };
}
