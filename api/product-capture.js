/**
 * POST /api/product-capture
 * Playwright로 상품 페이지를 캡처하고 4종 PNG를 반환한다.
 * 실패 슬롯은 status:"error" 와 error 사유를 포함한다.
 */
import { launchBrowser, releaseBrowser } from "./lib/browser.js";
import { detect } from "./lib/product/ProductParserFactory.js";
import {
  sanitizeProductName,
  buildSpecPackageMainImage,
  looksLikePolicyBanner,
  scorePackageShot,
  toSquarePng,
  resizeToWidth,
  centerOnWhiteCanvas,
  toBase64,
} from "./lib/images.js";

/** Vercel Serverless 설정 */
export const config = {
  maxDuration: 60,
  memory: 1024,
};

/** @typedef {{
 *   id: string,
 *   label: string,
 *   filename: string,
 *   status: 'success' | 'error',
 *   error?: string,
 *   mimeType?: string,
 *   dataBase64?: string,
 *   width?: number,
 *   height?: number
 * }} ImageSlot */

/**
 * @param {string} id
 * @param {string} label
 * @param {string} filename
 * @param {string} error
 * @returns {ImageSlot}
 */
function errorSlot(id, label, filename, error) {
  return { id, label, filename, status: "error", error };
}

/**
 * @param {import('@vercel/node').VercelRequest} req
 * @param {import('@vercel/node').VercelResponse} res
 */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ success: false, message: "Method Not Allowed" });
    return;
  }

  const url = String(req.body?.url || "").trim();
  if (!url) {
    res.status(400).json({ success: false, message: "URL을 입력해주세요." });
    return;
  }

  let browser;
  /** @type {import('playwright-core').Page | undefined} */
  let page;
  try {
    // eslint-disable-next-line no-new
    new URL(url);
  } catch {
    res.status(400).json({ success: false, message: "올바른 URL 형식이 아닙니다." });
    return;
  }

  try {
    const parser = detect(url);
    browser = await launchBrowser();
    const fast = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
    page = await browser.newPage({
      viewport: fast
        ? { width: 390, height: 844 }
        : { width: 1280, height: 1800 },
      userAgent:
        "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    });

    const product = await parser.parse(page, url);
    const productName = sanitizeProductName(product.name);

    /** @type {ImageSlot[]} */
    const images = [];

    // —— 1) 대표이미지 (제품 스펙 총정리 영역) ——
    let mainPng = null;
    const mainFilename = `${productName} - 대표이미지.png`;
    if (!product.mainImageLocator && !(product.mainImageSrcCandidates || []).length) {
      images.push(
        errorSlot(
          "main",
          "대표이미지",
          mainFilename,
          product.mainImageError ||
            "'제품 스펙 총정리' 영역의 제품이미지를 찾지 못했습니다."
        )
      );
    } else {
      try {
        if (typeof parser.dismissOverlays === "function") {
          await parser.dismissOverlays(page);
        }

        /** @type {string[]} */
        const srcList = [];
        const rejectSrc =
          /buyer-inform|\/editor\/policy\/|\/policy\/|frozenproductnotice|copyright|lowprice|\/common\//i;
        const preferSrc = /imgmono\.godohosting\.com\/emono\/product\//i;
        const fromCandidates = product.mainImageSrcCandidates || [];
        for (const s of fromCandidates) {
          if (!s || !/^https?:/i.test(s) || rejectSrc.test(s)) continue;
          if (!srcList.includes(s)) srcList.push(s);
        }
        if (product.mainImageLocator) {
          const locSrc = await product.mainImageLocator
            .evaluate((el) => el.currentSrc || el.src || "")
            .catch(() => "");
          if (
            locSrc &&
            /^https?:/i.test(locSrc) &&
            !rejectSrc.test(locSrc) &&
            !srcList.includes(locSrc)
          ) {
            // 상품컷이면 맨 앞, 아니면 맨 뒤
            if (preferSrc.test(locSrc)) srcList.unshift(locSrc);
            else srcList.push(locSrc);
          }
        }
        // 상품 CDN 컷을 우선
        srcList.sort((a, b) => {
          const ap = preferSrc.test(a) ? 0 : 1;
          const bp = preferSrc.test(b) ? 0 : 1;
          return ap - bp;
        });

        /** @type {Buffer | null} */
        let raw = null;
        let bestScore = -Infinity;
        /** 완제품 포장으로 볼 최소 점수 (소스 그릇·연출컷 배제) */
        const PACKAGE_MIN = 55;
        /** 이 미만이면 음식 연출로 보고 1차 후보에서 제외 */
        const FOOD_MAX = 44;

        /**
         * @param {string} src
         * @returns {Promise<{ src: string, buf: Buffer, score: number } | null>}
         */
        async function scoreSrc(src) {
          try {
            if (rejectSrc.test(src)) return null;
            const resp = await page.request.get(src);
            if (!resp.ok()) return null;
            const buf = Buffer.from(await resp.body());
            if (await looksLikePolicyBanner(buf)) {
              console.error("[product-capture] skip policy banner:", src);
              return null;
            }
            const score = await scorePackageShot(buf);
            console.error(
              "[product-capture] candidate score:",
              src.split("/").pop(),
              score
            );
            if (score <= FOOD_MAX) {
              console.error(
                "[product-capture] skip food/low package:",
                src.split("/").pop(),
                score
              );
              return null;
            }
            return { src, buf, score };
          } catch (fetchErr) {
            console.error("[product-capture] candidate fetch:", src, fetchErr);
            return null;
          }
        }

        // DOM 역순(스펙 포장컷 우선). Vercel은 상위 5, 로컬은 상위 8 점수
        const firstBatch = srcList.slice(0, fast ? 5 : 8);
        const scored = await Promise.all(firstBatch.map(scoreSrc));

        for (const item of scored) {
          if (!item) continue;
          if (item.score > bestScore) {
            bestScore = item.score;
            raw = item.buf;
          }
        }

        if ((!raw || bestScore < PACKAGE_MIN) && srcList.length > firstBatch.length) {
          for (const src of srcList.slice(firstBatch.length)) {
            const item = await scoreSrc(src);
            if (!item) continue;
            if (item.score > bestScore) {
              bestScore = item.score;
              raw = item.buf;
            }
            if (bestScore >= 85) break;
          }
        }

        // 음식 연출만 있어서 전부 skip된 경우: 감점만 적용해 최고점 재탐색
        if (!raw && srcList.length) {
          for (const src of srcList.slice(0, fast ? 6 : 12)) {
            try {
              if (rejectSrc.test(src)) continue;
              const resp = await page.request.get(src);
              if (!resp.ok()) continue;
              const buf = Buffer.from(await resp.body());
              if (await looksLikePolicyBanner(buf)) continue;
              const score = await scorePackageShot(buf);
              if (score > bestScore) {
                bestScore = score;
                raw = buf;
              }
            } catch {
              /* next */
            }
          }
          if (raw && bestScore < 35) {
            console.error(
              "[product-capture] weak package score, still using best:",
              bestScore
            );
          }
        }

        if (!raw && product.mainImageLocator) {
          await product.mainImageLocator.evaluate((el) => {
            el.style.setProperty("display", "block", "important");
            el.style.setProperty("visibility", "visible", "important");
            el.style.setProperty("opacity", "1", "important");
            el.scrollIntoView({ block: "center", inline: "nearest" });
          });
          await new Promise((r) => setTimeout(r, 100));
          if (typeof parser.dismissOverlays === "function") {
            await parser.dismissOverlays(page);
          }
          raw = await product.mainImageLocator.screenshot({
            type: "png",
            timeout: 8000,
          });
          if (await looksLikePolicyBanner(raw)) {
            throw new Error(
              "교환/환불 안내 이미지가 선택되어 대표이미지로 사용할 수 없습니다."
            );
          }
          const locScore = await scorePackageShot(raw);
          if (locScore <= FOOD_MAX) {
            throw new Error(
              "음식 연출컷만 있어 완제품 포장 대표이미지를 찾지 못했습니다."
            );
          }
        }

        if (!raw) {
          throw new Error("'제품 스펙 총정리' 제품이미지를 찾지 못했습니다.");
        }

        mainPng = await buildSpecPackageMainImage(raw);
        images.push({
          id: "main",
          label: "대표이미지",
          filename: mainFilename,
          status: "success",
          mimeType: "image/png",
          dataBase64: toBase64(mainPng),
          width: 1000,
          height: 1000,
        });
      } catch (err) {
        console.error("[product-capture] main image:", err);
        images.push(
          errorSlot(
            "main",
            "대표이미지",
            mainFilename,
            `대표이미지 캡처에 실패했습니다. (${err?.message || "unknown"})`
          )
        );
      }
    }

    // —— 2) 상세페이지1 (대표 리사이즈) ——
    const detail1Filename = `${productName}1 - 상세페이지.png`;
    if (!mainPng) {
      images.push(
        errorSlot(
          "detail1",
          "상세페이지1",
          detail1Filename,
          "대표이미지가 생성되지 않아 상세페이지1을 만들 수 없습니다."
        )
      );
    } else {
      try {
        const detail1 = await toSquarePng(mainPng, 860);
        images.push({
          id: "detail1",
          label: "상세페이지1",
          filename: detail1Filename,
          status: "success",
          mimeType: "image/png",
          dataBase64: toBase64(detail1),
          width: 860,
          height: 860,
        });
      } catch (err) {
        console.error("[product-capture] detail1:", err);
        images.push(
          errorSlot(
            "detail1",
            "상세페이지1",
            detail1Filename,
            `상세페이지1 리사이즈에 실패했습니다. (${err?.message || "unknown"})`
          )
        );
      }
    }

    // —— 3) 상세페이지2 (상품필수 정보) ——
    let infoPng = null;
    let infoMeta = { width: 860, height: 860 };
    const detail2Filename = `${productName}2 - 상세페이지.png`;
    if (!product.informationLocator) {
      images.push(
        errorSlot(
          "detail2",
          "상세페이지2",
          detail2Filename,
          product.informationError ||
            "'상품필수 정보' 영역을 찾지 못했습니다."
        )
      );
    } else {
      try {
        if (typeof parser.dismissOverlays === "function") {
          await parser.dismissOverlays(page);
        }
        const loc = product.informationLocator;
        await loc.evaluate((el) => {
          el.scrollIntoView({ block: "center", inline: "nearest" });
        });
        await new Promise((r) => setTimeout(r, 100));
        const rawInfo = await loc.screenshot({ type: "png" });
        const resized = await resizeToWidth(rawInfo, 860);
        infoPng = resized.buffer;
        infoMeta = { width: resized.width, height: resized.height };
        images.push({
          id: "detail2",
          label: "상세페이지2",
          filename: detail2Filename,
          status: "success",
          mimeType: "image/png",
          dataBase64: toBase64(infoPng),
          width: infoMeta.width,
          height: infoMeta.height,
        });
      } catch (err) {
        console.error("[product-capture] info section:", err);
        images.push(
          errorSlot(
            "detail2",
            "상세페이지2",
            detail2Filename,
            `상품필수 정보 캡처에 실패했습니다. (${err?.message || "unknown"})`
          )
        );
      }
    }

    // —— 4) 추가이미지 (필수정보 중앙 배치) ——
    const extraFilename = `${productName} - 추가이미지.png`;
    if (!infoPng) {
      images.push(
        errorSlot(
          "extra",
          "추가이미지",
          extraFilename,
          "상세페이지2가 생성되지 않아 추가이미지를 만들 수 없습니다."
        )
      );
    } else {
      try {
        const extra = await centerOnWhiteCanvas(infoPng, 1000);
        images.push({
          id: "extra",
          label: "추가이미지",
          filename: extraFilename,
          status: "success",
          mimeType: "image/png",
          dataBase64: toBase64(extra),
          width: 1000,
          height: 1000,
        });
      } catch (err) {
        console.error("[product-capture] extra:", err);
        images.push(
          errorSlot(
            "extra",
            "추가이미지",
            extraFilename,
            `추가이미지 생성에 실패했습니다. (${err?.message || "unknown"})`
          )
        );
      }
    }

    const successCount = images.filter((i) => i.status === "success").length;
    if (successCount === 0) {
      res.status(422).json({
        success: false,
        message: "상품 정보를 찾을 수 없습니다.",
        productName,
        images,
      });
      return;
    }

    res.status(200).json({
      success: true,
      productName,
      images,
      successCount,
      totalCount: 4,
    });
  } catch (err) {
    console.error("[product-capture]", err);
    const message = err?.message || "이미지 생성에 실패했습니다.";
    const isTimeout = /timeout|Timeout|exceeded/i.test(message);
    const status = message.includes("지원하지 않는")
      ? 400
      : message.includes("불러올 수 없")
        ? 502
        : isTimeout
          ? 504
          : 500;
    res.status(status).json({
      success: false,
      message: isTimeout
        ? "서버 처리 시간이 초과되었습니다. 잠시 후 다시 시도해주세요."
        : /지원하지 않는|상품 정보|URL/.test(message)
          ? message
          : "이미지 생성에 실패했습니다.",
    });
  } finally {
    if (page) {
      try {
        await page.close();
      } catch (err) {
        console.error("[product-capture] page.close:", err);
      }
    }
    await releaseBrowser(browser);
  }
}
