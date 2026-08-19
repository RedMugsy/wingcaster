/**
 * Deterministic SHA-256 over canonical JSON (key-sorted, RFC 8785 subset).
 */
import { createHash } from 'node:crypto'

export function canonicalJson(value) {
  if (value === null || value === undefined) return 'null'
  const type = typeof value
  if (type === 'boolean') return value ? 'true' : 'false'
  if (type === 'number') {
    if (!Number.isFinite(value)) return 'null'
    return JSON.stringify(value)
  }
  if (type === 'bigint') return JSON.stringify(value.toString())
  if (type === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  }
  if (type === 'object') {
    const keys = Object.keys(value).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(String(value))
}

export function sha256Canonical(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}
