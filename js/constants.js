/**
 * 앱 전역 상수 (매직 넘버·하드코딩 문자열 중앙 관리)
 */

/** 네이버 주문서 기본 비밀번호 */
export const NAVER_PASSWORD = "1108";

/** 고객 블록 구분선 */
export const CUSTOMER_SEPARATOR = "-------------------";

/** 피킹용 구분선 */
export const PICKING_SEPARATOR = "----------------";

/** 검색 debounce (ms) */
export const SEARCH_DEBOUNCE_MS = 300;

/** 테마 저장 키 — 개인정보가 아닌 UI 설정만 허용 */
export const THEME_STORAGE_KEY = "oce-theme";

/** 지원 확장자 */
export const SUPPORTED_EXTENSIONS = Object.freeze(["xls", "xlsx"]);

/** 출력 모드 */
export const OUTPUT_MODE = Object.freeze({
  BASIC: "basic",
  DELIVERY: "delivery",
  PICKING: "picking",
});

/** 사용자 친화 에러 메시지 */
export const ERROR_MESSAGE = Object.freeze({
  UNSUPPORTED_MALL: "지원하지 않는 주문서입니다.",
  INVALID_PASSWORD: "비밀번호가 올바르지 않습니다.",
  CORRUPTED_FILE: "손상된 Excel 파일입니다.",
  NO_ORDER_DATA: "주문 데이터가 없습니다.",
  NO_FILE: "파일이 선택되지 않았습니다.",
  UNSUPPORTED_FORMAT: "지원하지 않는 파일 형식입니다. .xls 또는 .xlsx 파일을 올려주세요.",
  COPY_EMPTY: "복사할 내용이 없습니다.",
  DOWNLOAD_EMPTY: "다운로드할 내용이 없습니다.",
  COPY_FAIL: "클립보드 복사에 실패했습니다.",
  OPEN_FAIL: "파일을 열 수 없습니다.",
});
