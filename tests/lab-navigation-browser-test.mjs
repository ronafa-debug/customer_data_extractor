import { chromium } from "playwright";

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:5151";
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${baseUrl}/#/`, { waitUntil: "networkidle" });

  const homeCards = await page.locator(".tool-grid .tool-card-title").allTextContents();
  if (homeCards.join(",") !== "주문내역 고객정보 추출기,제품 정보 추출기,제품가격관리") {
    throw new Error(`unexpected stable tools: ${homeCards.join(",")}`);
  }
  if (await page.locator(".tool-grid", { hasText: "OCR-제품가격관리" }).count()) {
    throw new Error("OCR product price manager is exposed in the main tool grid");
  }
  if (await page.getByText("(구)제품가격관리", { exact: true }).count()) {
    throw new Error("legacy product price manager label remains on home");
  }

  const labEntry = page.getByRole("button", { name: "🧪 실험실" });
  await labEntry.click();
  await page.waitForURL(/#\/lab$/);
  await page.getByRole("heading", { name: "🧪 실험실" }).waitFor();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "🧪 실험실" }).waitFor();

  const labCard = page.locator(".lab-card", { hasText: "OCR-제품가격관리" });
  if ((await labCard.count()) !== 1) throw new Error("OCR product price manager lab card is missing");
  await labCard.getByRole("button", { name: "실행하기" }).click();
  await page.waitForURL(/#\/new-price$/);
  await page.locator("#receiptFileInput").waitFor({ state: "attached" });
  await page.waitForFunction(() => document.title.startsWith("OCR-제품가격관리 ·"));
  if (!((await page.title()).startsWith("OCR-제품가격관리 ·"))) {
    throw new Error(`unexpected OCR document title: ${await page.title()}`);
  }

  await page.goBack({ waitUntil: "networkidle" });
  await page.waitForURL(/#\/lab$/);
  await page.getByRole("button", { name: "← 메인으로" }).click();
  await page.waitForURL(/#\/$/);

  await page.getByRole("button", { name: /제품가격관리/ }).click();
  await page.waitForURL(/#\/price$/);
  await page.getByRole("heading", { name: "제품가격관리" }).waitFor();
  if (!((await page.title()).startsWith("제품가격관리 ·"))) {
    throw new Error(`unexpected product price document title: ${await page.title()}`);
  }

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${baseUrl}/#/`, { waitUntil: "networkidle" });
  if (!(await labEntry.isVisible())) throw new Error("lab entry is not visible on mobile");
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  if (hasHorizontalOverflow) throw new Error("home has horizontal overflow on mobile");

  console.log("lab navigation browser test: home/lab/OCR/price/history/mobile passed");
} finally {
  await browser.close();
}
