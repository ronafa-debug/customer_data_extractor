import { chromium } from "playwright";

const imagePath = process.env.RECEIPT_TEST_IMAGE;
const debugOutputPath = process.env.RECEIPT_DEBUG_OUTPUT;
const screenshotOutputPath = process.env.RECEIPT_SCREENSHOT_OUTPUT;
if (!imagePath) throw new Error("RECEIPT_TEST_IMAGE is required");
const baseUrl = process.env.TEST_BASE_URL || "http://localhost:5151";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${baseUrl}/?debug=1&skipOcr=1#/new-price`);
  await page.locator("#receiptFileInput").setInputFiles(imagePath);
  await page.waitForFunction(() => {
    const text = document.querySelector("#receiptAlert")?.textContent || "";
    return text.includes("장을 찾았습니다") || text.includes("찾지 못했습니다") || text.includes("처리하지 못했습니다");
  }, null, { timeout: 60000 });
  const message = await page.locator("#receiptAlert").innerText();
  const count = await page.locator(".receipt-card").count();
  if (message !== "영수증 10장을 찾았습니다." || count !== 10) {
    throw new Error(`Expected 10 receipts, got ${count}: ${message}`);
  }
  const labels = await page.locator(".receipt-card figcaption").allTextContents();
  const expectedLabels = Array.from({ length: 10 }, (_, index) => `영수증 ${index + 1}`);
  if (JSON.stringify(labels) !== JSON.stringify(expectedLabels)) {
    throw new Error(`Unexpected receipt order: ${JSON.stringify(labels)}`);
  }
  const unloadedImages = await page.locator(".receipt-card img").evaluateAll(
    (images) => images.filter((image) => !image.complete || image.naturalWidth === 0).length
  );
  if (unloadedImages) throw new Error(`${unloadedImages} receipt previews failed to load`);
  const diagnostics = await page.locator("#receiptDiagnostics").textContent();
  const debugUrl = await page.locator("#receiptDebugImage").getAttribute("src");
  if (debugUrl && debugOutputPath) {
    const data = await page.evaluate(async (url) => Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())), debugUrl);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(debugOutputPath, Buffer.from(data));
  }
  if (screenshotOutputPath) await page.screenshot({ path: screenshotOutputPath, fullPage: true });
  console.log(JSON.stringify({ message, count, diagnostics: JSON.parse(diagnostics || "{}") }, null, 2));
} finally {
  await browser.close();
}
