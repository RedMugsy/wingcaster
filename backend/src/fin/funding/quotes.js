/**
 * Pure quote: does not persist. Snapshot hash lets confirm re-verify.
 */
import { CATEGORY, finError } from '../errors.js'
import { sha256Canonical } from '../metering/hash.js'
import { getCreditProduct, isProductActive } from './products.js'
import { asUnits, unitsString } from './units.js'
import { iso } from './helpers.js'

export function productSnapshotHash(product) {
  return sha256Canonical({
    id: product.id,
    code: product.code,
    units: unitsString(product.units),
    bonus_units: unitsString(product.bonus_units ?? product.bonusUnits ?? 0),
    price_minor: unitsString(product.price_minor ?? product.priceMinor),
    currency: product.currency,
    effective_from: iso(product.effective_from || product.effectiveFrom),
    effective_to: product.effective_to ?? product.effectiveTo ?? null,
    active: product.active !== false,
  })
}

export function quoteFromProduct(product, {
  holderId, currency, promo, now,
} = {}) {
  if (!product) {
    throw finError('FIN_PRODUCT_NOT_FOUND', { category: CATEGORY.PRECONDITION, httpStatus: 404 })
  }
  if (!isProductActive(product, now)) {
    throw finError('FIN_PRODUCT_NOT_FOUND', { category: CATEGORY.PRECONDITION, httpStatus: 404 })
  }
  const quoteCurrency = currency || product.currency
  if (quoteCurrency !== product.currency) {
    throw finError('QUOTE_INVALID', {
      category: CATEGORY.VALIDATION,
      details: { currency: quoteCurrency, product_currency: product.currency },
    })
  }
  const units = asUnits(product.units)
  const bonusUnits = asUnits(product.bonus_units ?? product.bonusUnits ?? 0)
  const priceMinor = asUnits(product.price_minor ?? product.priceMinor)
  if (units <= 0n || priceMinor <= 0n) {
    throw finError('QUOTE_INVALID', { category: CATEGORY.VALIDATION })
  }
  const promoBonus = promo?.bonus_units ?? promo?.bonusUnits ?? 0
  const totalBonus = bonusUnits + asUnits(promoBonus)
  const snapshot = {
    product_id: product.id,
    product_code: product.code,
    units: unitsString(units),
    bonus_units: unitsString(totalBonus),
    price_minor: unitsString(priceMinor),
    currency: quoteCurrency,
    holder_id: holderId || null,
    product_row_hash: productSnapshotHash(product),
    quoted_at: iso(now),
  }
  return {
    units: unitsString(units),
    bonus_units: unitsString(totalBonus),
    price_minor: unitsString(priceMinor),
    currency: quoteCurrency,
    price_snapshot: snapshot,
  }
}

export async function quoteProduct(input) {
  const productId = input.productId || input.product_id
  const product = input.product || await getCreditProduct(input.client, productId)
  return quoteFromProduct(product, {
    holderId: input.holderId || input.holder_id,
    currency: input.currency,
    promo: input.promo,
    now: input.now,
  })
}
