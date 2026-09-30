import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const imagePath = process.env.RECEIPT_TEST_IMAGE;
const outputPath = process.env.RECEIPT_OCR_OUTPUT;
const limit = Number(process.env.RECEIPT_OCR_LIMIT || 10);
if (!imagePath) throw new Error("RECEIPT_TEST_IMAGE is required");
const baseUrl = process.env.TEST_BASE_URL || "http://localhost:5151";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(600000);
  await page.goto(`${baseUrl}/`);
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.id = "ocrTestFile";
    document.body.appendChild(input);
  });
  await page.locator("#ocrTestFile").setInputFiles(imagePath);
  const results = await page.evaluate(async (receiptLimit) => {
    const file = document.querySelector("#ocrTestFile").files[0];
    const { detectReceipts, releaseReceiptResult } = await import("/js/receipt/ReceiptDetector.js");
    const { analyzeReceiptsSequentially } = await import("/js/receipt/ReceiptOcrService.js");
    const detection = await detectReceipts(file);
    try {
      if (detection.receipts.length !== 10) throw new Error(`Expected 10 receipts, got ${detection.receipts.length}`);
      return await analyzeReceiptsSequentially(detection.receipts.slice(0, receiptLimit));
    } finally {
      releaseReceiptResult(detection);
    }
  }, limit);
  const compact = results.map((result) => ({
    receiptIndex: result.receiptIndex,
    items: result.items,
    reason: result.reason,
    rawText: result.rawText,
    table: result.table,
    processedSize: result.processedSize,
  }));
  if (outputPath) await writeFile(outputPath, JSON.stringify(results, null, 2), "utf8");
  console.log(JSON.stringify(compact, null, 2));
} finally {
  await browser.close();
}
