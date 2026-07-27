/**
 * BaseParser — Strategy Pattern 기본 클래스
 */
export class BaseParser {
  /**
   * 이 파서가 workbook을 처리할 수 있는지 판별한다.
   * @param {{ sheets: Array<{ name: string, data: any[][] }>, fileName?: string }} workbook
   * @returns {boolean}
   */
  canParse(workbook) {
    return false;
  }

  /**
   * workbook을 파싱하여 Customer[] 를 반환한다.
   * @param {{ sheets: Array<{ name: string, data: any[][] }>, fileName?: string }} workbook
   * @returns {import('../model/Customer.js').Customer[]}
   */
  parse(workbook) {
    throw new Error("parse()는 하위 클래스에서 구현해야 합니다.");
  }

  /** @returns {string} */
  get mallId() {
    return "unknown";
  }

  /** @returns {string} */
  get mallLabel() {
    return "알 수 없음";
  }

  /**
   * 헤더 행에서 컬럼 인덱스를 찾는다.
   * @param {any[]} headerRow
   * @param {string[]} candidates
   * @returns {number}
   */
  findColumnIndex(headerRow, candidates) {
    const headers = (headerRow || []).map((h) =>
      String(h || "").replace(/\s+/g, "").toLowerCase()
    );

    for (const candidate of candidates) {
      const key = candidate.replace(/\s+/g, "").toLowerCase();
      const exact = headers.findIndex((h) => h === key);
      if (exact >= 0) return exact;
    }

    for (const candidate of candidates) {
      const key = candidate.replace(/\s+/g, "").toLowerCase();
      const partial = headers.findIndex(
        (h) => h && (h.includes(key) || key.includes(h))
      );
      if (partial >= 0) return partial;
    }

    return -1;
  }

  /**
   * @param {any} value
   * @returns {string}
   */
  cell(value) {
    if (value == null) return "";
    return String(value).replace(/\r\n/g, "\n").trim();
  }

  /**
   * @param {any} value
   * @returns {number}
   */
  parseQuantity(value) {
    const n = parseInt(String(value ?? "1").replace(/[^\d-]/g, ""), 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  /**
   * @param {any[]} row
   * @returns {boolean}
   */
  isEmptyRow(row) {
    return !(row || []).some((c) => String(c || "").trim() !== "");
  }

  /**
   * 첫 시트 데이터
   * @param {object} workbook
   * @returns {any[][]}
   */
  getSheetData(workbook) {
    if (!workbook?.sheets?.length) return [];
    return workbook.sheets[0].data || [];
  }
}
