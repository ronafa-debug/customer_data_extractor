/**
 * 툴 레지스트리 — 상태에 따라 홈 또는 실험실에 노출한다.
 * @typedef {"stable" | "experimental"} ToolStatus
 * @typedef {{ id: string, path: string, title: string, description: string, icon: string, status: ToolStatus }} ToolDefinition
 */

/** @type {ToolDefinition[]} */
export const TOOLS = [
  {
    id: "order-extractor",
    path: "/order",
    title: "주문내역 고객정보 추출기",
    description: "쿠팡·네이버 주문 Excel을 고객별 텍스트로 자동 변환합니다.",
    icon: "📦",
    status: "stable",
  },
  {
    id: "product-extractor",
    path: "/product",
    title: "제품 정보 추출기",
    description: "상품 URL에서 대표·상세·필수정보 이미지를 자동 생성합니다.",
    icon: "🖼",
    status: "stable",
  },
  {
    id: "price-manager",
    path: "/price",
    title: "제품가격관리",
    description: "품목가격 엑셀에서 제안가·네이버·쿠팡 가격표를 만들고 검색합니다.",
    icon: "₩",
    status: "stable",
  },
  {
    id: "new-price-manager",
    path: "/new-price",
    title: "OCR-제품가격관리",
    description: "영수증 이미지를 인식해 제품과 가격 정보를 확인하고 저장하는 실험 기능입니다.",
    icon: "🧾",
    status: "experimental",
  },
];

/**
 * @param {ToolStatus} status
 * @returns {ToolDefinition[]}
 */
export function getToolsByStatus(status) {
  return TOOLS.filter((tool) => tool.status === status);
}
