import { makePlatformProductKey } from '../order/model/StandardOrderRow.js'
import { makeWholesaleProductId } from './productNormalizer.js'
import { loadProductPriceDatabase } from './productPriceStore.js'
import { getAllProductMappings } from './productMappingStore.js'

export const MAX_BACKUP_BYTES = 20 * 1024 * 1024
const MAX_ITEMS = 50000
const fail = () => { throw new Error('제품가격관리 백업 형식이 올바르지 않습니다.') }
function object(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail()
  if (Object.keys(value).some(key => !fields.includes(key))) fail()
}
function string(value, required = false) {
  if (typeof value !== 'string' || value.length > 4096 || (required && !value.trim())) fail()
  return value
}
function number(value, positive = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (positive && value <= 0) || value > Number.MAX_SAFE_INTEGER) fail()
  return value
}
function list(values, transform, key) {
  if (!Array.isArray(values) || values.length > MAX_ITEMS) fail()
  const items = values.map(transform)
  if (new Set(items.map(item => item[key])).size !== items.length) fail()
  return items
}
function product(value, manual) {
  object(value, ['id', 'productName', 'specification', 'purchasePrice', 'source', ...(manual ? ['createdAt', 'updatedAt'] : [])])
  const result = { id: string(value.id, true), productName: string(value.productName, true), specification: string(value.specification), purchasePrice: number(value.purchasePrice, true) }
  if (manual) {
    if (!result.id.startsWith('manual::') || result.id.length <= 8 || value.source !== 'manual') fail()
    Object.assign(result, { source: 'manual', createdAt: number(value.createdAt), updatedAt: number(value.updatedAt) })
  } else {
    if (result.id !== makeWholesaleProductId(result.productName, result.specification) || (value.source !== undefined && value.source !== 'wholesale')) fail()
  }
  return result
}
function metadata(value) {
  if (value === null) return null
  object(value, ['key', 'fileName', 'importedAt', 'productCount', 'excludedCount', 'duplicateCount'])
  if (value.key !== 'current') fail()
  const result = { key: 'current', fileName: string(value.fileName), importedAt: number(value.importedAt) }
  if (!Number.isFinite(new Date(result.importedAt).getTime())) fail()
  for (const key of ['productCount', 'excludedCount', 'duplicateCount']) {
    result[key] = number(value[key])
    if (!Number.isInteger(result[key])) fail()
  }
  return result
}
function mapping(value) {
  const textFields = ['platformProductKey', 'platform', 'platformProductId', 'platformOptionId', 'rawProductName', 'rawOptionName', 'wholesaleProductId']
  object(value, [...textFields, 'createdAt', 'updatedAt'])
  const result = Object.fromEntries(textFields.map(key => [key, string(value[key], ['platformProductKey', 'wholesaleProductId'].includes(key))]))
  if (!['naver', 'coupang'].includes(result.platform) || result.platformProductKey !== makePlatformProductKey(result)) fail()
  result.createdAt = number(value.createdAt)
  result.updatedAt = number(value.updatedAt)
  return result
}
export function validateBackup(value) {
  object(value, ['schemaVersion', 'backupType', 'exportedAt', 'app', 'data'])
  if (value.schemaVersion !== 1) throw new Error('지원하지 않는 백업 schemaVersion입니다. 버전 1 파일을 선택해주세요.')
  if (value.backupType !== 'product-price-data' || value.app !== 'customer_data_extractor') fail()
  if (!/^\d{4}-\d{2}-\d{2}T/.test(string(value.exportedAt)) || !Number.isFinite(Date.parse(value.exportedAt))) fail()
  object(value.data, ['wholesaleProducts', 'wholesaleMetadata', 'manualProducts', 'mappings'])
  return { schemaVersion: 1, backupType: value.backupType, exportedAt: value.exportedAt, app: value.app, data: {
    wholesaleProducts: list(value.data.wholesaleProducts, value => product(value, false), 'id'),
    wholesaleMetadata: metadata(value.data.wholesaleMetadata),
    manualProducts: list(value.data.manualProducts, value => product(value, true), 'id'),
    mappings: list(value.data.mappings, mapping, 'platformProductKey'),
  } }
}
export function createBackup(data, exportedAt = new Date().toISOString()) {
  return validateBackup({ schemaVersion: 1, backupType: 'product-price-data', exportedAt, app: 'customer_data_extractor', data })
}
export function parseBackup(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) throw new Error('백업 파일은 20MB 이하만 가능합니다.')
  let value
  try { value = JSON.parse(text) } catch { throw new Error('JSON 파일을 읽을 수 없습니다.') }
  return validateBackup(value)
}
export async function readPriceData() {
  const [db, mappings] = await Promise.all([loadProductPriceDatabase(), getAllProductMappings()])
  return createBackup({ wholesaleProducts: db.products, wholesaleMetadata: db.metadata, manualProducts: db.manualProducts, mappings }).data
}
export function backupFileName(date = new Date()) {
  const pad = value => String(value).padStart(2, '0')
  return `product-price-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.json`
}
export function downloadBackup(backup) {
  const text = JSON.stringify(validateBackup(backup), null, 2)
  if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) throw new Error('백업 파일이 20MB 제한을 초과합니다.')
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = backupFileName()
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
