/** Stable command errors — B §23. Do not invent codes. */

export const CATEGORY = {
  VALIDATION: 'VALIDATION',
  CONFLICT: 'CONFLICT',
  PRECONDITION: 'PRECONDITION',
  INSUFFICIENT: 'INSUFFICIENT',
  CONTROL: 'CONTROL',
  APPROVAL: 'APPROVAL',
  IDEMPOTENCY: 'IDEMPOTENCY',
  CONSERVATION: 'CONSERVATION',
}

export class FinError extends Error {
  constructor(code, {
    category,
    retryable = false,
    httpStatus = 400,
    details = null,
    retryAfter = null,
  } = {}) {
    super(code)
    this.name = 'FinError'
    this.code = code
    this.category = category
    this.retryable = retryable
    this.httpStatus = httpStatus
    this.details = details
    this.retryAfter = retryAfter
  }

  toJSON() {
    return {
      code: this.code,
      category: this.category,
      retryable: this.retryable,
      customer_actionable: false,
      support_reference: this.code,
      safe_message: this.code,
      ...(this.details ? { details: this.details } : {}),
    }
  }
}

export function finError(code, opts) {
  return new FinError(code, opts)
}
