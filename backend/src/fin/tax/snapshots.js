/**
 * tax_snapshots writer helper. Stage 10 ISSUE consumes it.
 * Do not call from Stage 9 command paths.
 */
import { randomUUID } from 'node:crypto'
import { BusinessClock } from '../clock.js'
import { CATEGORY, finError } from '../errors.js'

const TREATMENTS = new Set([
  'STANDARD', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE', 'REVERSE_CHARGE',
])

export async function insertTaxSnapshot(client, input) {
  const treatment = input.taxTreatment || input.tax_treatment
  const vatBps = Number(input.vatBps ?? input.vat_bps ?? 0)
  if (!TREATMENTS.has(treatment)) {
    throw finError('REASON_CODE_REQUIRED', {
      category: CATEGORY.VALIDATION,
      details: { field: 'tax_treatment' },
    })
  }
  if (treatment === 'STANDARD' && !(vatBps > 0)) {
    throw finError('REASON_CODE_REQUIRED', {
      category: CATEGORY.VALIDATION,
      details: { reason: 'standard_requires_vat_bps' },
    })
  }
  if (treatment !== 'STANDARD' && vatBps !== 0) {
    throw finError('REASON_CODE_REQUIRED', {
      category: CATEGORY.VALIDATION,
      details: { reason: 'non_standard_vat_must_be_zero' },
    })
  }
  const id = randomUUID()
  const now = input.now || BusinessClock.now()
  await client.query(
    `INSERT INTO fin.tax_snapshots (
       id, environment, tenant_id, invoice_id, jurisdiction,
       tax_treatment, vat_bps, tax_minor, provider, provider_ref, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      id,
      input.environment || 'LIVE',
      input.tenantId,
      input.invoiceId,
      input.jurisdiction,
      treatment,
      vatBps,
      String(input.taxMinor ?? input.tax_minor ?? 0),
      input.provider || null,
      input.providerRef || input.provider_ref || null,
      now,
    ],
  )
  return { id }
}
