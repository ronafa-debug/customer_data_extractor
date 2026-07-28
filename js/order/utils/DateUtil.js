/**
 * 날짜 포맷 유틸
 */

/**
 * YYYY-MM-DD 형식 문자열
 * @param {Date} [date]
 * @returns {string}
 */
export function formatDate(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * 주문정보 TXT 파일명
 * @param {Date} [date]
 * @returns {string}
 */
export function buildOrderTxtFilename(date = new Date()) {
  return `주문정보_${formatDate(date)}.txt`;
}
