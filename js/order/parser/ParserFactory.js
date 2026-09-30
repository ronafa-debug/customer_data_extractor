/**
 * ParserFactory — Parser 자동 선택
 * 신규 쇼핑몰: PARSERS 배열에만 등록하면 확장된다.
 */
import { CoupangParser } from "./CoupangParser.js";
import { NaverParser } from "./NaverParser.js";
import { ERROR_MESSAGE } from "../constants.js";

/**
 * 등록된 Parser 목록 (Open/Closed: 추가는 여기만)
 * @type {import('./BaseParser.js').BaseParser[]}
 */
const PARSERS = [new NaverParser(), new CoupangParser()];

/**
 * workbook에 맞는 Parser를 자동 선택한다.
 * @param {{ sheets: Array<{ name: string, data: any[][] }>, fileName?: string }} workbook
 * @returns {import('./BaseParser.js').BaseParser}
 */
export function detect(workbook) {
  for (const parser of PARSERS) {
    try {
      if (parser.canParse(workbook)) {
        return parser;
      }
    } catch (err) {
      console.error("[ParserFactory] canParse error:", err);
    }
  }
  throw new Error(ERROR_MESSAGE.UNSUPPORTED_MALL);
}

/**
 * 파서 선택 + 파싱
 * @param {object} workbook
 * @returns {{ parser: import('./BaseParser.js').BaseParser, customers: import('../model/Customer.js').Customer[] }}
 */
export function parseWorkbook(workbook) {
  const parser = detect(workbook);
  if (typeof parser.parseWithOrderRows === "function") {
    const { customers, orderRows } = parser.parseWithOrderRows(workbook);
    return { parser, customers, orderRows };
  }
  const customers = parser.parse(workbook);
  return { parser, customers, orderRows: [] };
}

export const ParserFactory = {
  detect,
  parse: parseWorkbook,
};
