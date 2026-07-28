/**
 * 모노마트(Monomart) URL Parser
 */
import { BaseProductParser } from "./BaseProductParser.js";

export class MonomartParser extends BaseProductParser {
  get mallId() {
    return "monomart";
  }

  get mallLabel() {
    return "모노마트";
  }

  /**
   * @param {string} url
   * @returns {boolean}
   */
  canParse(url) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return (
        host === "monomart.com" ||
        host.endsWith(".monomart.com") ||
        host.includes("monomart")
      );
    } catch {
      return false;
    }
  }
}
