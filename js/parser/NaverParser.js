/**
 * NaverParser — 네이버 스마트스토어 주문서
 * 데이터는 3행(index 2)부터 읽는다.
 */
import { BaseParser } from "./BaseParser.js";
import { groupCustomers } from "../utils/GroupCustomer.js";

export class NaverParser extends BaseParser {
  /** @returns {string} */
  get mallId() {
    return "naver";
  }

  /** @returns {string} */
  get mallLabel() {
    return "네이버 주문서";
  }

  /**
   * @param {object} workbook
   * @returns {boolean}
   */
  canParse(workbook) {
    const data = this.getSheetData(workbook);
    if (!data || data.length < 3) return false;

    const headerInfo = this.#findHeaderRow(data);
    if (!headerInfo) return false;

    const joined = headerInfo.row.map((c) => String(c || "")).join("|").toLowerCase();

    const coupangStrong =
      /노출상품명|등록상품명|구매수/.test(joined) &&
      !/상품주문번호|수취인명/.test(joined);
    if (coupangStrong) return false;

    const signals = [
      "상품주문번호",
      "스마트스토어",
      "네이버페이",
      "배송비묶음번호",
      "수취인명",
      "수취인연락처1",
      "상품명",
      "기본배송지",
      "상세배송지",
      "구매자명",
      "네이버",
    ];

    const hit = signals.filter((s) => joined.includes(s.toLowerCase())).length;
    return hit >= 2 || /상품주문번호|수취인명|수취인연락처/.test(joined);
  }

  /**
   * @param {object} workbook
   * @returns {import('../model/Customer.js').Customer[]}
   */
  parse(workbook) {
    const data = this.getSheetData(workbook);
    const headerInfo = this.#findHeaderRow(data);
    if (!headerInfo) {
      throw new Error("네이버 주문서 헤더를 찾을 수 없습니다.");
    }

    const cols = this.#mapColumns(headerInfo.row);
    if (cols.name < 0 || cols.product < 0) {
      throw new Error("네이버 주문서에서 필수 컬럼(수취인명/상품명)을 찾지 못했습니다.");
    }

    // 명세서: 3행부터 데이터 (0-based index 2)
    const dataStart = Math.max(2, headerInfo.index + 1);
    /** @type {Array<object>} */
    const rawRows = [];

    for (let i = dataStart; i < data.length; i++) {
      const row = data[i] || [];
      if (this.isEmptyRow(row)) continue;

      const name = this.cell(row[cols.name]);
      const phone = cols.phone >= 0 ? this.cell(row[cols.phone]) : "";
      const zipcode = cols.zip >= 0 ? this.cell(row[cols.zip]) : "";
      const baseAddr = cols.address >= 0 ? this.cell(row[cols.address]) : "";
      const detailAddr =
        cols.addressDetail >= 0 ? this.cell(row[cols.addressDetail]) : "";
      // 기본주소 + 상세주소를 한 줄로 합친다
      const address = [baseAddr, detailAddr].filter(Boolean).join(" ");
      const deliveryMessage = cols.message >= 0 ? this.cell(row[cols.message]) : "";
      const productName = this.cell(row[cols.product]);
      const quantity = cols.qty >= 0 ? this.parseQuantity(row[cols.qty]) : 1;

      if (!name && !productName) continue;

      rawRows.push({
        name,
        phone,
        address,
        zipcode,
        deliveryMessage,
        productName,
        quantity,
      });
    }

    return groupCustomers(rawRows);
  }

  /**
   * @param {any[][]} data
   * @returns {{ index: number, row: any[] } | null}
   */
  #findHeaderRow(data) {
    const max = Math.min(data.length, 5);
    let best = null;
    let bestScore = -1;

    for (let i = 0; i < max; i++) {
      const row = data[i] || [];
      const text = row.map((c) => String(c || "")).join(" ");
      let score = 0;
      if (/수취인명|수취인연락처|상품주문번호|상품명/.test(text)) score += 3;
      if (/우편번호|기본배송지|수량/.test(text)) score += 2;
      if (/주문/.test(text)) score += 1;
      if (score > bestScore) {
        bestScore = score;
        best = { index: i, row };
      }
    }

    if (best && bestScore > 0) return best;
    if (data[1]) return { index: 1, row: data[1] };
    if (data[0]) return { index: 0, row: data[0] };
    return null;
  }

  /**
   * @param {any[]} headerRow
   */
  #mapColumns(headerRow) {
    return {
      name: this.findColumnIndex(headerRow, [
        "수취인명",
        "수취인",
        "구매자명",
        "이름",
      ]),
      phone: this.findColumnIndex(headerRow, [
        "수취인연락처1",
        "수취인연락처",
        "수취인전화번호",
        "구매자연락처",
        "전화번호",
        "휴대폰번호",
      ]),
      zip: this.findColumnIndex(headerRow, ["우편번호", "수취인우편번호"]),
      address: this.findColumnIndex(headerRow, [
        "기본배송지",
        "배송지",
        "주소",
        "수취인주소",
      ]),
      addressDetail: this.findColumnIndex(headerRow, [
        "상세배송지",
        "상세주소",
        "배송지상세",
      ]),
      product: this.findColumnIndex(headerRow, ["상품명", "상품이름"]),
      qty: this.findColumnIndex(headerRow, ["수량", "주문수량", "구매수량"]),
      message: this.findColumnIndex(headerRow, [
        "배송메시지",
        "배송메세지",
        "배송요청사항",
        "요청사항",
        "배송시요청사항",
      ]),
    };
  }
}
