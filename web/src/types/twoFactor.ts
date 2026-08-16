/**
 * Phase 7f — TOTP and step-up authentication.
 *
 * Mirrors the backend contract in `backend/src/auth-2fa.js`.
 */

/** Which factor a challenge expects, and which one actually satisfied it. */
export type TwoFactorMethod = 'totp' | 'email' | 'backup_code'

export interface TwoFactorStatus {
  totp_enabled: boolean
  preferred_2fa: 'email' | 'totp'
  totp_enrolled_at: string | null
  backup_codes_remaining: number
}

/**
 * Step one of enrolment. The secret is NOT yet stored server-side — it becomes
 * a credential only once a generated code proves the user scanned it.
 */
export interface TotpSetup {
  secret: string
  provisioning_uri: string
  issuer: string
  account: string
}

export interface TotpEnrolmentResult {
  totp_enabled: true
  totp_enrolled_at: string
  /** Shown to the user exactly once — no endpoint can return these again. */
  backup_codes: string[]
  backup_codes_remaining: number
}

export interface StepUpChallenge {
  challenge_id: string
  method: Extract<TwoFactorMethod, 'totp' | 'email'>
  expires_at: string
}

export interface StepUpResult {
  elevated_token: string
  expires_in: number
  expires_at: string
  factor_used: TwoFactorMethod
}

/**
 * What `login` returns when the password was right but the account has a
 * second factor. No session is issued until the challenge is redeemed.
 */
export interface TwoFactorRequired {
  status: '2fa_required'
  challenge_id: string
  method: Extract<TwoFactorMethod, 'totp' | 'email'>
}

export type LoginOutcome = { status: 'signed_in' } | TwoFactorRequired

/** Error code the backend uses on a 401 when a route demands elevation. */
export const STEP_UP_REQUIRED = 'step_up_required'
