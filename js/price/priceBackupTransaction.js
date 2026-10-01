// Compare and write within the same DB transaction to protect edits after preview.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
export async function applyBackupTransaction(openDb, groups, rollback = false) {
  const db = await openDb()
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(groups.map(group => group.store), 'readwrite')
      let error = null
      let remaining = groups.length
      const requests = groups.map(group => tx.objectStore(group.store).getAll())
      const ordered = (items, key) => [...items].sort((a, b) => a[key].localeCompare(b[key]))
      function write() {
        try {
          groups.forEach((group, index) => {
            if (canonical(ordered(requests[index].result, group.key)) !== canonical(ordered(group.expected, group.key))) throw new Error('미리보기 이후 데이터가 변경되었습니다. 다시 분석해주세요.')
          })
          groups.forEach(group => {
            const store = tx.objectStore(group.store)
            const expected = new Map(group.expected.map(item => [item[group.key], item]))
            const target = new Set(group.next.map(item => item[group.key]))
            for (const item of group.next) if (canonical(expected.get(item[group.key])) !== canonical(item)) store.put(item)
            // Only compensation removes records created by this attempted merge.
            if (rollback) for (const item of group.expected) if (!target.has(item[group.key])) store.delete(item[group.key])
          })
        } catch (cause) { error = cause; tx.abort() }
      }
      requests.forEach(request => { request.onsuccess = () => { if (--remaining === 0) write() } })
      tx.oncomplete = () => resolve()
      tx.onerror = () => { error ||= tx.error }
      tx.onabort = () => reject(error || tx.error || new Error('백업 병합 트랜잭션이 취소되었습니다.'))
    })
  } finally { db.close() }
}
