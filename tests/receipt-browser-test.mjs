import { chromium } from "playwright";

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:5151";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${baseUrl}/?skipOcr=1#/new-price`);
  await page.waitForSelector("#receiptFileInput", { state: "attached" });

  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["not an image"], "invalid.txt", { type: "text/plain" }));
    const input = document.querySelector("#receiptFileInput");
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelector("#receiptAlert")?.textContent?.includes("이미지 파일을 선택"));

  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1400;
    canvas.height = 900;
    const context = canvas.getContext("2d");
    context.fillStyle = "#a9a9a9";
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let row = 0; row < 2; row += 1) {
      for (let column = 0; column < 5; column += 1) {
        const x = 155 + column * 270;
        const y = 225 + row * 440;
        const angle = ((column % 3) - 1) * 0.025;
        context.save();
        context.translate(x, y);
        context.rotate(angle);
        context.fillStyle = "#fafafa";
        context.fillRect(-92, -165, 184, 330);
        context.fillStyle = "#555";
        for (let line = -120; line <= 120; line += 24) {
          context.fillRect(-65, line, 120 - (line % 3) * 8, 4);
        }
        context.restore();
      }
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const file = new File([blob], "synthetic-10-receipts.png", { type: "image/png" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.querySelector("#receiptFileInput");
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await page.waitForFunction(() => document.querySelector("#receiptAlert")?.textContent?.includes("영수증 10장을 찾았습니다"), null, { timeout: 30000 });
  const cards = await page.locator(".receipt-card").count();
  const labels = await page.locator(".receipt-card figcaption").allTextContents();
  const imageWidths = await page.locator(".receipt-card img").evaluateAll((images) => images.map((image) => image.naturalWidth));
  if (cards !== 10) throw new Error(`expected 10 receipt cards, got ${cards}`);
  if (labels.join(",") !== Array.from({ length: 10 }, (_, index) => `영수증 ${index + 1}`).join(",")) throw new Error("receipt order labels are invalid");
  if (imageWidths.some((width) => width <= 0)) throw new Error("one or more perspective crops failed to load");

  await page.goto(`${baseUrl}/#/`);
  const homeText = await page.locator("body").innerText();
  if (!homeText.includes("제품가격관리") || !homeText.includes("🧪 실험실")) throw new Error("home stable tool or lab entry is missing");
  if (homeText.includes("OCR-제품가격관리") || homeText.includes("(구)제품가격관리") || homeText.includes("(신)제품가격관리")) {
    throw new Error("experimental or legacy product price label is exposed on home");
  }
  console.log(`receipt browser test: ${cards} crops, route/upload/preview/order passed`);
} finally {
  await browser.close();
}
