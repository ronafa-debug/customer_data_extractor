/**
 * 툴 레지스트리 — 신규 Tool은 여기만 추가하면 홈에 노출된다.
 * @typedef {{ id: string, path: string, title: string, description: string, icon: string }} ToolDefinition
 */

/** @type {ToolDefinition[]} */
export const TOOLS = [
  {
    id: "order-extractor",
    path: "/order",
    title: "주문내역 고객정보 추출기",
    description: "쿠팡·네이버 주문 Excel을 고객별 텍스트로 자동 변환합니다.",
    icon: "📦",
  },
  {
    id: "product-extractor",
    path: "/product",
    title: "제품 정보 추출기",
    description: "상품 URL에서 대표·상세·필수정보 이미지를 자동 생성합니다.",
    icon: "🖼",
  },
];
