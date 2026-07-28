/**
 * 프론트엔드 쇼핑몰 URL 판별 (실제 DOM 파싱은 서버 Parser가 수행)
 */
export class BaseProductParser {
  /** @returns {string} */
  get mallId() {
    return "unknown";
  }

  /** @returns {string} */
  get mallLabel() {
    return "알 수 없음";
  }

  /**
   * @param {string} url
   * @returns {boolean}
   */
  canParse(url) {
    return false;
  }
}
