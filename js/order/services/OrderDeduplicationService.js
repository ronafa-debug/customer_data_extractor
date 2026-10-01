/**
 * 저장된 전체 주문 identity와 파일 내부 중복을 한 번에 제외한다.
 * identity가 없는 행은 legacy 호환을 위해 신규로 취급한다.
 * @param {object[]} batches
 * @param {object[]} orderRows
 */
export function selectNewOrderRows(batches, orderRows) {
  const known = new Set(
    (Array.isArray(batches) ? batches : []).flatMap((batch) =>
      Array.isArray(batch?.orderIdentityKeys) ? batch.orderIdentityKeys : []
    ).map((key) => String(key || "").trim()).filter(Boolean)
  );
  const seen = new Set(known);
  const newRows = [];
  let duplicateCount = 0;
  for (const row of Array.isArray(orderRows) ? orderRows : []) {
    const key = String(row?.orderIdentityKey || "").trim();
    if (key && seen.has(key)) {
      duplicateCount += 1;
      continue;
    }
    if (key) seen.add(key);
    newRows.push(row);
  }
  return { totalCount: Array.isArray(orderRows) ? orderRows.length : 0, newRows, duplicateCount };
}
