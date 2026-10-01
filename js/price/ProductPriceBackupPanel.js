import { createBackup, downloadBackup, MAX_BACKUP_BYTES, parseBackup, readPriceData } from './productPriceBackupService.js'
import { analyzeMerge, executeMerge } from './productPriceMergeService.js'

const labels = { wholesaleProducts: '회원2가 제품', manualProducts: '직접등록 제품', mappings: '상품 매칭', wholesaleMetadata: '회원2가 등록 정보' }
/** All external strings are displayed as text. */
export function renderProductPriceBackupPanel(host, { onMerged }) {
  let alive = true
  let busy = false
  let plan = null
  let choices = {}
  let sequence = 0
  const listeners = []
  host.innerHTML = `<section class="panel"><div class="result-header"><h2 class="result-title">제품 데이터 백업</h2><div class="d-flex gap-2"><button type="button" class="btn btn-outline-secondary btn-sm" data-export>백업 내보내기</button><button type="button" class="btn btn-outline-secondary btn-sm" data-import>병합 가져오기</button></div></div><p class="small">회원2가 제품·직접등록 제품·상품 매칭을 JSON으로 옮깁니다. 주문 고객정보는 포함하지 않습니다.</p><input type="file" accept=".json,application/json" data-file hidden><p data-status role="status" aria-live="polite"></p></section><dialog class="product-mapping-dialog" data-preview><h2>제품가격관리 데이터 병합</h2><div data-summary></div><p class="small">충돌은 각각 선택해주세요. 다른 ID의 중복 후보와 연결끊김 매칭은 보존됩니다. 회원2가 등록 정보는 선택한 파일 정보를 유지하고 제품 수만 병합 결과로 갱신합니다.</p><div data-conflicts></div><p data-error class="text-danger" role="alert"></p><div class="product-mapping-footer"><button type="button" class="btn btn-outline-secondary" data-cancel>취소</button><button type="button" class="btn btn-primary" data-merge>병합 실행</button></div></dialog>`
  const get = selector => host.querySelector(selector)
  const dialog = get('[data-preview]')
  const fileInput = get('[data-file]')
  const merge = get('[data-merge]')
  const cancel = get('[data-cancel]')
  function on(node, event, handler) { node.addEventListener(event, handler); listeners.push(() => node.removeEventListener(event, handler)) }
  function status(message) { if (alive) get('[data-status]').textContent = message }
  function setBusy(value) {
    busy = value
    get('[data-export]').disabled = value
    get('[data-import]').disabled = value
    cancel.disabled = value
    merge.disabled = value || !plan || plan.conflicts.some((_, index) => !choices[index])
  }
  function text(tag, value, className = '') {
    const node = document.createElement(tag)
    node.textContent = value
    node.className = className
    return node
  }
  function describe(conflict, value, side) {
    if (conflict.group === 'wholesaleMetadata') return `${value.fileName} · ${new Date(value.importedAt).toLocaleString('ko-KR')} · ${value.productCount}개 · 제외 ${value.excludedCount} · 중복 ${value.duplicateCount}`
    if (conflict.group !== 'mappings') return `${value.productName} / ${value.specification || '규격 없음'} / ${value.purchasePrice.toLocaleString('ko-KR')}원`
    const data = side === 'local' ? plan.current : plan.incoming
    const product = [...data.wholesaleProducts, ...data.manualProducts].find(item => item.id === value.wholesaleProductId)
    return product ? `${product.productName} / ${product.specification || '규격 없음'} / ${product.purchasePrice.toLocaleString('ko-KR')}원` : `연결끊김 (${value.wholesaleProductId})`
  }
  function preview() {
    const summary = get('[data-summary]')
    summary.replaceChildren()
    for (const [group, stats] of Object.entries(plan.stats)) summary.append(text('p', `${labels[group]}: 현재 ${stats.current}개 / 가져온 데이터 ${stats.incoming}개 · 신규 ${stats.added} · 동일 ${stats.identical} · 충돌 ${stats.conflicts}`))
    summary.append(text('p', `직접등록 제품 중복 후보: ${plan.duplicateCandidates}개 그룹 (모두 유지)`))
    const conflicts = get('[data-conflicts]')
    conflicts.replaceChildren()
    plan.conflicts.forEach((conflict, index) => {
      const section = document.createElement('section')
      section.className = 'panel'
      section.append(text('h3', `${labels[conflict.group]} 충돌`, 'h6'))
      if (conflict.group === 'mappings') section.append(text('p', `${conflict.local.platform === 'naver' ? '네이버' : '쿠팡'} · ${conflict.local.rawProductName} / ${conflict.local.rawOptionName}`))
      for (const [side, label] of [['local', '현재 PC 유지'], ['incoming', '가져온 데이터 적용']]) {
        const row = document.createElement('label')
        row.className = 'd-block mb-2'
        const radio = document.createElement('input')
        radio.type = 'radio'; radio.name = `backup-conflict-${index}`; radio.value = side
        radio.addEventListener('change', () => { choices[index] = side; setBusy(false) })
        row.append(radio, document.createTextNode(` ${label} → ${describe(conflict, side === 'local' ? conflict.local : conflict.incoming, side)}`))
        section.append(row)
      }
      conflicts.append(section)
    })
    get('[data-error]').textContent = ''
    setBusy(false)
    dialog.showModal()
  }
  on(get('[data-export]'), 'click', async () => {
    if (busy) return
    setBusy(true)
    try { const backup = createBackup(await readPriceData()); if (alive) { downloadBackup(backup); status('백업 파일을 내보냈습니다.') } }
    catch (error) { status(error.message || '백업을 내보내지 못했습니다.') }
    finally { if (alive) setBusy(false) }
  })
  on(get('[data-import]'), 'click', () => { if (!busy) fileInput.click() })
  on(fileInput, 'change', async () => {
    const file = fileInput.files?.[0]
    fileInput.value = ''
    if (!file || busy) return
    const request = ++sequence
    setBusy(true)
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('백업 파일은 20MB 이하만 가능합니다.')
      const backup = parseBackup(await file.text())
      const current = await readPriceData()
      if (!alive || request !== sequence) return
      plan = analyzeMerge(current, backup.data)
      choices = {}
      preview()
    } catch (error) { status(error.message || '백업 파일을 읽지 못했습니다.') }
    finally { if (alive) setBusy(false) }
  })
  on(cancel, 'click', () => { if (!busy) { dialog.close(); plan = null; choices = {} } })
  on(dialog, 'cancel', event => { if (busy) event.preventDefault(); else { plan = null; choices = {} } })
  on(merge, 'click', async () => {
    if (busy || !plan || merge.disabled) return
    setBusy(true)
    let saved = false
    try {
      await executeMerge(plan, choices)
      saved = true
      if (!alive) return
      dialog.close(); plan = null; choices = {}
      await onMerged()
      status('병합 완료. 제품 목록과 현재 주문 날짜의 가격표를 갱신했습니다.')
    } catch (error) {
      if (alive) {
        if (saved) status('병합은 저장되었지만 화면 갱신에 실패했습니다. 제품가격관리 화면을 다시 열어주세요.')
        else get('[data-error]').textContent = error.message || '병합에 실패했습니다.'
      }
    } finally { if (alive) setBusy(false) }
  })
  return () => { alive = false; sequence++; listeners.forEach(remove => remove()); if (dialog.open) dialog.close() }
}
