import { chromium } from "playwright";

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:5151";
const browser = await chromium.launch({ headless: true });

async function waitRows(page, count) {
  await page.waitForFunction((expected) => document.querySelectorAll("#orderPriceTableBody tr[data-pricing-row]").length === expected, count);
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${baseUrl}/#/price`, { waitUntil: "networkidle" });
  const keys = await page.evaluate(async () => {
    const history = await import("/js/order/services/OrderHistoryStore.js");
    const priceStore = await import("/js/price/productPriceStore.js");
    const mappingService = await import("/js/price/productMappingService.js");
    const mappingStore = await import("/js/price/productMappingStore.js");
    const normalizer = await import("/js/price/productNormalizer.js");
    const model = await import("/js/order/model/StandardOrderRow.js");
    const x = { id: normalizer.makeWholesaleProductId("통합 제품", "1kg"), productName: "통합 제품", specification: "1kg", purchasePrice: 5360 };
    const y = { id: normalizer.makeWholesaleProductId("교체 제품", "2kg"), productName: "교체 제품", specification: "2kg", purchasePrice: 7000 };
    await priceStore.replaceProductPriceDatabase([x, y], { fileName: "seed.xlsx", productCount: 2 });
    const naver = { platform: "naver", displayProductName: "네이버 상품", rawProductName: "네이버 원본", rawOptionName: "N옵션", platformProductId: "100", platformOptionId: "N1", quantity: 2 };
    const coupang = { platform: "coupang", displayProductName: "쿠팡 상품", rawProductName: "쿠팡 원본", rawOptionName: "C옵션", platformProductId: "200", platformOptionId: "C1", quantity: 3 };
    const unmatched = { platform: "coupang", displayProductName: "직접등록 대상", rawProductName: "<img src=x onerror=window.__priceXss=1>", rawOptionName: "U옵션", platformProductId: "300", platformOptionId: "U1", quantity: 4 };
    const stale = { platform: "naver", displayProductName: "연결끊김 상품", rawProductName: "연결끊김 원본", rawOptionName: "S옵션", platformProductId: "400", platformOptionId: "S1", quantity: 1 };
    const customer = [{ name: "테스트", phone: "", address: "", zipcode: "", deliveryMessage: "", products: [] }];
    await history.saveOrderBatch(customer, new Date("2026-09-30T09:00:00+09:00"), [naver, coupang, unmatched, stale]);
    await mappingService.connectProductMapping(naver, x.id);
    await mappingService.connectProductMapping(coupang, x.id);
    await mappingStore.saveProductMapping({
      platformProductKey: model.makePlatformProductKey(stale), platform: stale.platform,
      platformProductId: stale.platformProductId, platformOptionId: stale.platformOptionId,
      rawProductName: stale.rawProductName, rawOptionName: stale.rawOptionName,
      wholesaleProductId: "missing",
    });
    return {
      x: x.id, y: y.id,
      naver: model.makePlatformProductKey(naver),
      coupang: model.makePlatformProductKey(coupang),
      unmatched: model.makePlatformProductKey(unmatched),
      stale: model.makePlatformProductKey(stale),
    };
  });

  await page.reload({ waitUntil: "networkidle" });
  await waitRows(page, 3);
  const initial = await page.evaluate(() => ({
    headers: [...document.querySelectorAll(".order-price-table th")].map((node) => node.textContent.trim()),
    counts: Object.fromEntries([...document.querySelectorAll("[data-filter-count]")].map((node) => [node.dataset.filterCount, node.textContent])),
    matchedPlatform: document.querySelector("tr[data-pricing-row^='target::'] td:nth-child(2)")?.textContent,
    xss: Boolean(window.__priceXss),
    images: document.querySelectorAll("#orderPriceTableBody img").length,
  }));
  const expectedHeaders = ["상품명", "플랫폼", "매입가", "네이버 판매가", "쿠팡 판매가", "매칭상태", "관리"];
  if (JSON.stringify(initial.headers) !== JSON.stringify(expectedHeaders)) throw new Error("final price-table columns failed");
  if (initial.counts.matched !== "1" || initial.counts.unmatched !== "1" || initial.counts.stale !== "1") throw new Error("grouped status counts failed");
  if (initial.matchedPlatform !== "네이버쿠팡" || initial.xss || initial.images) throw new Error("platform aggregation or XSS rendering failed");

  const preserved = await page.evaluate(async () => {
    const store = await import("/js/order/services/OrderHistoryStore.js");
    const rows = await store.getOrderProductsByDate("2026-09-30");
    return rows.every((row) => row.rawOptionName && row.platformOptionId && row.quantity > 0);
  });
  if (!preserved) throw new Error("hidden option/id/quantity data was not preserved");

  await page.locator("tr[data-pricing-row^='target::'] [data-manage-row]").click();
  if (await page.locator(".mapping-source-card").count() !== 2) throw new Error("grouped mapping management did not list both sources");
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(`button[data-unlink-mapping="${keys.coupang}"]`).click();
  await waitRows(page, 4);
  const naverOnly = await page.locator("tr[data-pricing-row^='target::'] td:nth-child(2)").textContent();
  if (naverOnly !== "네이버") throw new Error("platform did not update after individual unlink");

  await page.locator(`tr[data-pricing-row="${keys.coupang}"] [data-manage-row]`).click();
  await page.locator("#mappingSearch").fill("통합 제품");
  await page.locator(`button[data-connect-product="${keys.x}"]`).click();
  await waitRows(page, 3);

  await page.locator(`tr[data-pricing-row="${keys.unmatched}"] [data-manage-row]`).click();
  await page.locator("#openManualProductBtn").click();
  await page.locator("#manualConnectName").fill("테스트 직접등록 제품 <img src=x onerror=window.__manualXss=1>");
  await page.locator("#manualConnectSpec").fill("500g");
  await page.locator("#manualConnectPrice").fill("5360");
  const preview = await page.locator("#manualPricePreview").textContent();
  if (!preview.includes("6,170원") || !preview.includes("6,700원")) throw new Error("manual price preview failed");
  await page.locator("#manualConnectForm button[type=submit]").click();
  await page.waitForFunction(() => document.querySelector("[data-filter-count='matched']")?.textContent === "2");

  const manual = await page.evaluate(async () => {
    const store = await import("/js/price/productPriceStore.js");
    const items = await store.getAllManualProducts();
    return { count: items.length, id: items[0]?.id, price: items[0]?.purchasePrice, xss: Boolean(window.__manualXss), images: document.querySelectorAll("#orderPriceTableBody img").length };
  });
  if (manual.count !== 1 || !manual.id.startsWith("manual::") || manual.price !== 5360 || manual.xss || manual.images) throw new Error("manual create, id, or escaping failed");

  await page.reload({ waitUntil: "networkidle" });
  await waitRows(page, 3);
  await page.locator("[data-source-filter='manual']").click();
  if ((await page.locator("#productDbCount").textContent()) !== "1개") throw new Error("manual source filter failed");
  await page.locator("[data-source-filter='wholesale']").click();
  if ((await page.locator("#productDbCount").textContent()) !== "2개") throw new Error("wholesale source filter failed");
  await page.locator("[data-source-filter='all']").click();
  if ((await page.locator("#productDbCount").textContent()) !== "3개") throw new Error("all-products source filter failed");
  await page.locator("[data-source-filter='manual']").click();
  await page.locator(`button[data-edit-manual="${manual.id}"]`).click();
  await page.locator("#manualEditPrice").fill("5500");
  await page.locator("#manualEditForm button[type=submit]").click();
  await page.waitForFunction((id) => document.querySelector(`tr[data-pricing-row="target::${id}"]`)?.textContent.includes("5,500원"), manual.id);
  const updated = await page.evaluate(async (id) => (await (await import("/js/price/productPriceStore.js")).getManualProductById(id)), manual.id);
  if (updated.id !== manual.id || updated.purchasePrice !== 5500) throw new Error("manual update did not preserve id or refresh price");

  await page.locator(`tr[data-pricing-row="${keys.stale}"] [data-manage-row]`).click();
  await page.locator("#mappingSearch").fill("테스트 직접등록 제품");
  await page.locator(`button[data-connect-product="${manual.id}"]`).click();
  await waitRows(page, 2);
  const manualPlatforms = await page.locator(`tr[data-pricing-row="target::${manual.id}"] td:nth-child(2)`).textContent();
  if (manualPlatforms !== "네이버쿠팡") throw new Error("manual product platform aggregation failed");

  await page.evaluate(async (replacement) => {
    const store = await import("/js/price/productPriceStore.js");
    await store.replaceProductPriceDatabase([replacement], { fileName: "replacement.xlsx", productCount: 1 });
  }, { id: keys.y, productName: "교체 제품", specification: "2kg", purchasePrice: 7000 });
  await page.reload({ waitUntil: "networkidle" });
  const retained = await page.evaluate(async (id) => ({
    manual: Boolean(await (await import("/js/price/productPriceStore.js")).getManualProductById(id)),
    mappings: (await (await import("/js/price/productMappingStore.js")).getAllProductMappings()).length,
  }), manual.id);
  if (!retained.manual || retained.mappings !== 4) throw new Error("wholesale replacement removed manual product or mappings");

  await page.locator("[data-source-filter='manual']").click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(`button[data-delete-manual="${manual.id}"]`).click();
  await page.waitForFunction((id) => !document.querySelector(`button[data-delete-manual="${id}"]`), manual.id);
  const deleted = await page.evaluate(async (id) => ({
    product: await (await import("/js/price/productPriceStore.js")).getManualProductById(id),
    mappings: (await (await import("/js/price/productMappingStore.js")).getAllProductMappings()).filter((mapping) => mapping.wholesaleProductId === id).length,
  }), manual.id);
  if (deleted.product || deleted.mappings !== 2) throw new Error("manual delete should retain mappings");
  await page.waitForFunction(() => document.querySelector("[data-filter-count='stale']")?.textContent === "4");

  const emptyContext = await browser.newContext();
  const emptyPage = await emptyContext.newPage();
  await emptyPage.goto(`${baseUrl}/#/price`, { waitUntil: "networkidle" });
  await emptyPage.evaluate(async () => {
    const history = await import("/js/order/services/OrderHistoryStore.js");
    await history.saveOrderBatch([{ name: "테스트", products: [] }], new Date("2026-09-30T10:00:00+09:00"), [{
      platform: "naver", displayProductName: "DB 없는 직접등록", rawProductName: "DB 없는 직접등록", rawOptionName: "옵션", platformProductId: "empty-db", platformOptionId: "option", quantity: 1,
    }]);
  });
  await emptyPage.reload({ waitUntil: "networkidle" });
  await waitRows(emptyPage, 1);
  await emptyPage.locator("[data-manage-row]").click();
  await emptyPage.locator("#openManualProductBtn").click();
  await emptyPage.locator("#manualConnectPrice").fill("1000");
  await emptyPage.locator("#manualConnectForm button[type=submit]").click();
  await emptyPage.waitForFunction(() => document.querySelector("[data-filter-count='matched']")?.textContent === "1");
  await emptyContext.close();

  console.log("order product pricing browser test: columns/group/platform/manual CRUD/source filters/no-wholesale/connect/reload/update/replace/stale/XSS passed");
} finally {
  await browser.close();
}
