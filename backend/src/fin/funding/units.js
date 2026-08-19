/**
 * Atomic credit units. Money is BIGINT minor units.
 * Callers pass atomic BIGINT units; this constant is the scale, not a converter.
 * Stage 1 insertPostingPair still uses JS unary minus — keep values
 * Number-safe until a Stage 1 follow-up (DL-097).
 */
export const UNIT_SCALE = 1_000_000n

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER)

export function asUnits(value) {
  if (value == null || value === '') return 0n
  if (typeof value === 'bigint') return value
  return BigInt(value)
}

export function asMinor(value) {
  return asUnits(value)
}

/** Stage 1 write.js boundary. Throws rather than silently rounding. */
export function toSqlInt(value) {
  const units = asUnits(value)
  if (units > MAX_SAFE || units < -MAX_SAFE) {
    throw new Error('UNIT_SCALE value exceeds Number.MAX_SAFE_INTEGER (DL-097)')
  }
  return Number(units)
}

export function unitsString(value) {
  return asUnits(value).toString()
}
