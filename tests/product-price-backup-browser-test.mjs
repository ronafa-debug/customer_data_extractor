import { chromium } from 'playwright'
import fs from 'node:fs/promises'

const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:5151'
const browser = await chromium.launch({ headless: true })
let passed = 0
const check = (condition, message) => { if (!condition) throw new Error(message); passed++; console.log(`OK ${message}`) }
try {
  // A new context has its own IndexedDB; never connect to the user's active browser.
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.goto(`${baseUrl}/#/price`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-export]')
  const fixtures = await page.evaluate(async () => {
    const backup = await import('/js/price/productPriceBackupService.js')
    const merge = await import('/js/price/productPriceMergeService.js')
    const { makeWholesaleProductId } = await import('/js/price/productNormalizer.js')
    const { makePlatformProductKey } = await import('/js/order/model/StandardOrderRow.js')
    const p = (name, price = 1000) => ({ id: makeWholesaleProductId(name, '1kg'), productName: name, specification: '1kg', purchasePrice: price })
    const m = (name, target) => { const item = { platform: 'coupang', platformProductId: name, platformOptionId: 'opt', rawProductName: name, rawOptionName: '', wholesaleProductId: target, createdAt: 1, updatedAt: 1 }; return { platformProductKey: makePlatformProductKey(item), ...item } }
    const a = p('제품100'), b = p('제품200'), c = p('제품300'), other = p('제품999'), d = p('<img src=x onerror="window.backupXss=true">')
    const manual = { id: 'manual::shared', productName: '직접제품', specification: '1kg', purchasePrice: 1000, source: 'manual', createdAt: 1, updatedAt: 1 }
    const local = { wholesaleProducts: [a, b, c], wholesaleMetadata: null, manualProducts: [manual], mappings: [m('A', a.id), m('B', b.id), m('C', c.id)] }
    const incoming = { wholesaleProducts: [b, other, d], wholesaleMetadata: null, manualProducts: [{ ...manual, purchasePrice: 2000 }, { ...manual, id: 'manual::duplicate' }], mappings: [m('B', b.id), m('C', other.id), m('D', d.id), m('stale', 'wholesale:missing')] }
    await merge.executeMerge(merge.analyzeMerge(await backup.readPriceData(), local), {})
    const { saveOrderBatch } = await import('/js/order/services/OrderHistoryStore.js')
    const { Customer } = await import('/js/order/model/Customer.js')
    const customer = new Customer({ name: 'synthetic-private-name', phone: 'synthetic-private-phone', address: 'synthetic-private-address', products: [] })
    await saveOrderBatch([customer], new Date(2026, 9, 1), [{ ...m('C', c.id), quantity: 1, displayProductName: '상품C' }])
    window.fixtures = { local, incoming, c, d }
    return { backup: backup.createBackup(incoming), c, d }
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.querySelector('#productDbCount')?.textContent === '4개')
  check((await page.locator('#orderPriceDate').inputValue()) === '2026-10-01', '선택 주문 날짜 표시')
  const before = await page.evaluate(async () => (await import('/js/price/productPriceBackupService.js')).readPriceData())
  const selectBackup = async () => page.locator('[data-file]').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixtures.backup)) })
  await selectBackup()
  await page.waitForFunction(() => document.querySelector('[data-preview]').open)
  check(await page.locator('[data-merge]').isDisabled(), '충돌 미선택 병합 실행 비활성화')
  check((await page.locator('[data-summary]').textContent()).includes('충돌 1'), '매칭/직접등록 충돌 미리보기')
  check((await page.locator('[data-summary]').textContent()).includes('중복 후보: 1'), '의미상 중복 후보 표시')
  check(JSON.stringify(await page.evaluate(async () => (await import('/js/price/productPriceBackupService.js')).readPriceData())) === JSON.stringify(before), '미리보기에서 DB 쓰기 없음')
  await page.locator('[data-cancel]').click()
  check(JSON.stringify(await page.evaluate(async () => (await import('/js/price/productPriceBackupService.js')).readPriceData())) === JSON.stringify(before), '취소 시 데이터 보존')
  await selectBackup()
  await page.waitForFunction(() => document.querySelector('[data-preview]').open)
  await page.locator('[data-conflicts] section').nth(0).locator('input[value="incoming"]').check()
  check(await page.locator('[data-merge]').isDisabled(), '일부 충돌만 선택하면 실행 비활성화 유지')
  await page.locator('[data-conflicts] section').nth(1).locator('input[value="local"]').check()
  check(await page.locator('[data-merge]').isEnabled(), '모든 충돌 선택 후 실행 활성화')
  await page.locator('[data-merge]').click()
  await page.waitForFunction(() => document.querySelector('[data-status]').textContent.includes('병합 완료'))
  const report = await page.evaluate(async () => {
    const data = await (await import('/js/price/productPriceBackupService.js')).readPriceData()
    const { resolveProductPricing } = await import('/js/price/productMappingService.js')
    return { data, pricing: await resolveProductPricing({ platform: 'coupang', platformProductId: 'C', platformOptionId: 'opt' }), stale: await resolveProductPricing({ platform: 'coupang', platformProductId: 'stale', platformOptionId: 'opt' }), xss: Boolean(window.backupXss) }
  })
  check(report.data.mappings.length === 5, 'A/B/C/D/stale 매칭 보존 및 추가')
  check(report.data.manualProducts.find(p => p.id === 'manual::shared').purchasePrice === 2000, '직접등록 가져온 충돌 적용')
  check(report.data.manualProducts.length === 2, '직접등록 중복 후보 자동 삭제 없음')
  check(report.pricing.targetProduct.id === fixtures.c.id && report.pricing.prices.naverPrice === 1150 && report.pricing.prices.coupangPrice === 1250, '현재 매칭 선택 및 실제 가격 조회 정상')
  check(report.stale.status === 'stale' && report.stale.prices === null, '실제 stale mapping 동작 유지')
  check((await page.locator('#productDbCount').textContent()) === '7개', '병합 후 제품 목록 즉시 갱신')
  check((await page.locator('#orderPriceDate').inputValue()) === '2026-10-01' && (await page.locator('#orderPriceTableBody').textContent()).includes('제품300'), '현재 선택 날짜 주문 가격표 즉시 갱신')
  check(!report.xss && await page.locator('#productDbTableBody img').count() === 0, 'XSS 상품명은 textContent로 표시')
  const downloadEvent = page.waitForEvent('download')
  await page.locator('[data-export]').click()
  const download = await downloadEvent
  const exported = JSON.parse(await fs.readFile(await download.path(), 'utf8'))
  check(exported.schemaVersion === 1 && exported.data.mappings.length === 5, '실제 JSON 다운로드')
  check(!JSON.stringify(exported).includes('synthetic-private'), '주문 DB의 synthetic PII는 다운로드에 포함되지 않음')
  check(/^product-price-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/.test(download.suggestedFilename()), '다운로드 로컬 날짜 파일명')
  await page.locator('[data-file]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{bad') })
  await page.waitForFunction(() => document.querySelector('[data-status]').textContent.includes('JSON 파일'))
  check(!await page.locator('[data-preview]').evaluate(node => node.open), '잘못된 JSON 미리보기 거부')
  const safety = await page.evaluate(async () => {
    const backup = await import('/js/price/productPriceBackupService.js')
    const merge = await import('/js/price/productPriceMergeService.js')
    const store = await import('/js/price/productPriceStore.js')
    const maps = await import('/js/price/productMappingStore.js')
    const normalizer = await import('/js/price/productNormalizer.js')
    const original = await backup.readPriceData()
    const newProduct = { id: normalizer.makeWholesaleProductId('실패 테스트', ''), productName: '실패 테스트', specification: '', purchasePrice: 5000 }
    const newMapping = { ...original.mappings[0], platformProductId: 'failure', platformProductKey: 'coupang::failure::opt', wholesaleProductId: newProduct.id }
    const incoming = { wholesaleProducts: [newProduct], wholesaleMetadata: null, manualProducts: [], mappings: [newMapping] }
    const plan = merge.analyzeMerge(original, incoming)
    // Force a synchronous mapping write failure after the product DB has committed.
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) { if (this.name === 'mappings') throw new DOMException('Injected quota failure', 'QuotaExceededError'); return put.apply(this, args) }
    let failed = false, message = ''
    try { await merge.executeMerge(plan, {}) } catch (error) { failed = true; message = error.message }
    finally { IDBObjectStore.prototype.put = put }
    const restored = await backup.readPriceData()
    const rollback = merge.stableString(original) === merge.stableString(restored)
    // Detect edits after preview, including edits from another DB connection.
    const stalePlan = merge.analyzeMerge(restored, incoming)
    const manual = await store.createManualProduct({ productName: '동시 변경', specification: '', purchasePrice: 1234 })
    let concurrent = false
    try { await merge.executeMerge(stalePlan, {}) } catch (error) { concurrent = error.message.includes('변경') }
    const afterConcurrent = await backup.readPriceData()
    // Guarded store transaction must reject stale expected snapshots too.
    let guarded = false
    try { await store.applyPriceDataSnapshot(restored, merge.resolveMerge(stalePlan, {})) } catch { guarded = true }
    // Product DB writes are all-or-nothing when a later store request fails.
    const atomicPlan = merge.analyzeMerge(afterConcurrent, { ...incoming, manualProducts: [{ ...manual, id: 'manual::failure' }] })
    IDBObjectStore.prototype.put = function (...args) { if (this.name === 'manualProducts') throw new Error('Injected manual write failure'); return put.apply(this, args) }
    let atomicRejected = false
    try { await merge.executeMerge(atomicPlan, {}) } catch { atomicRejected = true }
    finally { IDBObjectStore.prototype.put = put }
    const afterAtomic = await backup.readPriceData()
    // Mapping CAS failure must abort and preserve all existing rows.
    let mappingGuard = false
    try { await maps.applyMappingSnapshot([], original.mappings) } catch { mappingGuard = true }
    return { failed, message, rollback, concurrent, guarded, manualPreserved: afterConcurrent.manualProducts.some(p => p.id === manual.id), atomicRejected, atomicPreserved: merge.stableString(afterAtomic) === merge.stableString(afterConcurrent), mappingGuard }
  })
  check(safety.failed && safety.message.includes('복구'), '매칭 저장 오류가 사용자에게 명확히 전달됨')
  check(safety.rollback, 'cross-database 실패 시 제품/metadata/직접등록 변경 복구')
  check(safety.concurrent && safety.manualPreserved, '미리보기 후 동시 변경 감지 및 변경 보존')
  check(safety.guarded, '쓰기 트랜잭션 내부 비교로 오래된 snapshot 거부')
  check(safety.atomicRejected && safety.atomicPreserved, '제품 DB 다중 store 쓰기 실패 atomic rollback')
  check(safety.mappingGuard, '매칭 DB 변경 보호 transaction')
  await page.reload({ waitUntil: 'networkidle' })
  check((await page.locator('#productDbCount').textContent()) === '8개', 'reload 후 병합 데이터 및 동시 변경 유지')
  if (process.env.BACKUP_SCREENSHOT) await page.screenshot({ path: process.env.BACKUP_SCREENSHOT, fullPage: true })
  console.log(`product price backup browser test: ${passed} passed, 0 failed`)
} finally { await browser.close() }
