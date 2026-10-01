import { createBackup, readPriceData } from './productPriceBackupService.js'
import { applyPriceDataSnapshot } from './productPriceStore.js'
import { applyMappingSnapshot } from './productMappingStore.js'

export function stableString(value) {
  if (Array.isArray(value)) return `[${value.map(stableString).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableString(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
const same = (a, b) => stableString(a) === stableString(b)
function content(product) {
  return { productName: product.productName, specification: product.specification, purchasePrice: product.purchasePrice }
}
export function analyzeMerge(currentData, incomingData) {
  const current = createBackup(currentData).data
  const incoming = createBackup(incomingData).data
  const conflicts = []
  const stats = {}
  for (const group of ['wholesaleProducts', 'manualProducts', 'mappings']) {
    const key = group === 'mappings' ? 'platformProductKey' : 'id'
    const existing = new Map(current[group].map(item => [item[key], item]))
    stats[group] = { current: existing.size, incoming: incoming[group].length, added: 0, identical: 0, conflicts: 0 }
    for (const item of incoming[group]) {
      const local = existing.get(item[key])
      if (!local) stats[group].added++
      else if (group === 'mappings' ? local.wholesaleProductId === item.wholesaleProductId : same(content(local), content(item))) stats[group].identical++
      else {
        stats[group].conflicts++
        conflicts.push({ group, key: item[key], local, incoming: item })
      }
    }
  }
  if (current.wholesaleMetadata && incoming.wholesaleMetadata && !same(current.wholesaleMetadata, incoming.wholesaleMetadata)) {
    conflicts.push({ group: 'wholesaleMetadata', key: 'current', local: current.wholesaleMetadata, incoming: incoming.wholesaleMetadata })
  }
  // Different IDs remain intact; no mapping is silently reconnected.
  const byContent = new Map()
  for (const item of [...current.manualProducts, ...incoming.manualProducts]) {
    const key = stableString(content(item))
    if (!byContent.has(key)) byContent.set(key, new Set())
    byContent.get(key).add(item.id)
  }
  const duplicateCandidates = [...byContent.values()].filter(ids => ids.size > 1).length
  return { current, incoming, stats, conflicts, duplicateCandidates }
}
export function resolveMerge(plan, choices = {}) {
  const data = {}
  for (const group of ['wholesaleProducts', 'manualProducts', 'mappings']) {
    const key = group === 'mappings' ? 'platformProductKey' : 'id'
    const items = new Map(plan.current[group].map(item => [item[key], item]))
    for (const item of plan.incoming[group]) if (!items.has(item[key])) items.set(item[key], item)
    data[group] = items
  }
  data.wholesaleMetadata = plan.current.wholesaleMetadata || plan.incoming.wholesaleMetadata
  plan.conflicts.forEach((conflict, index) => {
    const choice = choices[index]
    if (choice !== 'local' && choice !== 'incoming') throw new Error('모든 충돌에서 유지할 데이터를 선택해주세요.')
    const selected = choice === 'local' ? conflict.local : conflict.incoming
    if (conflict.group === 'wholesaleMetadata') data.wholesaleMetadata = selected
    else data[conflict.group].set(conflict.key, selected)
  })
  for (const group of ['wholesaleProducts', 'manualProducts', 'mappings']) data[group] = [...data[group].values()]
  // Metadata describes the resulting product count, while retaining chosen import provenance.
  if (data.wholesaleMetadata) data.wholesaleMetadata = { ...data.wholesaleMetadata, productCount: data.wholesaleProducts.length }
  return createBackup(data).data
}
export async function executeMerge(plan, choices) {
  const result = resolveMerge(plan, choices)
  const run = async () => {
    const latest = await readPriceData()
    if (!same(latest, plan.current)) throw new Error('미리보기 이후 데이터가 변경되었습니다. 파일을 다시 선택해주세요.')
    // These databases cannot share an atomic transaction. Compensate a failed
    // mapping commit only if the product snapshot still matches our own write.
    // A browser/process crash between commits remains a cross-DB limitation.
    await applyPriceDataSnapshot(plan.current, result)
    try {
      await applyMappingSnapshot(plan.current.mappings, result.mappings)
    } catch (error) {
      try { await applyPriceDataSnapshot(result, plan.current, true) }
      catch { throw new Error('매칭 저장과 제품 복구에 실패했습니다. 일부 제품이 병합되었을 수 있습니다. 현재 데이터를 백업하고 다시 확인해주세요.') }
      throw new Error(`매칭 저장에 실패하여 제품 변경을 복구했습니다. ${error.message || ''}`)
    }
    return result
  }
  return globalThis.navigator?.locks ? navigator.locks.request('product-price-backup-merge', run) : run()
}
