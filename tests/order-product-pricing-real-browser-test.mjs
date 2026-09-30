import { chromium } from "playwright";

const wholesaleFile = process.env.WHOLESALE_TEST_FILE;
const coupangFile = process.env.COUPANG_TEST_FILE;
const naverFile = process.env.NAVER_TEST_FILE;
if (!wholesaleFile || !coupangFile) {
  throw new Error("WHOLESALE_TEST_FILE and COUPANG_TEST_FILE are required");
}

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:5151";
const actualCoupangKey = "coupang::8422686847::94679295557";
const browser = await chromium.launch({ headless: true });

async function uploadAndSaveOrder(page, file) {
  await page.goto(`${baseUrl}/#/order`, { waitUntil: "networkidle" });
  await page.locator("#fileInput").setInputFiles(file);
  await page.waitForFunction(() => !document.querySelector("#convertBtn")?.disabled);
  await page.locator("#convertBtn").click();
  await page.waitForFunction(() => !document.querySelector("#saveOrderBtn")?.disabled);
  await page.locator("#saveOrderBtn").click();
  await page.waitForFunction(() => document.querySelector("#alertBox")?.textContent?.includes("저장했습니다"));
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(120000);

  await uploadAndSaveOrder(page, coupangFile);
  if (naverFile) await uploadAndSaveOrder(page, naverFile);

  await page.goto(`${baseUrl}/#/price`, { waitUntil: "networkidle" });
  await page.locator("#productDbFileInput").setInputFiles(wholesaleFile);
  await page.waitForFunction(() => document.querySelector("#priceAlert")?.textContent?.includes("제품DB 업데이트 완료"));
  await page.waitForFunction(() => document.querySelectorAll("#orderPriceTableBody tr[data-pricing-row]").length > 0);

  const summary = await page.evaluate(async () => {
    const history = await import("/js/order/services/OrderHistoryStore.js");
    const productStore = await import("/js/price/productPriceStore.js");
    const dates = await history.getOrderDatesWithProducts();
    const selectedDate = document.querySelector("#orderPriceDate")?.value || "";
    const products = await history.getOrderProductsByDate(selectedDate);
    const wholesale = (await productStore.loadProductPriceDatabase()).products;
    const candidate = wholesale.find((item) => item.productName.includes("유린기")) || wholesale[0];
    return {
      selectedDate,
      batchCount: dates.find((item) => item.dateKey === selectedDate)?.batchCount || 0,
      productCount: products.length,
      candidateId: candidate?.id || "",
      candidateQuery: candidate?.productName || "",
    };
  });

  const row = page.locator(`tr[data-pricing-row="${actualCoupangKey}"]`);
  await row.waitFor();
  const initialStatus = await row.locator(".order-match-badge").textContent();
  if (initialStatus !== "미매칭") throw new Error(`actual Coupang product must start unmatched, got ${initialStatus}`);

  await row.locator("[data-manage-row]").click();
  await page.locator("#mappingSearch").fill(summary.candidateQuery);
  await page.locator(`button[data-connect-product="${summary.candidateId}"]`).click();
  await page.waitForFunction((id) => document.querySelector(`tr[data-pricing-row="target::${id}"] .order-match-badge`)?.textContent === "매칭완료", summary.candidateId);

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction((id) => document.querySelector(`tr[data-pricing-row="target::${id}"] .order-match-badge`)?.textContent === "매칭완료", summary.candidateId);
  const afterReloadStatus = await page.locator(`tr[data-pricing-row="target::${summary.candidateId}"] .order-match-badge`).textContent();

  console.log(JSON.stringify({
    selectedDate: summary.selectedDate,
    batchCount: summary.batchCount,
    productCount: summary.productCount,
    actualCoupangKey,
    initialStatus,
    connectedStatus: "매칭완료",
    afterReloadStatus,
  }));
  await context.close();
} finally {
  await browser.close();
}
