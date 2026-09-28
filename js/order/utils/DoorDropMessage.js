/**
 * 배송 장소를 문 앞에 두라는 요청만 담긴 메시지인지 판별한다.
 * 추가 행동 요청이나 배송 정보가 조금이라도 있으면 false를 반환한다.
 *
 * @param {string} message
 * @returns {boolean}
 */
export function isDoorDropOnlyMessage(message) {
  const normalized = String(message || "").replace(/\s+/g, "").trim();
  if (!normalized) return false;

  const politeRequest =
    "(?:세요|주세요|주십시오|부탁(?:드립니다|드려요|해요)|해주세요|해주십시오)";
  const dropAction = `(?:놔두|놓(?:아)?|놔|두)(?:고가)?${politeRequest}`;
  const placeRequest = `(?:배송|배달)?${politeRequest}`;

  return new RegExp(`^(?:문|집)앞(?:에)?(?:${dropAction}|${placeRequest})?$`).test(
    normalized
  );
}
