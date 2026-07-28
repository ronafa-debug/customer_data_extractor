/**
 * ProductParserFactory — URL로 지원 쇼핑몰 Parser를 선택
 * 신규 쇼핑몰: PARSERS 배열에만 등록
 */
import { MonomartParser } from "./MonomartParser.js";

const PARSERS = [new MonomartParser()];

export const UNSUPPORTED_MALL_MESSAGE = "지원하지 않는 쇼핑몰입니다.";

/**
 * @param {string} url
 * @returns {import('./BaseProductParser.js').BaseProductParser}
 */
export function detect(url) {
  for (const parser of PARSERS) {
    try {
      if (parser.canParse(url)) return parser;
    } catch (err) {
      console.error("[ProductParserFactory] canParse:", err);
    }
  }
  throw new Error(UNSUPPORTED_MALL_MESSAGE);
}

export const ProductParserFactory = { detect };
