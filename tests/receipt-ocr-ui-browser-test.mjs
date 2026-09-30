import { chromium } from "playwright";

const imagePath = process.env.RECEIPT_TEST_IMAGE;
const screenshotPath = process.env.RECEIPT_OCR_SCREENSHOT;
if (!imagePath) throw new Error("RECEIPT_TEST_IMAGE is required");
const baseUrl = process.env.TEST_BASE_URL || "http://localhost:5151";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(600000);
  await page.goto(`${baseUrl}/?debug=1#/new-price`);
  await page.evaluate(() => {
    window.__receiptStatuses = [];
    const target = document.querySelector("#receiptAlert");
    new MutationObserver(() => window.__receiptStatuses.push(target.textContent || ""))
      .observe(target, { childList: true, subtree: true, characterData: true });
  });
  await page.locator("#receiptFileInput").setInputFiles(imagePath);
  await page.waitForFunction(() => document.querySelector("#receiptAlert")?.textContent?.includes("분석을 완료했습니다"));
  const status = await page.locator("#receiptAlert").innerText();
  const cards = await page.locator(".receipt-card").count();
  const progressWasVisible = await page.evaluate(() => window.__receiptStatuses.some((text) => text.includes("영수증 분석 중")));
  if (cards !== 10) throw new Error(`Expected 10 receipt cards, got ${cards}`);
  if (!progressWasVisible) throw new Error("OCR progress status was not displayed");
  const results = await page.locator(".receipt-card").evaluateAll((nodes) => nodes.map((node, index) => ({
    receiptIndex: index + 1,
    items: [...node.querySelectorAll(".receipt-item-list li")].map((item) => ({
      productName: item.querySelector("span")?.textContent || "",
      price: item.querySelector("b")?.textContent || "",
    })),
    empty: node.querySelector(".receipt-analysis-empty")?.textContent || "",
  })));
  if (results.some((result) => result.items.some((item) => /택배비|배송비/.test(item.productName)))) {
    throw new Error("Shipping fee row was rendered as a product");
  }
  if (screenshotPath) await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(JSON.stringify({ status, cards, progressWasVisible, results }, null, 2));
} finally {
  await browser.close();
}
