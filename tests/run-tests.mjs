/**
 * v3 핵심 로직 단위 테스트 (Node ESM)
 * 실행: node tests/run-tests.mjs
 */
import { extractProductName } from "../js/order/utils/ProductExtractor.js";
import { groupCustomers } from "../js/order/utils/GroupCustomer.js";
import { mergeProducts } from "../js/order/utils/MergeProduct.js";
import { formatBasic } from "../js/order/services/ExportService.js";
import { CoupangParser } from "../js/order/parser/CoupangParser.js";
import { NaverParser } from "../js/order/parser/NaverParser.js";
import { ParserFactory } from "../js/order/parser/ParserFactory.js";
import { ERROR_MESSAGE } from "../js/order/constants.js";
import { Customer } from "../js/order/model/Customer.js";
import { makePlatformProductKey, mergeOrderProducts } from "../js/order/model/StandardOrderRow.js";
import { isDoorDropOnlyMessage } from "../js/order/utils/DoorDropMessage.js";
import {
  isReceiptCandidateGeometry,
  expandReceiptCorners,
  removeDuplicateReceiptCandidates,
  sortReceiptCandidates,
} from "../js/receipt/ReceiptDetector.js";
import { isShippingFeeProductName, normalizeOcrPrice, parseReceiptItems } from "../js/receipt/ReceiptItemParser.js";
import { parseTsvLayout } from "../js/receipt/ReceiptOcrLayout.js";
import {
  calculateSalePrices,
  ceilToTen,
  findDuplicateProduct,
  normalizeNewProductName,
  searchNewProducts,
  validateNewProduct,
} from "../js/new-price/NewPriceModel.js";
import { NEW_PRICE_DB_NAME, NEW_PRICE_STORE_NAME } from "../js/new-price/NewPriceStore.js";
import { calculateMarketplacePrices, ceilToTenWon } from "../js/price/priceCalculator.js";
import { parseWholesaleWorkbook, parseWholesalePrice } from "../js/price/parseWholesaleWorkbook.js";
import { makeWholesaleProductId, normalizeProductKeyText } from "../js/price/productNormalizer.js";
import { validateManualProductInput } from "../js/price/productPriceStore.js";
import { buildOrderPricingRows, getSalesPlatformsForProduct } from "../js/price/orderProductPricingService.js";
import {
  parsePriceWorkbook,
  parseWon,
  rowMatchesQuery,
} from "../js/price/parsePriceWorkbook.js";
import {
  createOrderBatch,
  getBatchesForDate,
  getCustomerEntriesForDate,
  getCustomersForDate,
  getOrderProductsForDate,
  normalizeOrderBatches,
  summarizeOrderBatches,
  summarizeOrderProductDates,
  toLocalDateKey,
  withoutOrderBatch,
  withoutOrderCustomer,
  withoutOrderDate,
} from "../js/order/model/OrderBatch.js";

let passed = 0;
let failed = 0;

console.log("\n=== 영수증 후보 탐지 유틸 ===");
const receiptCandidates = [
  { id: "bottom-right", area: 1200, centerX: 700, centerY: 700, box: { x: 650, y: 620, width: 100, height: 180 } },
  { id: "top-right", area: 1200, centerX: 700, centerY: 200, box: { x: 650, y: 120, width: 100, height: 180 } },
  { id: "top-left", area: 1200, centerX: 200, centerY: 180, box: { x: 150, y: 100, width: 100, height: 180 } },
];

function assert(cond, name) {
  if (cond) {
    passed += 1;
    console.log(`  OK  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}`);
  }
}

function assertEq(actual, expected, name) {
  const ok = actual === expected;
  if (!ok) {
    console.error(`         expected: ${JSON.stringify(expected)}`);
    console.error(`         actual:   ${JSON.stringify(actual)}`);
  }
  assert(ok, name);
}

assertEq(
  sortReceiptCandidates(receiptCandidates).map((item) => item.id).join(","),
  "top-left,top-right,bottom-right",
  "사진 위치 기준 행·열 순서 정렬"
);
const duplicateCandidates = [
  { id: "large", area: 1000, box: { x: 10, y: 10, width: 100, height: 200 } },
  { id: "duplicate", area: 800, box: { x: 12, y: 12, width: 96, height: 196 } },
  { id: "other", area: 700, box: { x: 200, y: 10, width: 100, height: 200 } },
];
assertEq(removeDuplicateReceiptCandidates(duplicateCandidates).length, 2, "겹치는 영수증 후보 중복 제거");
const validGeometry = {
  area: 6000,
  imageArea: 100000,
  fillRatio: 0.75,
  quadArea: 7000,
  aspect: 2.5,
  boxWidth: 100,
  boxHeight: 180,
  imageWidth: 400,
  imageHeight: 250,
};
assert(isReceiptCandidateGeometry(validGeometry), "영수증 크기·사각형 후보 허용");
assert(
  !isReceiptCandidateGeometry({ ...validGeometry, area: 100, quadArea: 100 }),
  "너무 작은 contour 제외"
);
const expandedCorners = expandReceiptCorners(
  [{ x: 0, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 190 }, { x: 0, y: 190 }],
  100,
  200
);
assertEq(expandedCorners[0].x, 0, "OCR crop 여백이 원본 왼쪽 경계를 넘지 않음");
assert(expandedCorners[2].x > 90 && expandedCorners[2].x <= 99, "OCR crop 상대 여백 확장");
assert(
  !isReceiptCandidateGeometry({ ...validGeometry, fillRatio: 0.2 }),
  "사각형 밀도가 낮은 후보 제외"
);

console.log("\n=== 영수증 OCR 행 분석 ===");
const ocrWord = (text, x0, x1, y0, y1) => ({ text, confidence: 90, bbox: { x0, x1, y0, y1 } });
const ocrLine = (words) => ({
  words,
  text: words.map((word) => word.text).join(" "),
  bbox: {
    x0: Math.min(...words.map((word) => word.bbox.x0)),
    y0: Math.min(...words.map((word) => word.bbox.y0)),
    x1: Math.max(...words.map((word) => word.bbox.x1)),
    y1: Math.max(...words.map((word) => word.bbox.y1)),
  },
});
const receiptOcrLines = [
  ocrLine([ocrWord("모노마트", 30, 170, 10, 35)]),
  ocrLine([
    ocrWord("제품명", 30, 100, 100, 130),
    ocrWord("단가", 320, 370, 100, 130),
    ocrWord("수량", 430, 480, 100, 130),
    ocrWord("금액", 550, 610, 100, 130),
  ]),
  ocrLine([
    ocrWord("숨굴튀김", 30, 130, 150, 180),
    ocrWord("모노쉐프", 140, 240, 150, 180),
    ocrWord("5,360", 320, 380, 150, 180),
    ocrWord("20", 440, 465, 150, 180),
    ocrWord("107,200", 535, 620, 150, 180),
  ]),
  ocrLine([
    ocrWord("떡볶이2(신규)", 30, 230, 195, 225),
    ocrWord("4 000", 320, 380, 195, 225),
    ocrWord("1", 445, 460, 195, 225),
    ocrWord("4,000", 550, 615, 195, 225),
  ]),
  ocrLine([
    ocrWord("택배비2(신규)(1)", 30, 230, 230, 245),
    ocrWord("4,000", 320, 380, 230, 245),
    ocrWord("1", 445, 460, 230, 245),
    ocrWord("4,000", 550, 615, 230, 245),
  ]),
  ocrLine([ocrWord("원결제금액", 200, 350, 250, 280), ocrWord("111,200", 535, 620, 250, 280)]),
  ocrLine([ocrWord("공급가액", 200, 300, 300, 330), ocrWord("101,091", 535, 620, 300, 330)]),
];
const parsedReceipt = parseReceiptItems({ lines: receiptOcrLines });
assertEq(normalizeOcrPrice("5,360"), 5360, "가격 쉼표 제거");
assertEq(normalizeOcrPrice("5 360"), 5360, "가격 공백 제거");
assertEq(normalizeOcrPrice("5O60"), null, "잘못된 가격을 임의 보정하지 않음");
for (const name of ["택배비", "택배비2", "택배비(신규)", "택배비2(신규)(1)", "배송비", "a — 택배비2( 신규) (1 )"]) {
  assert(isShippingFeeProductName(name), `배송 비용 제외: ${name}`);
}
assert(!isShippingFeeProductName("택배용 보냉박스"), "택배 관련 정상 상품 보존");
assertEq(parsedReceipt.items.length, 2, "한 영수증의 여러 상품 행 파싱");
assert(!parsedReceipt.items.some((item) => item.productName.includes("택배비")), "파싱된 상품 후보에서 택배비 제외");
assertEq(parsedReceipt.items[0].productName, "숨굴튀김 모노쉐프", "제품명 열 결합");
assertEq(parsedReceipt.items[0].purchasePrice, 5360, "단가 열을 매입가로 선택");
assertEq(parsedReceipt.items[0].quantity, 20, "수량 열 구분");
assertEq(parsedReceipt.items[0].totalPrice, 107200, "금액 열 구분");
assert(!parsedReceipt.items.some((item) => item.productName.includes("공급가액")), "상품 테이블 밖 결제 텍스트 제외");
assertEq(parseReceiptItems({ lines: [] }).items.length, 0, "빈 OCR 결과 처리");
assertEq(parseReceiptItems({ lines: [ocrLine([ocrWord("판독불가", 0, 100, 0, 20)])] }).reason, "header-not-found", "잘못된 OCR 결과 처리");
const sampleTsv = [
  "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
  "5\t1\t1\t1\t1\t1\t10\t20\t50\t20\t95\t제품명",
  "5\t1\t1\t1\t1\t2\t100\t20\t40\t20\t90\t단가",
].join("\n");
assertEq(parseTsvLayout(sampleTsv).lines[0].words.length, 2, "OCR TSV word/line 좌표 정규화");
const lowConfidenceLines = structuredClone(receiptOcrLines);
lowConfidenceLines[2].words.find((word) => word.text === "5,360").confidence = 30;
assert(parseReceiptItems({ lines: lowConfidenceLines }).items[0].reviewRequired, "낮은 단가 confidence는 확인 필요 처리");
const sequentialReceiptResults = [receiptOcrLines, receiptOcrLines].map((lines, index) => ({
  receiptIndex: index + 1,
  ...parseReceiptItems({ lines }),
}));
assertEq(sequentialReceiptResults.map((result) => result.receiptIndex).join(","), "1,2", "여러 영수증 순차 분석 순서 유지");

console.log("\n=== ProductExtractor ===");
assertEq(
  extractProductName("레몬크림마요소스 1kg 일본산"),
  "레몬크림마요소스 1kg",
  "kg 단위까지 추출"
);
assertEq(
  extractProductName("콜라 1.5L PET"),
  "콜라 1.5L",
  "L 단위까지 추출"
);
assertEq(
  extractProductName("드레싱 950ml 특제"),
  "드레싱 950ml",
  "ml 단위까지 추출"
);

console.log("\n=== Test 3 & 4: 동일 고객 그룹화 + 수량 합산 ===");
const customers = groupCustomers([
  {
    name: "홍길동",
    phone: "010-1234-5678",
    address: "서울시 강남구",
    zipcode: "06234",
    deliveryMessage: "문 앞에 두세요",
    productName: "웨이파 250g 프리미엄",
    quantity: 1,
  },
  {
    name: "홍길동",
    phone: "010-1234-5678",
    address: "서울시 강남구",
    zipcode: "06234",
    deliveryMessage: "",
    productName: "웨이파 250g 특가",
    quantity: 2,
  },
  {
    name: "홍길동",
    phone: "010-1234-5678",
    address: "서울시 강남구",
    zipcode: "06234",
    deliveryMessage: "",
    productName: "콜라 1.5L PET",
    quantity: 1,
  },
]);
assertEq(customers.length, 1, "동일 고객 1명으로 병합");
assertEq(customers[0].products.length, 2, "상품 종류 2개 (웨이파+콜라)");
const weipa = customers[0].products.find((p) => p.name.includes("웨이파"));
assertEq(weipa?.quantity, 3, "동일 상품 수량 1+2=3");
assertEq(customers[0].deliveryMessage, "문 앞에 두세요", "배송메시지 유지");

console.log("\n=== Test 5: 출력 형식(빈 줄 구분) + 메시지 없을 때 블록 생략 ===");
const noMsg = new Customer({
  name: "김철수",
  phone: "010-9999-8888",
  address: "부산시",
  zipcode: "48000",
  deliveryMessage: "",
  products: mergeProducts([{ name: "두부 300g", quantity: 1 }]),
});
const text = formatBasic(noMsg);
assertEq(
  text,
  "김철수\n\n010-9999-8888\n\n48000 부산시\n\n두부 300g 1개\n\n-------------------",
  "필드 사이 빈 줄 + 메시지 블록 생략"
);

const withDetail = new Customer({
  name: "서선일",
  phone: "010-9414-7127",
  address: "경기도 평택시 소사3로 22 (소사동, 평택 효성해링턴 플레이스 2단지)\n208-1302",
  zipcode: "18034",
  deliveryMessage: "",
  products: mergeProducts([{ name: "핑크 나루토마키 어묵 160g", quantity: 5 }]),
});
const text2 = formatBasic(withDetail);
assert(
  text2.includes(
    "18034 경기도 평택시 소사3로 22 (소사동, 평택 효성해링턴 플레이스 2단지) 208-1302"
  ),
  "상세주소가 주소와 한 줄로 합쳐짐"
);
assert(!text2.includes("단지)\n208"), "주소에 줄바꿈 없음");

console.log("\n=== Test 1: 쿠팡 자동 인식 + 파싱 ===");
const coupangWb = {
  fileName: "coupang.xlsx",
  sheets: [
    {
      name: "Sheet1",
      data: [
        [
          "주문번호",
          "수취인이름",
          "수취인전화번호",
          "우편번호",
          "수취인 주소",
          "노출상품명",
          "구매수",
          "배송메시지",
          "등록상품명",
          "등록옵션명",
          "노출상품ID",
          "옵션ID",
        ],
        [
          "1",
          "홍길동",
          "010-1111-2222",
          "06234",
          "서울특별시 강남구 테헤란로 1",
          "레몬크림마요소스 1kg 일본산",
          "2",
          "배송 전 연락주세요",
          "레몬크림마요소스 판매상품 1kg",
          "1kg 1개",
          900100,
          700100,
        ],
        [
          "2",
          "홍길동",
          "010-1111-2222",
          "06234",
          "서울특별시 강남구 테헤란로 1",
          "레몬크림마요소스 1kg 일본산",
          "1",
          "",
          "레몬크림마요소스 판매상품 1kg",
          "1kg 1개",
          900100,
          700100,
        ],
      ],
    },
  ],
};
const coupangParser = new CoupangParser();
assert(coupangParser.canParse(coupangWb), "쿠팡 canParse");
assert(
  ParserFactory.detect(coupangWb).mallId === "coupang",
  "Factory → 쿠팡"
);
const coupangCustomers = coupangParser.parse(coupangWb);
assertEq(coupangCustomers.length, 1, "쿠팡 고객 1명");
assertEq(coupangCustomers[0].products[0].quantity, 3, "쿠팡 수량 합산 2+1");
assertEq(
  coupangCustomers[0].products[0].name,
  "레몬크림마요소스 1kg",
  "쿠팡 상품명 추출"
);
assertEq(coupangCustomers[0].zipcode, "06234", "쿠팡 우편번호");
const coupangResult = coupangParser.parseWithOrderRows(coupangWb);
assertEq(coupangResult.orderRows[0].platform, "coupang", "쿠팡 표준 row 플랫폼");
assertEq(coupangResult.orderRows[0].rawProductName, "레몬크림마요소스 판매상품 1kg", "쿠팡 등록상품명 원문 보존");
assertEq(coupangResult.orderRows[0].rawOptionName, "1kg 1개", "쿠팡 등록옵션명 보존");
assertEq(coupangResult.orderRows[0].platformProductId, "900100", "쿠팡 노출상품ID 문자열 보존");
assertEq(coupangResult.orderRows[0].platformOptionId, "700100", "쿠팡 옵션ID 문자열 보존");
assertEq(coupangResult.orderRows[0].displayProductName, "레몬크림마요소스 1kg", "쿠팡 기존 표시 상품명 유지");
assertEq(coupangResult.orderRows[0].quantity, 2, "쿠팡 원본 row 수량 보존");

console.log("\n=== 쿠팡 문 앞 배송메시지 필터 ===");
const doorDropOnlyMessages = [
  "문 앞",
  "문앞",
  "집 앞",
  "집앞",
  " 문 앞 ",
  "문 앞에 놓아주세요",
  "문앞에 놔주세요",
  "문 앞에 두고 가주세요",
  "문앞에 두세요",
  "문 앞에 놔두세요",
  "문 앞에 부탁드립니다",
  "문 앞 배송 부탁드립니다",
];
for (const message of doorDropOnlyMessages) {
  assert(isDoorDropOnlyMessage(message), `제거: ${message}`);
}

const deliveryMessagesToKeep = [
  "문 앞에 놓고 문자 주세요",
  "문 앞에 두고 전화주세요",
  "문 앞에 두시고 벨 눌러주세요",
  "문 앞에 놓고 사진 찍어주세요",
  "문 앞에 놓기 전에 전화주세요",
  "문 앞에 두지 말고 전화주세요",
  "문 앞 말고 경비실에 맡겨주세요",
  "공동현관 비밀번호 1234, 문 앞에 놓아주세요",
  "문 앞에 두고 아이가 자고 있으니 벨 누르지 마세요",
  "부재 시 문 앞에 놓아주세요",
  "경비실에 맡겨주세요",
];
for (const message of deliveryMessagesToKeep) {
  assert(!isDoorDropOnlyMessage(message), `유지: ${message}`);
}

const coupangDoorDropWb = {
  fileName: "coupang-door-drop.xlsx",
  sheets: [
    {
      name: "Sheet1",
      data: [
        ["수취인이름", "수취인주소", "상품명", "배송메시지"],
        ["문앞제거", "서울시", "상품 A", "문 앞에 놓아주세요"],
        ["추가요청유지", "부산시", "상품 B", "문 앞에 놓고 문자 주세요"],
      ],
    },
  ],
};
const coupangDoorDropCustomers = new CoupangParser().parse(coupangDoorDropWb);
assertEq(
  coupangDoorDropCustomers[0].deliveryMessage,
  "",
  "쿠팡 문 앞 단독 메시지는 빈 메시지로 처리"
);
assertEq(
  coupangDoorDropCustomers[1].deliveryMessage,
  "문 앞에 놓고 문자 주세요",
  "쿠팡 추가 요청 메시지는 원문 유지"
);

console.log("\n=== Test 2: 네이버 자동 인식 + 파싱 ===");
const naverWb = {
  fileName: "naver.xlsx",
  sheets: [
    {
      name: "Sheet1",
      data: [
        ["스마트스토어 주문내역"],
        [
          "상품주문번호",
          "수취인명",
          "수취인연락처1",
          "우편번호",
          "기본배송지",
          "상세배송지",
          "상품명",
          "수량",
          "배송메시지",
          "옵션정보",
          "상품번호",
          "옵션관리코드",
        ],
        [
          "2024001",
          "서선일",
          "010-9414-712",
          "18034",
          "경기도 평택시 소사3로 22",
          "(소사동) 208-1302",
          "핑크 나루토마키 어묵 160g 특가",
          "5",
          "",
          "160g 1개",
          12504797072,
          "OPT-160",
        ],
      ],
    },
  ],
};
const naverParser = new NaverParser();
assert(naverParser.canParse(naverWb), "네이버 canParse");
assert(ParserFactory.detect(naverWb).mallId === "naver", "Factory → 네이버");
const naverCustomers = naverParser.parse(naverWb);
assertEq(naverCustomers.length, 1, "네이버 고객 1명");
assertEq(naverCustomers[0].name, "서선일", "네이버 수취인명");
assertEq(
  naverCustomers[0].products[0].name,
  "핑크 나루토마키 어묵 160g",
  "네이버 상품명 추출"
);
assertEq(naverCustomers[0].products[0].quantity, 5, "네이버 수량");
const naverResult = naverParser.parseWithOrderRows(naverWb);
assertEq(naverResult.orderRows[0].platform, "naver", "네이버 표준 row 플랫폼");
assertEq(naverResult.orderRows[0].rawProductName, "핑크 나루토마키 어묵 160g 특가", "네이버 원본 상품명 보존");
assertEq(naverResult.orderRows[0].displayProductName, "핑크 나루토마키 어묵 160g", "네이버 기존 표시 상품명 유지");
assertEq(naverResult.orderRows[0].rawOptionName, "160g 1개", "네이버 옵션정보 보존");
assertEq(naverResult.orderRows[0].platformProductId, "12504797072", "네이버 상품번호 문자열 보존");
assertEq(naverResult.orderRows[0].platformOptionId, "OPT-160", "네이버 옵션관리코드 보존");
assertEq(naverResult.orderRows[0].quantity, 5, "네이버 원본 row 수량 보존");

console.log("\n=== 표준 플랫폼 상품 key 및 snapshot ===");
assertEq(makePlatformProductKey({ platform: "coupang", platformProductId: "900100", platformOptionId: "700100" }), "coupang::900100::700100", "쿠팡 상품·옵션 key");
assertEq(makePlatformProductKey({ platform: "naver", platformProductId: "12504797072", platformOptionId: "" }), "naver::12504797072", "네이버 상품 key");
assertEq(makePlatformProductKey({ platform: "naver", platformProductId: "12504797072", platformOptionId: "OPT-160" }), "naver::12504797072::OPT-160", "네이버 상품·옵션 key");
assertEq(makePlatformProductKey({ platform: "naver", rawProductName: " 상품  A ", rawOptionName: " 1 KG " }), "naver::name::상품 a::1 kg", "ID 없는 상품 원문 fallback key");
assertEq(makePlatformProductKey({ platform: "coupang", platformProductId: "900100", platformOptionId: "700100", rawProductName: "변경된 SEO 상품명" }), "coupang::900100::700100", "ID가 있으면 원본 상품명 변경에도 key 유지");
assert(makePlatformProductKey({ platform: "coupang", platformProductId: "100", platformOptionId: "200" }) !== makePlatformProductKey({ platform: "coupang", platformProductId: "100", platformOptionId: "201" }), "같은 상품의 다른 옵션 key 분리");
assert(makePlatformProductKey({ platform: "naver", platformProductId: "123" }) !== makePlatformProductKey({ platform: "coupang", platformProductId: "123" }), "동일 상품 ID의 플랫폼 key 분리");
assertEq(makeWholesaleProductId("유린기소스", "1kg"), makeWholesaleProductId("유린기소스", "1kg"), "가격 변경과 무관한 회원2가 deterministic ID");
const mergedOrderProducts = mergeOrderProducts([
  ...coupangResult.orderRows,
  naverResult.orderRows[0],
  { ...naverResult.orderRows[0], platformProductId: "DIFFERENT", displayProductName: coupangResult.orderRows[0].displayProductName },
]);
assertEq(mergedOrderProducts.find((item) => item.platform === "coupang")?.quantity, 3, "동일 플랫폼·상품·옵션 수량 합산");
assertEq(mergedOrderProducts.filter((item) => item.platform === "naver").length, 2, "같은 표시명이어도 다른 ID는 분리");
assertEq(mergedOrderProducts.length, 3, "서로 다른 플랫폼 상품은 분리");
assert(mergedOrderProducts.every((item) => !["customerName", "phone", "address", "zipcode", "deliveryMessage"].some((key) => key in item)), "orderProducts 개인정보 필드 제외");

const naverDoorDropWb = {
  ...naverWb,
  sheets: [
    {
      ...naverWb.sheets[0],
      data: naverWb.sheets[0].data.map((row) => [...row]),
    },
  ],
};
naverDoorDropWb.sheets[0].data[2][8] = "문 앞에 놓아주세요";
assertEq(
  new NaverParser().parse(naverDoorDropWb)[0].deliveryMessage,
  "문 앞에 놓아주세요",
  "네이버 문 앞 메시지는 변경하지 않음"
);

console.log("\n=== 쿠팡 주소 중복 제거 ===");
const addr = "대구광역시 달서구 구마로 238 세현빌딩 2층 광피씨방 ( 송현동 )";
const coupangDupWb = {
  fileName: "coupang2.xlsx",
  sheets: [
    {
      name: "Sheet1",
      data: [
        [
          "주문번호",
          "수취인이름",
          "수취인전화번호",
          "우편번호",
          "수취인주소",
          "상세주소",
          "노출상품명",
          "구매수",
          "배송메시지",
        ],
        [
          "1",
          "이주언",
          "0502-4337-6694",
          "42737",
          addr,
          addr,
          "한입 찰도그 900g",
          "1",
          "꼭..매장안 직원에게 전달해주세요~",
        ],
      ],
    },
  ],
};
const coupangDup = new CoupangParser().parse(coupangDupWb);
assertEq(coupangDup.length, 1, "쿠팡 중복주소 고객 1명");
assertEq(
  coupangDup[0].fullAddress,
  `42737 ${addr}`,
  "주소가 한 번만 출력됨"
);
assert(
  !coupangDup[0].address.includes(`${addr} ${addr}`),
  "address 필드에 중복 결합 없음"
);

console.log("\n=== 신규 제품가격 계산 및 검증 ===");
assertEq(ceilToTen(6164), 6170, "10원 단위 올림");
assertEq(ceilToTen(6700), 6700, "이미 10원 단위인 금액 유지");
assertEq(calculateSalePrices(5360).naverPrice, 6170, "네이버 판매가 15% 및 10원 올림");
assertEq(calculateSalePrices(5360).coupangPrice, 6700, "쿠팡 판매가 25% 및 10원 올림");
assertEq(normalizeNewProductName("  토마토아란치니(10)  "), "토마토아란치니", "끝 수량 괄호 제거");
assertEq(normalizeNewProductName("소스(매운맛)"), "소스(매운맛)", "의미 있는 괄호 보존");
assertEq(normalizeNewProductName("상품(10) 묶음"), "상품(10) 묶음", "제품명 중간 숫자 괄호 보존");
assert(validateNewProduct({ productName: "상품", purchasePrice: "1,000" }).valid, "정상 신규 제품 검증");
assert(!validateNewProduct({ productName: "", purchasePrice: 1000 }).valid, "빈 제품명 거부");
assert(!validateNewProduct({ productName: "상품", purchasePrice: 0 }).valid, "0원 매입가 거부");
const newPriceRows = [
  { id: "a", productName: "토마토 아란치니", purchasePrice: 1000 },
  { id: "b", productName: "레몬 크림 마요 소스", purchasePrice: 2000 },
];
assertEq(searchNewProducts(newPriceRows, "레몬").length, 1, "저장 제품명 부분 검색");
assertEq(searchNewProducts(newPriceRows, "").length, 2, "빈 검색어는 전체 표시");
assertEq(findDuplicateProduct(newPriceRows, " 토마토  아란치니 ")?.id, "a", "공백 차이를 무시한 중복 제품 탐지");
assertEq(findDuplicateProduct(newPriceRows, "새 제품"), null, "중복되지 않은 제품 허용");
assertEq(NEW_PRICE_DB_NAME === "dauto-price", false, "기존 가격표와 별도 IndexedDB 사용");
assertEq(NEW_PRICE_STORE_NAME, "products", "신규 가격 전용 object store 사용");

console.log("\n=== 회원2가 제품DB 파서 ===");
const wholesaleHeader = ["브랜드", "분류1", "분류2", "분류3", "상태", "품명", "규격", "과세", "부가세", "기준판매가", "판매단가"];
const wholesaleRow = (name, spec, price) => ["", "", "", "", "", name, spec, "", "", "", price];
const wholesaleWorkbook = {
  sheets: [{ name: "Sheet1", data: [
    ["품목별판매단가현황"],
    ["브랜드", "분류1", "분류2", "분류3", "상태", "품명", "규격", "과세", "부가세", "기준판매가", "도매2가"],
    wholesaleHeader,
    wholesaleRow("유린기소스 모노쉐프", "1kg", "5,360"),
    wholesaleRow("유린기소스 모노쉐프", "2kg", "6000"),
    wholesaleRow("규격 없는 상품", "", "1,200"),
    wholesaleRow("", "1kg", "2000"),
    wholesaleRow("빈 가격 상품", "1kg", ""),
    wholesaleRow("0원 상품", "1kg", "0"),
    wholesaleRow("음수 상품", "1kg", "-50"),
    wholesaleRow("유린기소스 모노쉐프", "1kg", "5360"),
  ] }],
};
const parsedWholesale = parseWholesaleWorkbook(wholesaleWorkbook);
assertEq(parsedWholesale.products.length, 2, "회원2가 유효 제품과 중복 그룹 분리");
assertEq(parsedWholesale.excludedCount, 4, "빈 품명·가격·0원·음수 행 제외");
assertEq(parsedWholesale.duplicateCount, 2, "같은 품명과 규격 중복 행 감지");
assertEq(parsedWholesale.products.find((item) => item.productName === "규격 없는 상품")?.specification, "", "빈 규격 허용");
assertEq(parsedWholesale.products.find((item) => item.specification === "2kg")?.purchasePrice, 6000, "F/G/K 회원2가 가격 파싱");
assertEq(parseWholesalePrice("5,360"), 5360, "회원2가 쉼표 가격 파싱");
assertEq(makeWholesaleProductId("상품 A", "1kg"), makeWholesaleProductId(" 상품  A ", " 1kg "), "품명·규격 정규화 ID 안정성");
assert(makeWholesaleProductId("상품 A", "1kg") !== makeWholesaleProductId("상품 A", "2kg"), "같은 품명 다른 규격은 다른 ID");
assertEq(normalizeProductKeyText("  ABC   Product  "), "abc product", "제품 키 공백·대소문자 정규화");
assertEq(calculateMarketplacePrices(5360).naverPrice, 6170, "회원2가 네이버 가격 10원 올림");
assertEq(calculateMarketplacePrices(5360).coupangPrice, 6700, "회원2가 쿠팡 가격 10원 올림");
assertEq(ceilToTenWon(10.01), 20, "판매가 10원 단위 경계 올림");
assertEq(ceilToTenWon(20), 20, "판매가 정확한 10원 단위 유지");
assert(validateManualProductInput({ productName: "직접 제품", specification: "", purchasePrice: "5,360" }).valid, "직접등록 규격 빈 값 허용");
assert(!validateManualProductInput({ productName: "", purchasePrice: 1000 }).valid, "직접등록 제품명 필수");
assert(!validateManualProductInput({ productName: "제품", purchasePrice: "" }).valid, "직접등록 매입가 필수");
assert(!validateManualProductInput({ productName: "제품", purchasePrice: 0 }).valid, "직접등록 0원 금지");
assert(!validateManualProductInput({ productName: "제품", purchasePrice: -1 }).valid, "직접등록 음수 금지");
assert(!validateManualProductInput({ productName: "제품", purchasePrice: "가격" }).valid, "직접등록 비숫자 금지");
try {
  parseWholesaleWorkbook({ sheets: [{ name: "bad", data: [["상품명", "가격"]] }] });
  assert(false, "회원2가 헤더 오류 발생");
} catch (error) {
  assert(String(error.message).includes("회원2가 제품DB 형식"), "회원2가 헤더 오류 메시지");
}

console.log("\n=== 주문가격표 실제 제품 통합 ===");
const targetX = { id: "wholesale:x", productName: "통합 제품", specification: "1kg", purchasePrice: 5360, source: "wholesale" };
const targetY = { id: "manual::y", productName: "다른 제품", specification: "", purchasePrice: 7000, source: "manual" };
const resolvedRow = (platform, key, target, quantity = 1) => ({
  status: "matched",
  platformProductKey: key,
  orderProduct: { platform, displayProductName: "같은 표시명", rawProductName: `${platform} 원본`, rawOptionName: "옵션", platformProductId: key, platformOptionId: "", quantity },
  mapping: { platformProductKey: key, platform, platformProductId: key, platformOptionId: "", rawProductName: `${platform} 원본`, rawOptionName: "옵션", wholesaleProductId: target.id },
  wholesaleProduct: target,
  targetProduct: target,
  prices: { purchasePrice: target.purchasePrice, ...calculateMarketplacePrices(target.purchasePrice) },
});
const mappingsForX = [
  resolvedRow("naver", "naver::100", targetX).mapping,
  resolvedRow("coupang", "coupang::200::300", targetX).mapping,
  resolvedRow("naver", "naver::101", targetX).mapping,
];
const grouped = buildOrderPricingRows([
  resolvedRow("naver", "naver::100", targetX, 2),
  resolvedRow("coupang", "coupang::200::300", targetX, 3),
], mappingsForX);
assertEq(grouped.items.length, 1, "같은 target product id의 네이버·쿠팡 행 통합");
assertEq(grouped.items[0].quantity, 5, "통합 행 내부 수량 합산");
assertEq(grouped.items[0].sourceOrderProducts[0].rawOptionName, "옵션", "통합 후 원본 옵션 보존");
assertEq(grouped.items[0].platformProductKeys.length, 2, "통합 후 platform product key 보존");
assertEq(grouped.matchedCount, 1, "통합 표시 행 기준 matched count");
assertEq(grouped.items[0].salesPlatforms.join(" · "), "naver · coupang", "전체 mapping 기준 네이버·쿠팡 플랫폼 표시");
assertEq(getSalesPlatformsForProduct(mappingsForX, targetX.id).join(","), "naver,coupang", "같은 플랫폼 mapping 중복 제거");
const afterCoupangUnlink = mappingsForX.filter((mapping) => mapping.platform !== "coupang");
assertEq(getSalesPlatformsForProduct(afterCoupangUnlink, targetX.id).join(","), "naver", "쿠팡 mapping 해제 후 네이버만 표시");
const unmatchedRows = buildOrderPricingRows([
  { status: "unmatched", platformProductKey: "naver::u", orderProduct: { platform: "naver", displayProductName: "같은 표시명", rawProductName: "같은 표시명", rawOptionName: "", quantity: 1 }, mapping: null, prices: null },
  { status: "unmatched", platformProductKey: "coupang::u", orderProduct: { platform: "coupang", displayProductName: "같은 표시명", rawProductName: "같은 표시명", rawOptionName: "", quantity: 1 }, mapping: null, prices: null },
], []);
assertEq(unmatchedRows.items.length, 2, "같은 상품명의 미매칭 플랫폼 상품은 통합하지 않음");
const differentTargets = buildOrderPricingRows([
  resolvedRow("naver", "naver::x", targetX),
  resolvedRow("coupang", "coupang::y", targetY),
], [resolvedRow("naver", "naver::x", targetX).mapping, resolvedRow("coupang", "coupang::y", targetY).mapping]);
assertEq(differentTargets.items.length, 2, "같은 표시명이어도 target product id가 다르면 분리");

console.log("\n=== 제품가격관리 파서 ===");
const priceWb = {
  sheets: [
    {
      name: "BAM2200_ItemPriceData",
      data: [
        ["", "", "", "", "", "품목분류", "품목", "", "", "판매가", "", "", "제안가", "", ""],
        [
          "",
          "",
          "",
          "",
          "",
          "품목명",
          "규격",
          "제조사/수입사",
          "원산지",
          "공급가",
          "부가세",
          "총금액",
          "공급가",
          "부가세",
          "제안가",
        ],
        ["", "", "", "", "", "유자소스", "1kg", "유키", "한국", "5,000", "500", "5,500", "4,200", "420", "4,620"],
        ["", "", "", "", "", "", "", "", "", "9,999", "9", "10,008", "1", "1", "2"],
        ["", "", "", "", "", "참기름", "500ml", "농협", "국내산", "8000", "800", "8800", "7000", "700", "7700"],
      ],
    },
  ],
};
const parsedPrice = parsePriceWorkbook(priceWb);
assertEq(parsedPrice.rows.length, 2, "빈 품목명 행은 건너뛴다");
assertEq(parsedPrice.rows[0].supply, 4200, "제안가 그룹 공급가 (판매가 5000 아님)");
assertEq(parsedPrice.rows[0].vat, 420, "제안가 그룹 부가세");
assertEq(parsedPrice.rows[0].offer, 4620, "제안가 = 공급가+부가세");
assertEq(parsedPrice.rows[0].naver, 5313, "네이버가격 = 제안가×1.15 반올림");
assertEq(parsedPrice.rows[0].coupang, 5775, "쿠팡가격 = 제안가×1.25 반올림");
assertEq(parseWon("4,200"), 4200, "쉼표 금액 파싱");
assert(
  rowMatchesQuery(parsedPrice.rows[0], "유자 소스"),
  "검색은 공백을 무시하고 품목명에 부분 일치"
);
assert(
  rowMatchesQuery(parsedPrice.rows[1], "농협"),
  "제조사 검색"
);

const flatPriceWb = {
  sheets: [
    {
      name: "sheet1",
      data: [
        ["품목명", "규격", "제조사", "원산지", "공급가", "부가세", "공급가", "부가세"],
        ["된장", "1kg", "샘표", "한국", "1000", "100", "800", "80"],
      ],
    },
  ],
};
const flatParsed = parsePriceWorkbook(flatPriceWb);
assertEq(flatParsed.rows[0].supply, 800, "그룹행이 없으면 마지막 공급가(제안가) 사용");
assertEq(flatParsed.rows[0].offer, 880, "그룹행 없을 때 제안가 합산");

console.log("\n=== 날짜별 주문 저장 batch ===");
const savedCustomerA = new Customer({
  name: "고객A",
  phone: "010-0000-0001",
  address: "테스트 주소 1",
  zipcode: "00001",
  deliveryMessage: "문 앞",
  products: mergeProducts([{ name: "상품A 1kg", quantity: 1 }]),
});
const savedCustomerB = new Customer({
  name: "고객B",
  phone: "010-0000-0002",
  address: "테스트 주소 2",
  zipcode: "00002",
  products: mergeProducts([{ name: "상품B 500g", quantity: 2 }]),
});

const batchA = createOrderBatch(
  [savedCustomerA],
  new Date(2026, 8, 28, 9, 15),
  () => "batch-a"
);
assertEq(batchA.id, "batch-a", "첫 batch 저장 ID");
assertEq(batchA.dateKey, "2026-09-28", "첫 batch local date key");
assertEq(batchA.customerCount, 1, "첫 batch 고객 수");
assertEq(batchA.orderProducts.length, 0, "상품 snapshot 없는 기존 저장 호출 호환");

const batchWithProducts = createOrderBatch(
  [savedCustomerA],
  new Date(2026, 8, 28, 10, 20),
  () => "batch-products",
  [...coupangResult.orderRows, naverResult.orderRows[0]]
);
assertEq(batchWithProducts.orderProducts.length, 2, "OrderBatch에 플랫폼 상품 snapshot 저장");
assertEq(batchWithProducts.orderProducts[0].quantity, 3, "OrderBatch 동일 상품 수량 합산 저장");
assert(batchWithProducts.orderProducts.every((item) => !("phone" in item) && !("address" in item)), "OrderBatch 상품 snapshot 개인정보 없음");
const restoredProductBatch = normalizeOrderBatches(JSON.parse(JSON.stringify([batchWithProducts])))[0];
assertEq(restoredProductBatch.orderProducts.length, 2, "OrderBatch 직렬화 후 상품 snapshot 복원");
const restoredLegacyBatch = normalizeOrderBatches([{ id: "legacy", dateKey: "2026-09-28", createdAt: "2026-09-28T00:00:00.000Z", customers: [] }])[0];
assertEq(restoredLegacyBatch.orderProducts.length, 0, "과거 orderProducts 없는 batch 복원");

const pricingProduct = {
  platform: "coupang",
  displayProductName: "같은 표시 상품",
  rawProductName: "원본 상품",
  rawOptionName: "옵션 A",
  platformProductId: "product-1",
  platformOptionId: "option-1",
  quantity: 2,
};
const pricingBatchMorning = createOrderBatch(
  [savedCustomerA],
  new Date(2026, 8, 29, 9, 0),
  () => "pricing-morning",
  [pricingProduct]
);
const pricingBatchAfternoon = createOrderBatch(
  [savedCustomerB],
  new Date(2026, 8, 29, 15, 0),
  () => "pricing-afternoon",
  [
    { ...pricingProduct, quantity: 3 },
    { ...pricingProduct, platformProductId: "product-2", quantity: 1 },
    { ...pricingProduct, platform: "naver", platformProductId: "product-1", quantity: 4 },
  ]
);
const pricingBatchPrevious = createOrderBatch(
  [savedCustomerA],
  new Date(2026, 8, 28, 11, 0),
  () => "pricing-previous",
  [{ ...pricingProduct, quantity: 7 }]
);
const pricingBatches = [batchA, pricingBatchMorning, pricingBatchAfternoon, pricingBatchPrevious];
const productDates = summarizeOrderProductDates(pricingBatches);
assertEq(productDates.length, 2, "orderProducts가 있는 날짜만 조회");
assertEq(productDates[0].dateKey, "2026-09-29", "주문상품 날짜는 가장 최근 날짜 우선");
assertEq(productDates[0].batchCount, 2, "같은 날짜의 상품 포함 batch 수 집계");
assertEq(productDates[0].productCount, 3, "같은 날짜 고유 플랫폼 상품 수 집계");
const pricingDayProducts = getOrderProductsForDate(pricingBatches, "2026-09-29");
assertEq(pricingDayProducts.length, 3, "같은 날짜 여러 batch 상품 합산 및 다른 key 분리");
assertEq(pricingDayProducts.find((item) => item.platform === "coupang" && item.platformProductId === "product-1")?.quantity, 5, "동일 platform key 수량 합산");
assertEq(pricingDayProducts.filter((item) => item.displayProductName === "같은 표시 상품").length, 3, "같은 표시명이라도 productId 또는 platform이 다르면 분리");
assertEq(getOrderProductsForDate(pricingBatches, "2026-09-28")[0]?.quantity, 7, "다른 날짜 주문상품 분리");
assertEq(summarizeOrderProductDates([batchA]).length, 0, "orderProducts 없는 과거 batch 날짜 무시");

const batchB = createOrderBatch(
  [savedCustomerA, savedCustomerB],
  new Date(2026, 8, 28, 14, 32),
  () => "batch-b"
);
const batchNextDay = createOrderBatch(
  [savedCustomerB],
  new Date(2026, 8, 29, 8, 5),
  () => "batch-next"
);
const allBatches = [batchA, batchB, batchNextDay];
assertEq(getBatchesForDate(allBatches, "2026-09-28").length, 2, "같은 날짜 두 번째 batch append");
assertEq(getBatchesForDate(allBatches, "2026-09-28")[0].id, "batch-a", "기존 batch를 덮어쓰지 않음");

const summaries = summarizeOrderBatches(allBatches);
assertEq(summaries[1].customerCount, 3, "날짜별 전체 고객 수 계산");
assertEq(summaries[1].batchCount, 2, "날짜별 batch 수 계산");
assertEq(summaries.length, 2, "여러 날짜 분리 저장");
assertEq(summaries[0].dateKey, "2026-09-29", "최신 날짜 우선 정렬");

const afterBatchDelete = withoutOrderBatch(allBatches, "batch-b");
assertEq(afterBatchDelete.length, 2, "batch 하나만 삭제");
const afterBatchSummary = summarizeOrderBatches(afterBatchDelete).find(
  (item) => item.dateKey === "2026-09-28"
);
assertEq(afterBatchSummary?.customerCount, 1, "batch 삭제 후 고객 수 갱신");
assertEq(afterBatchSummary?.batchCount, 1, "batch 삭제 후 batch 수 갱신");

const customerEntries = getCustomerEntriesForDate(allBatches, "2026-09-28");
assertEq(customerEntries.length, 3, "저장 고객별 batch 위치 조회");
assertEq(customerEntries[1].batchId, "batch-b", "저장 고객의 batch ID 유지");
assertEq(customerEntries[1].customerIndex, 0, "저장 고객의 batch 내 위치 유지");
const afterCustomerDelete = withoutOrderCustomer(allBatches, "batch-b", 0);
assertEq(
  getCustomersForDate(afterCustomerDelete, "2026-09-28").length,
  2,
  "저장 고객 한 명만 삭제"
);
assertEq(
  getBatchesForDate(afterCustomerDelete, "2026-09-28")[1].customerCount,
  1,
  "개별 삭제 후 batch 고객 수 갱신"
);
const afterLastCustomerDelete = withoutOrderCustomer(allBatches, "batch-a", 0);
assertEq(afterLastCustomerDelete.length, 2, "마지막 고객 삭제 시 빈 batch 정리");

const afterDateDelete = withoutOrderDate(allBatches, "2026-09-28");
assertEq(afterDateDelete.length, 1, "날짜 전체 삭제");
assertEq(afterDateDelete[0].dateKey, "2026-09-29", "날짜 삭제가 다른 날짜에 영향 없음");

try {
  createOrderBatch([], new Date(2026, 8, 28), () => "empty");
  assert(false, "빈 고객 배열 저장 방지");
} catch (err) {
  assertEq(err.message, "저장할 고객정보가 없습니다.", "빈 고객 배열 저장 방지");
}

assertEq(
  toLocalDateKey(new Date(2026, 8, 28, 23, 30)),
  "2026-09-28",
  "UTC 변환 없이 local date key 생성"
);
const reloaded = normalizeOrderBatches(JSON.parse(JSON.stringify(allBatches)));
assertEq(reloaded.length, 3, "저장 후 다시 읽기");
const mergedSavedCustomers = getCustomersForDate(reloaded, "2026-09-28");
assertEq(mergedSavedCustomers.length, 3, "여러 batch 고객 데이터 합치기");
assert(mergedSavedCustomers[0] instanceof Customer, "저장 고객을 Customer 모델로 복원");
savedCustomerA.name = "화면에서 변경된 이름";
assertEq(batchA.customers[0].name, "고객A", "저장 batch는 원본 Customer 변경과 분리");
mergedSavedCustomers[0].name = "다시 연 화면에서 변경";
assertEq(batchA.customers[0].name, "고객A", "복원 Customer 변경이 저장 원본을 mutate하지 않음");
assertEq(
  normalizeOrderBatches([{ id: "broken", dateKey: "2026-09-28" }]).length,
  0,
  "손상된 batch 레코드 무시"
);

console.log("\n=== Test 6: 미지원/손상 케이스 메시지 ===");
try {
  ParserFactory.detect({ sheets: [{ name: "a", data: [["x", "y"]] }] });
  assert(false, "미지원 주문서 에러 발생해야 함");
} catch (e) {
  assertEq(e.message, ERROR_MESSAGE.UNSUPPORTED_MALL, "지원하지 않는 주문서입니다.");
}

console.log(`\n=== 결과: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
