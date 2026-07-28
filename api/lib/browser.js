/**
 * Playwright 브라우저 런처 (로컬 / Vercel)
 * 로컬에서는 브라우저 인스턴스를 재사용해 콜드스타트를 줄인다.
 */
import path from "node:path";

/** @type {import('playwright').Browser | import('playwright-core').Browser | null} */
let sharedLocalBrowser = null;

function isServerless() {
  return Boolean(
    process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
  );
}

/**
 * @returns {Promise<import('playwright').Browser | import('playwright-core').Browser>}
 */
export async function launchBrowser() {
  if (!isServerless()) {
    if (sharedLocalBrowser?.isConnected?.()) {
      return sharedLocalBrowser;
    }
    try {
      const { chromium } = await import("playwright");
      sharedLocalBrowser = await chromium.launch({ headless: true });
      sharedLocalBrowser.on("disconnected", () => {
        sharedLocalBrowser = null;
      });
      return sharedLocalBrowser;
    } catch (err) {
      console.error("[browser] local playwright fallback:", err);
    }
  }

  // Vercel / Lambda: @sparticuz/chromium
  // https://github.com/Sparticuz/chromium
  const { chromium: playwrightChromium } = await import("playwright-core");
  const chromium = (await import("@sparticuz/chromium")).default;

  if (typeof chromium.setGraphicsMode === "function") {
    chromium.setGraphicsMode(false);
  }

  const executablePath = await chromium.executablePath();
  const execDir = path.dirname(executablePath);
  // libnspr4 등 공유 라이브러리 경로 (Vercel Linux)
  const prevLd = process.env.LD_LIBRARY_PATH || "";
  process.env.LD_LIBRARY_PATH = prevLd
    ? `${execDir}:${prevLd}`
    : execDir;

  return playwrightChromium.launch({
    args: chromium.args,
    executablePath,
    headless: true,
  });
}

/**
 * 서버리스에서는 매 요청 후 닫고, 로컬 공유 브라우저는 유지한다.
 * @param {import('playwright').Browser | import('playwright-core').Browser | null | undefined} browser
 */
export async function releaseBrowser(browser) {
  if (!browser) return;
  if (isServerless()) {
    try {
      await browser.close();
    } catch (err) {
      console.error("[browser] close:", err);
    }
    return;
  }
  // 로컬 공유 인스턴스는 닫지 않음
}
