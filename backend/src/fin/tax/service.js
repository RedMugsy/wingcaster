/**
 * Tax boundary shim (A §9.3 / G §2.6). Interface only.
 * Stage 10 IssueInvoice calls this. Stage 9 must NOT call it.
 *
 * DL-126: fin.tax_registrations is reserved (A §16b) and is not created here.
 * MANUAL provider uses a documented in-memory default until Stage 10.
 */
export const MANUAL_DEFAULT = {
  vat_bps: 0,
  tax_treatment: 'OUT_OF_SCOPE',
  provider: 'MANUAL',
  memo: 'Stage 9 stub — no fin.tax_registrations; default OUT_OF_SCOPE (DL-126)',
}

export function resolveTax({
  sellerLegalEntityId, buyerJurisdiction, productClass, netMinor, at,
} = {}) {
  const net = BigInt(netMinor ?? 0)
  const vatBps = MANUAL_DEFAULT.vat_bps
  const taxMinor = (net * BigInt(vatBps)) / 10_000n
  return {
    vat_bps: vatBps,
    tax_minor: taxMinor.toString(),
    tax_treatment: MANUAL_DEFAULT.tax_treatment,
    provider: MANUAL_DEFAULT.provider,
    memo: MANUAL_DEFAULT.memo,
    sellerLegalEntityId: sellerLegalEntityId || null,
    buyerJurisdiction: buyerJurisdiction || null,
    productClass: productClass || null,
    at: at || null,
  }
}
