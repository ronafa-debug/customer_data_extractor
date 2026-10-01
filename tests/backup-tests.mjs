import { createBackup, parseBackup, validateBackup, backupFileName } from '../js/price/productPriceBackupService.js'
import { analyzeMerge, resolveMerge } from '../js/price/productPriceMergeService.js'
import { makeWholesaleProductId } from '../js/price/productNormalizer.js'
import { makePlatformProductKey } from '../js/order/model/StandardOrderRow.js'
import { buildOrderPricingRows } from '../js/price/orderProductPricingService.js'
import { calculateMarketplacePrices } from '../js/price/priceCalculator.js'

export function runBackupTests(assert) {
  const equal = (a, b, label) => assert(JSON.stringify(a) === JSON.stringify(b), label)
  const rejects = (fn, label) => { let rejected = false; try { fn() } catch { rejected = true } assert(rejected, label) }
  const wholesale = (name, price = 1000) => ({ id: makeWholesaleProductId(name, '1kg'), productName: name, specification: '1kg', purchasePrice: price })
  const manual = (id, price = 1000) => ({ id: `manual::${id}`, productName: '직접제품', specification: '1kg', purchasePrice: price, source: 'manual', createdAt: 1, updatedAt: 1 })
  const mapping = (id, target) => {
    const value = { platform: 'coupang', platformProductId: id, platformOptionId: 'opt', rawProductName: `상품${id}`, rawOptionName: '', wholesaleProductId: target, createdAt: 1, updatedAt: 1 }
    return { platformProductKey: makePlatformProductKey(value), ...value }
  }
  const data = (products = [], manuals = [], mappings = [], meta = null) => ({ wholesaleProducts: products, manualProducts: manuals, mappings, wholesaleMetadata: meta })
  const p100 = wholesale('제품100'), p200 = wholesale('제품200'), p300 = wholesale('제품300'), p999 = wholesale('제품999'), p400 = wholesale('제품400')
  const pc1 = data([p100, p200, p300], [manual('1')], [mapping('A', p100.id), mapping('B', p200.id), mapping('C', p300.id)])
  const pc2 = data([p200, p999, p400], [manual('1'), manual('2')], [mapping('B', p200.id), mapping('C', p999.id), mapping('D', p400.id)])
  const backup = createBackup(pc2)
  equal(backup.schemaVersion, 1, '정상 versioned 백업 생성')
  rejects(() => createBackup(data([], [{ ...manual('1'), id: 'manual::' }])), '빈 직접등록 ID 거부')
  rejects(() => createBackup(data([], [], [], { key: 'current', fileName: 'bad.xlsx', importedAt: Number.MAX_SAFE_INTEGER, productCount: 0, excludedCount: 0, duplicateCount: 0 })), '잘못된 metadata 날짜 거부')
  equal(parseBackup(JSON.stringify(backup)), backup, 'UTF-8 한글 백업 round trip')
  assert(!/customerName|phone|address|zipcode|deliveryMessage|orderHistory/.test(JSON.stringify(backup)), '제품 전용 백업 PII 없음')
  const plan = analyzeMerge(pc1, pc2)
  equal(plan.stats.mappings.identical, 1, '동일 mapping 중복 제거 분석')
  equal(plan.stats.mappings.added, 1, '신규 mapping 추가 분석')
  equal(plan.stats.mappings.conflicts, 1, '동일 key 다른 target 충돌')
  rejects(() => resolveMerge(plan), '충돌 미선택 시 병합 거부')
  const merged = resolveMerge(plan, { 0: 'local' })
  equal(merged.mappings.length, 4, '서로 다른 mapping 모두 유지')
  equal(merged.mappings.find(item => item.platformProductId === 'C').wholesaleProductId, p300.id, '현재 PC 충돌 선택 적용')
  equal(resolveMerge(plan, { 0: 'incoming' }).mappings.find(item => item.platformProductId === 'C').wholesaleProductId, p999.id, '가져온 충돌 선택 적용')
  equal(plan.stats.manualProducts.identical, 1, '직접등록 동일 ID 중복 제거')
  equal(plan.stats.manualProducts.added, 1, '직접등록 신규 추가')
  equal(plan.duplicateCandidates, 1, '직접등록 의미상 중복 후보 표시')
  equal(merged.manualProducts.length, 2, '중복 후보 ID 및 mapping 보존')
  const manualPlan = analyzeMerge(data([], [manual('1')]), data([], [manual('1', 2000)]))
  equal(manualPlan.stats.manualProducts.conflicts, 1, '직접등록 같은 ID 다른 가격 충돌')
  equal(resolveMerge(manualPlan, { 0: 'incoming' }).manualProducts[0].purchasePrice, 2000, '직접등록 충돌 해결')
  equal(plan.stats.wholesaleProducts.identical, 1, '회원2가 동일 제품 중복 제거')
  equal(plan.stats.wholesaleProducts.added, 2, '회원2가 신규 추가')
  const wholesalePlan = analyzeMerge(data([p100]), data([wholesale('제품100', 3000)]))
  equal(wholesalePlan.conflicts.length, 1, '회원2가 동일 ID 변경 가격 충돌')
  equal(resolveMerge(wholesalePlan, { 0: 'local' }).wholesaleProducts[0].purchasePrice, 1000, '회원2가 현재 가격 보호')
  const stale = mapping('stale', 'wholesale:missing')
  equal(resolveMerge(analyzeMerge(data(), data([], [], [stale]))).mappings[0], stale, 'stale mapping 삭제 없이 보존')
  const reverse = analyzeMerge(pc2, merged)
  const reverseChoices = Object.fromEntries(reverse.conflicts.map((_, i) => [i, 'incoming']))
  const synced = resolveMerge(reverse, reverseChoices)
  equal(synced.mappings.map(item => [item.platformProductKey, item.wholesaleProductId]).sort(), merged.mappings.map(item => [item.platformProductKey, item.wholesaleProductId]).sort(), 'PC1 재백업 → PC2 병합으로 동일 mapping 상태')
  rejects(() => parseBackup('{bad'), 'malformed JSON 거부')
  rejects(() => validateBackup({ ...backup, schemaVersion: 2 }), '지원하지 않는 schemaVersion 거부')
  rejects(() => validateBackup({ ...backup, app: 'other' }), '다른 app 백업 거부')
  rejects(() => validateBackup({ ...backup, backupType: 'orders' }), '다른 backupType 거부')
  rejects(() => createBackup({ ...pc2, customerName: 'PII' }), '알 수 없는 PII 필드 거부')
  rejects(() => createBackup(data([{ ...p100, phone: 'PII' }])), '제품에 포함된 PII 필드 거부')
  rejects(() => parseBackup(JSON.stringify(backup).replace('"data":{', '"data":{"__proto__":{},')), 'prototype pollution key 거부')
  rejects(() => createBackup(data([{ ...p100, purchasePrice: '1000' }])), '문자열 가격 거부')
  rejects(() => createBackup(data([{ ...p100, purchasePrice: -1 }])), '음수 가격 거부')
  rejects(() => createBackup(data([{ ...p100, purchasePrice: NaN }])), 'NaN 가격 거부')
  rejects(() => createBackup(data([p100, p100])), '중복 ID를 포함한 파일 거부')
  rejects(() => createBackup(data([], [], [{ ...stale, platformProductKey: 'wrong' }])), '불일치 mapping key 거부')
  rejects(() => createBackup(data([], [], [{ ...stale, platform: 'other' }])), '잘못된 mapping platform 거부')
  rejects(() => createBackup(data(Array(50001).fill(p100))), '비정상적으로 큰 배열 거부')
  rejects(() => parseBackup(' '.repeat(20 * 1024 * 1024 + 1)), '20MB 초과 파일 거부')
  const xss = '<img src=x onerror=alert(1)>'
  equal(createBackup(data([wholesale(xss)])).data.wholesaleProducts[0].productName, xss, 'HTML 문자열은 데이터로 보존 (DOM 안전성 브라우저 검증)')
  const meta = { key: 'current', fileName: '회원.xlsx', importedAt: 1, productCount: 1, excludedCount: 0, duplicateCount: 0 }
  const metaPlan = analyzeMerge(data([p100], [], [], meta), data([p200], [], [], { ...meta, fileName: '다른.xlsx' }))
  equal(metaPlan.conflicts.length, 1, '다른 회원2가 metadata는 사용자 선택')
  const metaResult = resolveMerge(metaPlan, { 0: 'incoming' })
  equal(metaResult.wholesaleMetadata.fileName, '다른.xlsx', '선택한 metadata 출처 유지')
  equal(metaResult.wholesaleMetadata.productCount, 2, 'metadata 제품 수는 병합 결과 반영')
  const prices = calculateMarketplacePrices(p300.purchasePrice)
  assert(prices.naverPrice > 0 && prices.coupangPrice > 0, '병합 제품 기존 가격 계산 정상')
  const order = { platform: 'coupang', platformProductId: 'C', platformOptionId: 'opt', rawProductName: '상품C', quantity: 1 }
  const resolution = { status: 'matched', platformProductKey: makePlatformProductKey(order), orderProduct: order, mapping: merged.mappings.find(item => item.platformProductId === 'C'), targetProduct: p300, wholesaleProduct: p300, prices: { purchasePrice: p300.purchasePrice, ...prices } }
  const pricing = buildOrderPricingRows([resolution], merged.mappings)
  assert(pricing.items.length === 1 && pricing.items[0].prices.purchasePrice === 1000, '병합 mapping/pricing 연결 정상')
  equal(backupFileName(new Date(2026, 9, 1, 14, 30)), 'product-price-backup-2026-10-01-1430.json', '로컬 날짜 파일명')
}
