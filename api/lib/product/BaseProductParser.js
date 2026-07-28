/**
 * @typedef {object} ProductCaptureResult
 * @property {string} name
 * @property {import('playwright-core').Locator | null} mainImageLocator
 * @property {import('playwright-core').Locator | null} informationLocator
 */

export class BaseProductParser {
  /** @returns {string} */
  get mallId() {
    return "unknown";
  }

  /**
   * @param {string} url
   * @returns {boolean}
   */
  canParse(url) {
    return false;
  }

  /**
   * @param {import('playwright-core').Page} page
   * @param {string} url
   * @returns {Promise<ProductCaptureResult>}
   */
  async parse(page, url) {
    throw new Error("parse()는 하위 클래스에서 구현해야 합니다.");
  }

  /**
   * 팝업/오버레이 제거 (쇼핑몰별 오버라이드)
   * @param {import('playwright-core').Page} page
   */
  async dismissOverlays(page) {
    /* no-op */
  }

  /**
   * Lazy-load 이미지를 위해 페이지를 빠르게 스크롤한다.
   * @param {import('playwright-core').Page} page
   */
  async scrollToBottom(page) {
    await page.evaluate(async () => {
      if (!document.body) return;
      await new Promise((resolve) => {
        let total = 0;
        const distance = 900;
        const timer = setInterval(() => {
          if (!document.documentElement) {
            clearInterval(timer);
            resolve();
            return;
          }
          const { scrollHeight } = document.documentElement;
          window.scrollBy(0, distance);
          total += distance;
          if (total >= scrollHeight || total > 12000) {
            clearInterval(timer);
            window.scrollTo(0, 0);
            resolve();
          }
        }, 40);
      });
    });
  }
}
