/**
 * 서버 ProductParserFactory
 */
import { MonomartParser } from "./MonomartParser.js";

const PARSERS = [new MonomartParser()];

/**
 * @param {string} url
 * @returns {import('./BaseProductParser.js').BaseProductParser}
 */
export function detect(url) {
  for (const parser of PARSERS) {
    if (parser.canParse(url)) return parser;
  }
  throw new Error("지원하지 않는 쇼핑몰입니다.");
}

export const ProductParserFactory = { detect };
