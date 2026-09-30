import { chromium } from "playwright";

const wholesaleFile = process.env.WHOLESALE_TEST_FILE;
if (!wholesaleFile) throw new Error("WHOLESALE_TEST_FILE is required");
const baseUrl = process.env.TEST_BASE_URL || "http://localhost:5151";
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(120000);
  await page.goto(`${baseUrl}/#/price`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("#productDbStatus")?.textContent?.includes("등록되지 않았습니다"));
  await page.locator("#productDbFileInput").setInputFiles(wholesaleFile);
  await page.waitForFunction(() => document.querySelector("#priceAlert")?.textContent?.includes("제품DB 업데이트 완료"));

  const imported = await page.evaluate(() => ({
    count: document.querySelector("#productDbCount")?.textContent || "",
    first: [...document.querySelectorAll("#productDbTableBody tr:first-child td")].map((cell) => cell.textContent || ""),
  }));
  if (Number(imported.count.replace(/\D/g, "")) < 1) throw new Error("no wholesale products were rendered");
  if (imported.first.length !== 7 || imported.first.slice(2, 5).some((value) => !value.includes("원"))) throw new Error("purchase and marketplace prices were not rendered");

  await page.locator("#productDbSearch").fill(imported.first[0].slice(0, 3));
  if (await page.locator("#productDbTableBody tr").count() < 1) throw new Error("product search did not render results");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("#productDbStatus")?.textContent?.includes("파일:"));
  const restoredCount = await page.locator("#productDbCount").textContent();
  if (restoredCount !== imported.count) throw new Error("IndexedDB reload did not restore products");

  const atomic = await page.evaluate(async () => {
    const store = await import("/js/price/productPriceStore.js");
    const parser = await import("/js/price/parseWholesaleWorkbook.js");
    await store.replaceProductPriceDatabase([{ id: "test:replacement", productName: "교체 테스트", specification: "1kg", purchasePrice: 5360 }], { fileName: "test.xlsx" });
    let rejected = false;
    try { parser.parseWholesaleWorkbook({ sheets: [{ name: "bad", data: [["상품명", "가격"]] }] }); } catch (_) { rejected = true; }
    const afterFailure = await store.loadProductPriceDatabase();
    return { rejected, count: afterFailure.products.length, id: afterFailure.products[0]?.id };
  });
  if (!atomic.rejected || atomic.count !== 1 || atomic.id !== "test:replacement") throw new Error("replacement or failed-import preservation failed");
  console.log(`product price browser test: imported ${imported.count}, reload/search/atomic replacement passed`);
} finally {
  await browser.close();
}
