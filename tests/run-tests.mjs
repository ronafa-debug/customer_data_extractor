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
import {
  parsePriceWorkbook,
  parseWon,
  rowMatchesQuery,
} from "../js/price/parsePriceWorkbook.js";

let passed = 0;
let failed = 0;

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

console.log("\n=== Test 6: 미지원/손상 케이스 메시지 ===");
try {
  ParserFactory.detect({ sheets: [{ name: "a", data: [["x", "y"]] }] });
  assert(false, "미지원 주문서 에러 발생해야 함");
} catch (e) {
  assertEq(e.message, ERROR_MESSAGE.UNSUPPORTED_MALL, "지원하지 않는 주문서입니다.");
}

console.log(`\n=== 결과: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
