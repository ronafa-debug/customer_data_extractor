import { chromium } from "playwright";

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:5151";
const browser = await chromium.launch({ headless: true });
let passed = 0;
function check(value, label) {
  if (!value) throw new Error(label);
  passed += 1;
  console.log(`OK ${label}`);
}

try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${baseUrl}/#/order`, { waitUntil: "networkidle" });
  const result = await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase("dauto-order-history");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    const history = await import("/js/order/services/OrderHistoryStore.js");
    const model = await import("/js/order/model/StandardOrderRow.js");
    const row = (id, quantity = 1) => model.createStandardOrderRow({
      platform: "naver",
      productOrderId: id,
      platformProductId: "product-X",
      rawProductName: "상품 X",
      displayProductName: "상품 X",
      quantity,
      customerName: `고객 ${id}`,
      phone: "010-0000-0000",
      address: "테스트 주소",
    });
    const firstRows = ["A", "B", "C", "D", "E"].map((id) => row(id, id === "A" ? 2 : 1));
    const first = await history.saveNewOrderRows(firstRows, new Date(2026, 9, 1, 10));
    const afterFirst = await history.loadOrderBatches();
    const duplicate = await history.saveNewOrderRows(firstRows, new Date(2026, 9, 1, 11));
    const afterDuplicate = await history.loadOrderBatches();
    const partialRows = ["D", "E", "F", "G", "H"].map((id) => row(id, 2));
    const partial = await history.saveNewOrderRows(partialRows, new Date(2026, 9, 1, 12));
    const afterPartial = await history.loadOrderBatches();
    const products = await history.getOrderProductsByDate("2026-10-01");
    const concurrentRow = row("I", 3);
    const concurrent = await Promise.all([
      history.saveNewOrderRows([concurrentRow], new Date(2026, 9, 1, 13)),
      history.saveNewOrderRows([concurrentRow], new Date(2026, 9, 1, 13)),
    ]);
    const afterConcurrent = await history.loadOrderBatches();
    await history.saveOrderBatch([{ name: "legacy", products: [] }], new Date(2026, 8, 30));
    const legacySave = await history.saveNewOrderRows([row("LEGACY")], new Date(2026, 9, 2));
    const all = await history.loadOrderBatches();
    return {
      first: { newCount: first.newRows.length, duplicate: first.duplicateCount, customers: first.customerCount },
      firstBatchCount: afterFirst.length,
      duplicate: { hasBatch: Boolean(duplicate.batch), newCount: duplicate.newRows.length, duplicate: duplicate.duplicateCount },
      duplicateBatchCount: afterDuplicate.length,
      duplicateCustomerCount: afterDuplicate.reduce((sum, batch) => sum + batch.customerCount, 0),
      partial: { newIds: partial.newRows.map((item) => item.orderIdentityKey), duplicate: partial.duplicateCount, customers: partial.customerCount, products: partial.batch.orderProducts },
      partialBatchCount: afterPartial.length,
      partialCustomerCount: afterPartial.reduce((sum, batch) => sum + batch.customerCount, 0),
      productQuantity: products.find((item) => item.platformProductId === "product-X")?.quantity,
      concurrentSaved: concurrent.filter((item) => item.batch).length,
      concurrentDuplicate: concurrent.reduce((sum, item) => sum + item.duplicateCount, 0),
      concurrentBatchCount: afterConcurrent.length,
      legacySaved: Boolean(legacySave.batch),
      legacyHasNoKeys: all.some((batch) => batch.customers[0]?.name === "legacy" && batch.orderIdentityKeys.length === 0),
      allIdentityKeys: all.flatMap((batch) => batch.orderIdentityKeys),
    };
  });
  check(result.first.newCount === 5 && result.first.duplicate === 0 && result.first.customers === 5, "첫 저장 A~E 5건");
  check(result.firstBatchCount === 1, "첫 저장 batch 1개");
  check(!result.duplicate.hasBatch && result.duplicate.newCount === 0 && result.duplicate.duplicate === 5, "완전 중복 신규 0·중복 5");
  check(result.duplicateBatchCount === 1 && result.duplicateCustomerCount === 5, "완전 중복 batch·고객 증가 없음");
  check(result.partial.newIds.join(",") === "naver::F,naver::G,naver::H" && result.partial.duplicate === 2, "부분 중복 F/G/H만 저장");
  check(result.partial.customers === 3 && result.partialBatchCount === 2 && result.partialCustomerCount === 8, "부분 중복 신규 customers만 반영");
  check(result.partial.products.length === 1 && result.partial.products[0].quantity === 6, "부분 중복 신규 orderProducts만 생성");
  check(result.productQuantity === 12, "중복 수량 제외 후 날짜별 quantity 정상");
  check(result.concurrentSaved === 1 && result.concurrentDuplicate === 1 && result.concurrentBatchCount === 3, "동시 저장 요청도 batch 한 번만 생성");
  check(result.legacySaved && result.legacyHasNoKeys, "legacy batch 공존 및 신규 identity 저장");
  check(new Set(result.allIdentityKeys).size === 10, "최종 identity A~I 및 LEGACY 중복 없음");
  console.log(`order deduplication browser test: ${passed} passed, 0 failed`);
  await context.close();
} finally {
  await browser.close();
}
