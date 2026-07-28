/**
 * 모노마트 상품 페이지 Parser (Playwright)
 */
import { BaseProductParser } from "./BaseProductParser.js";

const NAME_SELECTORS = [
  ".item_detail_tit h3",
  ".goods_name",
  ".item_name",
  ".product-name",
  "h1",
  "meta[property='og:title']",
];

/** 상세 본문에서 제외할 공통·정책·CS 이미지 */
const EXCLUDED_DETAIL_IMG =
  /frozenproductnotice|copyright|lowprice|ft_logo|loading\.gif|icon_chat|placeholder|1x1|blank|buyer-inform|\/policy\/|editor\/policy|교환|환불|customer|cs_center|notice\.jpg|deliveryinfo|shippinginfo/i;

/** 상품 상세컷(스펙/레시피 등)으로 보이는 경로 */
const PRODUCT_DETAIL_PATH =
  /imgmono\.godohosting\.com\/emono\/product\//i;

export class MonomartParser extends BaseProductParser {
  get mallId() {
    return "monomart";
  }

  /**
   * @param {string} url
   * @returns {boolean}
   */
  canParse(url) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host.includes("monomart");
    } catch {
      return false;
    }
  }

  /**
   * @param {import('playwright-core').Page} page
   * @param {string} url
   */
  async parse(page, url) {
    const fast = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

    // 분석/광고만 차단 (이미지·스크립트는 유지해 DOM 파싱이 깨지지 않게)
    await page
      .route("**/*", (route) => {
        const u = route.request().url();
        const type = route.request().resourceType();
        if (type === "media" || type === "font") return route.abort();
        if (
          /google-analytics|googletagmanager|gtag\/js|doubleclick|adservice|hotjar|clarity\.ms/i.test(
            u
          )
        ) {
          return route.abort();
        }
        return route.continue();
      })
      .catch(() => {});

    // Vercel은 콜드스타트+Chromium으로 시간이 촉박 → domcontentloaded로 단축
    await page.goto(url, {
      waitUntil: fast ? "domcontentloaded" : "load",
      timeout: fast ? 22000 : 35000,
    });
    await page.waitForSelector("body", { timeout: 5000 }).catch(() => {});
    await page
      .waitForSelector(
        ".item_detail_tit, .goods_name, .js_goods_detail_infotext, .view_box0",
        { timeout: fast ? 7000 : 10000 }
      )
      .catch(() => {});
    await new Promise((r) => setTimeout(r, fast ? 100 : 200));

    await this.dismissOverlays(page);

    // 전체 페이지 스크롤은 로컬에서만 — 서버리스는 상세 영역 스크롤만으로 충분
    if (!fast) {
      try {
        await this.scrollToBottom(page);
      } catch (err) {
        console.error("[MonomartParser] scroll retry:", err?.message);
        await page.waitForLoadState("load").catch(() => {});
        await new Promise((r) => setTimeout(r, 400));
        await this.scrollToBottom(page).catch(() => {});
      }
      await this.dismissOverlays(page);
    }

    const name = await this.#extractName(page);
    const { locator: mainImageLocator, candidates: mainImageSrcCandidates } =
      await this.#findSpecProductImage(page);

    const informationLocator = await this.#findInformationSection(page);

    if (!mainImageLocator && !informationLocator) {
      throw new Error("상품 정보를 찾을 수 없습니다.");
    }

    return {
      name: name || "상품",
      mainImageLocator,
      mainImageSrcCandidates: mainImageSrcCandidates || [],
      informationLocator,
      mainImageError: mainImageLocator
        ? null
        : "'제품 스펙 총정리' 영역의 제품이미지를 찾지 못했습니다.",
      informationError: informationLocator
        ? null
        : "'상품필수 정보' 영역을 찾지 못했습니다.",
    };
  }

  /**
   * 팝업·채팅·딤드 레이어를 닫거나 DOM에서 제거한다.
   * @param {import('playwright-core').Page} page
   */
  async dismissOverlays(page) {
    await page.evaluate(() => {
      if (!document.body) return;

      const kill = (el) => {
        if (!el) return;
        try {
          el.remove();
        } catch {
          try {
            el.style.setProperty("display", "none", "important");
            el.style.setProperty("visibility", "hidden", "important");
            el.style.setProperty("pointer-events", "none", "important");
          } catch {
            /* ignore */
          }
        }
      };

      document
        .querySelectorAll(
          "#_NBCHATLAYOUT, iframe[id*='automsg'], iframe[class*='richpopup'], iframe[class*='ames-']"
        )
        .forEach(kill);

      document
        .querySelectorAll(
          "iframe, [class*='popup'], [class*='layer'], [id*='popup'], [id*='layer'], [class*='modal']"
        )
        .forEach((el) => {
          const style = window.getComputedStyle(el);
          const z = parseInt(style.zIndex || "0", 10);
          const idc = `${el.id} ${el.className}`;
          const rect = el.getBoundingClientRect();
          const fixed =
            style.position === "fixed" || style.position === "sticky";
          if (
            (fixed || z >= 9000 || /automsg|richpopup|nbchat|ames-/i.test(idc)) &&
            rect.width > 40 &&
            rect.height > 40
          ) {
            kill(el);
          }
        });

      document
        .querySelectorAll(".dim, .dimmed, .backdrop, .modal-backdrop, .bg_dim")
        .forEach(kill);

      if (document.documentElement) {
        document.documentElement.style.overflow = "auto";
      }
      if (document.body) {
        document.body.style.overflow = "auto";
      }
    }).catch(() => {});
  }

  /**
   * @param {import('playwright-core').Page} page
   * @returns {Promise<string>}
   */
  async #extractName(page) {
    const preferred = [
      ".item_detail_tit h3",
      ".detail_info_top .item_detail_tit",
      ".goods_name",
      ".item_name",
      ".product-name",
      "meta[property='og:title']",
    ];
    for (const selector of preferred) {
      try {
        if (selector.startsWith("meta")) {
          const content = await page
            .locator(selector)
            .first()
            .getAttribute("content");
          if (content?.trim()) {
            return content
              .replace(/\s*[|\-–].*$/, "")
              .replace(/^옵션선택\s*/g, "")
              .trim();
          }
          continue;
        }
        const text = await page
          .locator(selector)
          .first()
          .textContent({ timeout: 1500 });
        const cleaned = text?.trim().replace(/\s+/g, " ") || "";
        if (!cleaned) continue;
        if (/^(옵션선택|바로구매|장바구니|공유하기|찜하기)$/.test(cleaned)) {
          continue;
        }
        return cleaned;
      } catch {
        /* try next */
      }
    }
    const title = await page.title();
    return (
      title
        .replace(/\s*[|\-–].*$/, "")
        .replace(/^옵션선택\s*/g, "")
        .trim() || "상품"
    );
  }

  /**
   * 페이지 중간 '제품 스펙 총정리' 영역의 제품이미지를 찾는다.
   * 대표이미지는 emono/product 상품컷만 사용한다. (정책·CS·관련상품 제외)
   * @param {import('playwright-core').Page} page
   * @returns {Promise<{ locator: import('playwright-core').Locator | null, candidates: string[] }>}
   */
  async #findSpecProductImage(page) {
    /** @type {string[]} */
    let candidates = [];

    const detailRoots = [
      ".js_goods_detail_infotext",
      ".view_box0",
      ".txt-manual",
      ".goods_description",
      "body",
    ];

    for (const rootSel of detailRoots) {
      const root = page.locator(rootSel).first();
      if ((await root.count()) === 0) continue;

      await root.scrollIntoViewIfNeeded().catch(() => {});

      // lazy src 강제 + 빠른 내부 스크롤 (mouse.wheel 반복보다 짧음)
      const fast = Boolean(
        process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
      );
      await root.evaluate(
        async (el, opts) => {
          const imgs = [...el.querySelectorAll("img")];
          for (const img of imgs) {
            const ds =
              img.getAttribute("data-src") ||
              img.getAttribute("data-original") ||
              img.getAttribute("data-lazy") ||
              img.getAttribute("data-lazy-src");
            if (ds && (!img.src || img.src.startsWith("data:"))) {
              img.src = ds;
            }
            img.loading = "eager";
            img.classList.remove("gd_image_lazy");
          }

          const maxY = Math.min(
            (el.scrollHeight || document.body.scrollHeight) + 400,
            opts.fast ? 4500 : 8000
          );
          const step = opts.fast ? 900 : 700;
          const pause = opts.fast ? 15 : 25;
          for (let y = 0; y < maxY; y += step) {
            window.scrollTo(0, y);
            await new Promise((r) => setTimeout(r, pause));
          }
          el.scrollIntoView({ block: "start", inline: "nearest" });

          const waitMs = opts.fast ? 500 : 900;
          await Promise.all(
            imgs.slice(0, opts.fast ? 16 : 24).map(
              (img) =>
                new Promise((resolve) => {
                  if (img.complete && img.naturalWidth > 0) {
                    resolve();
                    return;
                  }
                  img.onload = () => resolve();
                  img.onerror = () => resolve();
                  setTimeout(resolve, waitMs);
                })
            )
          );
        },
        { fast }
      );

      await new Promise((r) => setTimeout(r, fast ? 50 : 100));

      const rankedSrcs = await root.evaluate(
        (el, opts) => {
          const excluded = new RegExp(opts.excluded, "i");
          const productPath = new RegExp(opts.productPath, "i");

          /** @type {{ src: string, w: number, h: number, idx: number }[]} */
          const list = [];
          [...el.querySelectorAll("img")].forEach((img, idx) => {
            const src = img.currentSrc || img.src || "";
            if (!src || excluded.test(src) || src.startsWith("data:")) return;
            // 대표이미지는 상품 상세컷 CDN만 허용
            if (!productPath.test(src)) return;
            if (/\/common\//i.test(src)) return;
            if (/\/editor\//i.test(src)) return;
            if (/buyer-inform|\/policy\//i.test(src)) return;

            const w = img.naturalWidth || 0;
            const h = img.naturalHeight || 0;
            if (w < 400 || h < 400) return;
            // 극단적으로 긴 안내/정책성 배너 제외
            if (h / w > 3.6) return;
            list.push({ src, w, h, idx });
          });

          if (!list.length) return [];

          // DOM 순서상 뒤쪽 상품컷 = '제품 스펙 총정리' 포장컷인 경우가 많음
          list.sort((a, b) => b.idx - a.idx);
          return list.map((c) => c.src);
        },
        {
          excluded: EXCLUDED_DETAIL_IMG.source,
          productPath: PRODUCT_DETAIL_PATH.source,
        }
      );

      if (rankedSrcs?.length) {
        candidates = rankedSrcs;
        const loc = await this.#locatorForSrc(page, rankedSrcs[0], root);
        return { locator: loc, candidates };
      }
    }

    return { locator: null, candidates };
  }

  /**
   * src로 이미지 Locator를 찾고, 보이도록 강제한다.
   * @param {import('playwright-core').Page} page
   * @param {string} src
   * @param {import('playwright-core').Locator} [root]
   */
  async #locatorForSrc(page, src, root) {
    const scope = root || page.locator("body");
    const all = scope.locator("img");
    const n = await all.count();
    for (let i = 0; i < n; i++) {
      const img = all.nth(i);
      const cur = await img.evaluate((e) => e.currentSrc || e.src || "");
      if (cur !== src && !cur.includes(src.split("/").pop() || "___")) continue;

      await img.evaluate((el) => {
        el.style.setProperty("display", "block", "important");
        el.style.setProperty("visibility", "visible", "important");
        el.style.setProperty("opacity", "1", "important");
        el.scrollIntoView({ block: "center", inline: "nearest" });
      });
      await new Promise((r) => setTimeout(r, 50));

      // 로드 대기
      try {
        await img.evaluate(async (el) => {
          if (el.complete && el.naturalWidth > 0) return;
          await new Promise((resolve, reject) => {
            el.onload = () => resolve();
            el.onerror = () => reject(new Error("img load fail"));
            setTimeout(resolve, 1200);
          });
        });
      } catch {
        /* continue with whatever we have */
      }

      const box = await img.boundingBox().catch(() => null);
      if (box && box.width >= 40 && box.height >= 40) {
        return img;
      }

      // boundingBox 실패 시에도 evaluate screenshot clip용으로 반환
      const size = await img.evaluate((el) => ({
        w: el.naturalWidth,
        h: el.naturalHeight,
      }));
      if (size.w >= 280 && size.h >= 280) {
        return img;
      }
    }
    return null;
  }

  /**
   * "상품필수 정보" 섹션을 열고 캡처용 핸들을 반환한다.
   * @param {import('playwright-core').Page} page
   */
  async #findInformationSection(page) {
    await this.dismissOverlays(page);

    const header = page
      .locator(".openblock_header", { hasText: /상품\s*필수\s*정보/ })
      .first();

    const hasHeader = (await header.count()) > 0;
    if (!hasHeader) {
      const heading = page.getByRole("heading", { name: /상품\s*필수\s*정보/ }).first();
      if ((await heading.count()) === 0) {
        const textNode = page.getByText(/상품\s*필수\s*정보/).first();
        if ((await textNode.count()) === 0) return null;
        await textNode.scrollIntoViewIfNeeded().catch(() => {});
        const handle = await textNode.evaluateHandle((el) => {
          return (
            el.closest(".openblock, .js_openblock, .js_goods_info") ||
            el.parentElement
          );
        });
        return handle.asElement();
      }
    }

    await header.scrollIntoViewIfNeeded().catch(() => {});

    try {
      const expanded = await header.evaluate((el) => {
        const box = el.closest(".openblock, .js_openblock") || el.parentElement;
        const body =
          box?.querySelector(
            ".openblock_cont, .openblock_content, .js_openblock_cont"
          ) || el.nextElementSibling;
        if (!body) return true;
        const style = window.getComputedStyle(body);
        return style.display !== "none" && body.offsetHeight > 40;
      });
      if (!expanded) {
        await header.click({ force: true, timeout: 2000 });
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch {
      await header.click({ force: true }).catch(() => {});
      await new Promise((r) => setTimeout(r, 200));
    }

    await this.dismissOverlays(page);

    const handle = await header.evaluateHandle((el) => {
      return el.closest(".openblock, .js_openblock") || el.parentElement;
    });
    return handle.asElement();
  }
}
