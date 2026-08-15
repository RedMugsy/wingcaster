# Phase 7f (planned) — TOTP + Step-Up Authentication

**Status:** design captured, not yet implemented. Blocked by Phase 7b.1c closure.

**User intent (2026-08-15):**
> OTP first for first signup. Then OTP or TOTP for signin and transaction approval.

Phase 7b.1c/16d ships real email-OTP for signup. This document captures the design for what comes next.

---

## Model

Two independent OTP-shaped mechanisms coexist:

| Mechanism | When | Delivery | Notes |
|---|---|---|---|
| **Email OTP** | Signup, sign-in fallback, step-up fallback | SMTP (nodemailer) | Already shipped in 7b.1c/16d |
| **TOTP** | Sign-in primary, step-up primary | Authenticator app (Google Auth / Authy / 1Password / etc.) | New in 7f |

A user picks a **primary factor** in settings. Email OTP is always available as the fallback so a lost phone doesn't lock the account out.

## Data model

**New column on `users`:**
```sql
ALTER TABLE users ADD COLUMN totp_secret_encrypted TEXT;   -- base32, AES-GCM encrypted via credentials.js
ALTER TABLE users ADD COLUMN totp_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN totp_enrolled_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN preferred_2fa VARCHAR(20) NOT NULL DEFAULT 'email';  -- 'email' | 'totp'
```

**New table `user_backup_codes`** (single-use recovery when phone is lost):
```sql
CREATE TABLE user_backup_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,   -- bcrypt hash of a random 8-char alphanumeric
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```
User gets 10 backup codes at TOTP enrollment. Any single-use.

## Endpoints

**Enrollment:**
- `POST /api/auth/2fa/totp/setup` → generates a base32 secret + provisioning URI (`otpauth://totp/Wingcaster:{email}?secret=...&issuer=Wingcaster`). Returns `{ secret, qr_url, provisioning_uri }`. Secret is NOT persisted yet — user must prove they scanned it.
- `POST /api/auth/2fa/totp/verify` → body `{ secret, code }`. Verifies the code against the secret. On success: writes `totp_secret_encrypted` (via `credentials.js` AES-GCM), sets `totp_enabled=true`, generates + returns 10 backup codes (bcrypt-hashed, plaintext returned once).
- `POST /api/auth/2fa/totp/disable` → requires current TOTP code OR email OTP. Clears secret + enabled flag.

**Sign-in flow (updated):**
1. `POST /api/auth/login` — email + password.
2. If password OK and user has 2FA enabled:
   - Return 200 `{ status: '2fa_required', method: user.preferred_2fa, challenge_id }`. NO JWT yet.
   - If method=`totp`: user reads code from authenticator, calls `/api/auth/2fa/challenge`.
   - If method=`email`: server sends email OTP, user reads from inbox, calls same endpoint.
3. `POST /api/auth/2fa/challenge` — body `{ challenge_id, code }`. Verifies against TOTP secret OR email OTP. On success, issues JWT.

**Step-up for sensitive actions:**
- Client requests `POST /api/auth/step-up` before the sensitive action.
- Server sends email OTP (or requires TOTP if enabled).
- Client submits `POST /api/auth/step-up/verify` with the code, receives a short-lived **elevated token** (15 min TTL, `elevated: true` claim).
- Sensitive endpoint (e.g. `POST /api/billing/credit-topup`, `POST /api/agents/rotate-credentials`, admin operations) requires `elevated: true` in the JWT claim.
- `authMiddleware` adds a helper `requiresElevated` for these endpoints.

## What counts as a sensitive action (initial list)

- Credit top-up (Phase 7e when payment gateway lands)
- Credential rotation (marketplace_connections, API keys)
- Any admin console mutation (create/edit/deactivate territories, zones, rate cards)
- Password change (redundant safety — password change already asks for current password)
- 2FA disable
- Account deletion

## Library choices

- **TOTP:** `otplib` — modern, well-maintained, supports Google Auth + Authy + 1Password.
- **QR code:** `qrcode` — server-side PNG generation for the setup screen; client can also render from the provisioning URI directly.
- **Backup code hashing:** `bcryptjs` (already a dependency).

## Rollout order

1. **7f/1** — TOTP enrollment endpoints + backup codes. Users can enroll but sign-in flow still just password.
2. **7f/2** — Sign-in 2FA challenge flow. `login` returns `2fa_required` when enabled.
3. **7f/3** — Frontend: settings page for enrollment (QR scan + verify + backup codes download), sign-in page 2FA prompt.
4. **7f/4** — Step-up endpoint + `requiresElevated` middleware helper.
5. **7f/5** — Gate the sensitive-action endpoints listed above. Ships alongside Phase 7e (payments) so credit-topup lands with step-up on day one.

## Security notes

- TOTP secrets stored via `credentials.js` AES-GCM (same infrastructure as marketplace_connections). Never logged, never returned after enrollment.
- Backup codes: user sees plaintext ONCE at enrollment; only bcrypt hashes stored. Single-use — mark `used_at` on redemption.
- Challenge IDs are random UUIDs with 5-minute TTL, single-use, single-user. Redemption is atomic (SELECT ... FOR UPDATE, same pattern as `verify-otp` in Prompt 13).
- Rate limit `POST /api/auth/2fa/challenge` at 5 attempts per challenge_id in 15 min (same lockout as email OTP).
- Elevated tokens: 15-min TTL is short enough that a stolen token has limited blast radius. Consider adding IP-binding claim if abuse surfaces.

## Non-goals

- SMS-based OTP (fallback for users without email). Adds carrier cost + phishing/swap risk. Defer indefinitely.
- WebAuthn / passkeys. Better than TOTP long-term but adds significant UI complexity. Consider for Phase 8+.
- Hardware YubiKey. Enterprise-only, out of scope for real-estate agent audience.

## Dependencies on other phases

- **Phase 7b.1c closure** — blocks 7f start (need real OTP transport first, which is done in 16d).
- **Phase 7e (payments)** — 7f/5 gates credit topup with step-up; ship in tandem.
- **Phase 8 (deployment cells)** — TOTP secrets are per-tenant data; must respect residency rules.
