import { chromium } from "playwright";

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:5151";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`${baseUrl}/#/price`, { waitUntil: "networkidle" });
  const report = await page.evaluate(async () => {
    const productStore = await import("/js/price/productPriceStore.js");
    const mappingStore = await import("/js/price/productMappingStore.js");
    const service = await import("/js/price/productMappingService.js");
    const normalizer = await import("/js/price/productNormalizer.js");

    const wholesaleId = normalizer.makeWholesaleProductId("유린기소스 모노쉐프", "1kg");
    const wholesale = { id: wholesaleId, productName: "유린기소스 모노쉐프", specification: "1kg", purchasePrice: 5360 };
    const coupang = { platform: "coupang", displayProductName: "유린기소스 모노쉐프 1kg", rawProductName: "유린기소스 모노쉐프 1kg 원본", rawOptionName: "1개 1L", platformProductId: "8422686847", platformOptionId: "94679295557", quantity: 1, phone: "저장되면 안 됨", address: "저장되면 안 됨" };
    const naver = { platform: "naver", displayProductName: "상품", rawProductName: "상품 원본", rawOptionName: "", platformProductId: "123", platformOptionId: "", quantity: 1 };
    const naverOption = { ...naver, platformOptionId: "OPTION1" };
    const coupangSameId = { ...coupang, platformProductId: "123", platformOptionId: "" };
    const optionA = { ...coupang, platformProductId: "100", platformOptionId: "200" };
    const optionB = { ...coupang, platformProductId: "100", platformOptionId: "201" };

    await productStore.replaceProductPriceDatabase([wholesale], { fileName: "test.xlsx" });
    const unmatched = await service.resolveProductMapping(coupang);
    const firstMapping = await service.connectProductMapping(coupang, wholesaleId);
    const matched = await service.resolveProductPricing(coupang);
    const changedName = await service.resolveProductMapping({ ...coupang, rawProductName: "SEO 이름 변경" });
    const createdAt = firstMapping.createdAt;
    const updatedMapping = await service.connectProductMapping({ ...coupang, rawProductName: "SEO 이름 변경" }, wholesaleId);

    await service.connectProductMapping(naver, wholesaleId);
    await service.connectProductMapping(naverOption, wholesaleId);
    await service.connectProductMapping(coupangSameId, wholesaleId);
    await service.connectProductMapping(optionA, wholesaleId);
    await service.connectProductMapping(optionB, wholesaleId);
    const mappingsBeforeReload = await mappingStore.getAllProductMappings();

    await productStore.replaceProductPriceDatabase([{ ...wholesale, purchasePrice: 5500 }], { fileName: "updated.xlsx" });
    const updatedPrice = await service.resolveProductPricing(coupang);
    await productStore.replaceProductPriceDatabase([], { fileName: "empty.xlsx" });
    const stale = await service.resolveProductMapping(coupang);
    const staleMappingStillExists = Boolean(await mappingStore.getProductMapping(firstMapping.platformProductKey));

    await mappingStore.deleteProductMapping(firstMapping.platformProductKey);
    const afterDelete = await service.resolveProductMapping(coupang);
    const mappingsAfterDelete = await mappingStore.getAllProductMappings();
    const forbidden = ["customerName", "name", "phone", "address", "zipcode", "deliveryMessage", "purchasePrice"];
    return {
      wholesaleId,
      unmatched: unmatched.status,
      matched: matched.status,
      prices: matched.prices,
      changedName: changedName.status,
      createdAtPreserved: updatedMapping.createdAt === createdAt,
      mappingCount: mappingsBeforeReload.length,
      uniqueKeys: new Set(mappingsBeforeReload.map((item) => item.platformProductKey)).size,
      privateFieldsFound: mappingsBeforeReload.some((item) => forbidden.some((key) => key in item)),
      updatedPrice: updatedPrice.prices?.purchasePrice,
      stale: stale.status,
      staleMappingStillExists,
      afterDelete: afterDelete.status,
      mappingsAfterDelete: mappingsAfterDelete.length,
    };
  });
  await page.reload({ waitUntil: "networkidle" });
  const persistedCount = await page.evaluate(async () => (await import("/js/price/productMappingStore.js")).getAllProductMappings().then((items) => items.length));
  if (report.unmatched !== "unmatched" || report.matched !== "matched" || report.changedName !== "matched") throw new Error("mapping status resolution failed");
  if (report.prices.purchasePrice !== 5360 || report.prices.naverPrice !== 6170 || report.prices.coupangPrice !== 6700) throw new Error("mapped price calculation failed");
  if (!report.createdAtPreserved || report.mappingCount !== 6 || report.uniqueKeys !== 6 || report.privateFieldsFound) throw new Error("mapping upsert, separation, or privacy failed");
  if (report.updatedPrice !== 5500 || report.stale !== "stale" || !report.staleMappingStillExists || report.afterDelete !== "unmatched") throw new Error("product DB update, stale, or delete behavior failed");
  if (persistedCount !== report.mappingsAfterDelete) throw new Error("mapping reload persistence failed");
  console.log(`product mapping browser test: ${JSON.stringify({ ...report, persistedCount })}`);
} finally {
  await browser.close();
}
