import { chromium } from "playwright";

const imagePath = process.env.RECEIPT_TEST_IMAGE;
if (!imagePath) throw new Error("RECEIPT_TEST_IMAGE is required");
const baseUrl = process.env.TEST_BASE_URL || "http://localhost:5151";
const receiptIndexes = String(process.env.RECEIPT_OCR_INDEXES || "3,5,8,9").split(",").map(Number);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(600000);
  await page.goto(`${baseUrl}/`);
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.id = "ocrComparisonFile";
    document.body.appendChild(input);
  });
  await page.locator("#ocrComparisonFile").setInputFiles(imagePath);
  const comparison = await page.evaluate(async ({ indexes }) => {
    const file = document.querySelector("#ocrComparisonFile").files[0];
    const { detectReceipts, releaseReceiptResult } = await import("/js/receipt/ReceiptDetector.js");
    const { createReceiptOcrSession } = await import("/js/receipt/ReceiptOcrService.js");
    const detection = await detectReceipts(file);
    const session = await createReceiptOcrSession();
    try {
      const output = [];
      for (const receiptIndex of indexes) {
        const receipt = detection.receipts[receiptIndex - 1];
        for (const variant of ["contrast", "sharpen", "adaptive"]) {
          const result = await session.analyze(receipt.ocrBlob || receipt.blob, { variant });
          output.push({ receiptIndex, variant, rawText: result.rawText, items: result.items });
        }
      }
      return output;
    } finally {
      await session.terminate();
      releaseReceiptResult(detection);
    }
  }, { indexes: receiptIndexes });
  console.log(JSON.stringify(comparison, null, 2));
} finally {
  await browser.close();
}
