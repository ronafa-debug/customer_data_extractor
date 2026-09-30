/**
 * CoupangParser — 쿠팡 주문서
 */
import { BaseParser } from "./BaseParser.js";
import { groupCustomers } from "../utils/GroupCustomer.js";
import { isDoorDropOnlyMessage } from "../utils/DoorDropMessage.js";
import { createStandardOrderRow, toCustomerGroupingRow } from "../model/StandardOrderRow.js";

export class CoupangParser extends BaseParser {
  /** @returns {string} */
  get mallId() {
    return "coupang";
  }

  /** @returns {string} */
  get mallLabel() {
    return "쿠팡 주문서";
  }

  /**
   * @param {object} workbook
   * @returns {boolean}
   */
  canParse(workbook) {
    const data = this.getSheetData(workbook);
    if (!data || data.length < 2) return false;

    const header = this.#findHeaderRow(data);
    if (!header) return false;

    const joined = header.row.map((c) => String(c || "")).join("|").toLowerCase();

    if (/스마트스토어|네이버페이|상품주문번호|배송비묶음번호/.test(joined)) {
      return false;
    }

    const signals = [
      "수취인이름",
      "수취인 이름",
      "주문번호",
      "노출상품명",
      "등록상품명",
      "구매수",
      "우편번호",
      "수취인주소",
      "수취인 주소",
      "쿠팡",
    ];

    const hit = signals.filter((s) => joined.includes(s.toLowerCase())).length;
    const hasReceiver = /수취인/.test(joined);
    const hasProduct = /상품명|노출상품|등록상품/.test(joined);

    return hit >= 2 || (hasReceiver && hasProduct);
  }

  /**
   * @param {object} workbook
   * @returns {import('../model/Customer.js').Customer[]}
   */
  parse(workbook) {
    return this.parseWithOrderRows(workbook).customers;
  }

  /** @param {object} workbook */
  parseWithOrderRows(workbook) {
    const data = this.getSheetData(workbook);
    const headerInfo = this.#findHeaderRow(data);
    if (!headerInfo) {
      throw new Error("쿠팡 주문서 헤더를 찾을 수 없습니다.");
    }

    const cols = this.#mapColumns(headerInfo.row);
    if (cols.name < 0 || cols.product < 0) {
      throw new Error("쿠팡 주문서에서 필수 컬럼(수취인/상품명)을 찾지 못했습니다.");
    }

    /** @type {Array<object>} */
    const orderRows = [];

    for (let i = headerInfo.index + 1; i < data.length; i++) {
      const row = data[i] || [];
      if (this.isEmptyRow(row)) continue;

      const name = this.cell(row[cols.name]);
      const phone = cols.phone >= 0 ? this.cell(row[cols.phone]) : "";
      const zipcode = cols.zip >= 0 ? this.cell(row[cols.zip]) : "";
      const addr1 = cols.address >= 0 ? this.cell(row[cols.address]) : "";
      const addr2 = cols.addressDetail >= 0 ? this.cell(row[cols.addressDetail]) : "";
      const address = this.joinAddressParts(addr1, addr2);
      const rawDeliveryMessage =
        cols.message >= 0 ? this.cell(row[cols.message]) : "";
      const deliveryMessage = isDoorDropOnlyMessage(rawDeliveryMessage)
        ? ""
        : rawDeliveryMessage;
      const displayProductName = this.cell(row[cols.product]);
      const registeredProductName = cols.rawProduct >= 0 ? this.cell(row[cols.rawProduct]) : "";
      const rawOptionName = cols.rawOption >= 0 ? this.cell(row[cols.rawOption]) : "";
      const platformProductId = cols.productId >= 0 ? this.cell(row[cols.productId]) : "";
      const platformOptionId = cols.optionId >= 0 ? this.cell(row[cols.optionId]) : "";
      const quantity = cols.qty >= 0 ? this.parseQuantity(row[cols.qty]) : 1;

      if (!name && !displayProductName) continue;

      orderRows.push(createStandardOrderRow({
        platform: "coupang",
        displayProductName,
        rawProductName: registeredProductName || displayProductName,
        rawOptionName,
        platformProductId,
        platformOptionId,
        customerName: name,
        phone,
        address,
        zipcode,
        deliveryMessage,
        quantity,
      }));
    }

    return {
      orderRows,
      customers: groupCustomers(orderRows.map(toCustomerGroupingRow)),
    };
  }

  /**
   * @param {any[][]} data
   * @returns {{ index: number, row: any[] } | null}
   */
  #findHeaderRow(data) {
    const max = Math.min(data.length, 10);
    for (let i = 0; i < max; i++) {
      const row = data[i] || [];
      const text = row.map((c) => String(c || "")).join(" ");
      if (/수취인|상품명|주문번호|구매자/.test(text)) {
        return { index: i, row };
      }
    }
    if (data[0]) return { index: 0, row: data[0] };
    return null;
  }

  /**
   * @param {any[]} headerRow
   */
  #mapColumns(headerRow) {
    let address = this.findColumnIndex(headerRow, [
      "수취인주소",
      "수취인 주소",
      "배송지주소",
      "수취인기본주소",
      "기본주소",
    ]);
    if (address < 0) {
      address = this.findColumnIndex(headerRow, ["주소"]);
    }
    const addressDetail = this.findColumnIndex(
      headerRow,
      ["수취인주소상세", "상세주소", "주소상세", "수취인상세주소"],
      [address]
    );

    return {
      name: this.findColumnIndex(headerRow, [
        "수취인이름",
        "수취인 이름",
        "수취인명",
        "구매자",
        "이름",
      ]),
      phone: this.findColumnIndex(headerRow, [
        "수취인전화번호",
        "수취인 전화번호",
        "수취인휴대폰",
        "수취인연락처",
        "구매자전화번호",
        "전화번호",
        "휴대폰",
      ]),
      zip: this.findColumnIndex(headerRow, [
        "우편번호",
        "수취인우편번호",
        "우편 번호",
      ]),
      address,
      addressDetail,
      product: this.findColumnIndex(headerRow, [
        "노출상품명",
        "등록상품명",
        "상품명",
        "옵션명",
      ]),
      rawProduct: this.findColumnIndex(headerRow, ["등록상품명"]),
      rawOption: this.findColumnIndex(headerRow, ["등록옵션명"]),
      productId: this.findColumnIndex(headerRow, ["노출상품ID"]),
      optionId: this.findColumnIndex(headerRow, ["옵션ID"]),
      qty: this.findColumnIndex(headerRow, [
        "구매수",
        "구매수량",
        "수량",
        "주문수량",
        "개수",
      ]),
      message: this.findColumnIndex(headerRow, [
        "배송메시지",
        "배송메세지",
        "배송요청사항",
        "요청사항",
        "배송시 요청사항",
      ]),
    };
  }
}
