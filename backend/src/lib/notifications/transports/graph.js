/**
 * Microsoft Graph email transport.
 *
 * Uses OAuth2 client credentials flow to obtain an application access token,
 * then POSTs to /users/{sender}/sendMail. This is the modern, supported way
 * to send from a Microsoft 365 tenant — SMTP AUTH has been deprecated by
 * Microsoft and is disabled by policy on many tenants, so relying on
 * smtp.office365.com is fragile.
 *
 * ---------------------------------------------------------------------------
 * What you need in Azure (see also docs/runbooks/AZURE_GRAPH_EMAIL_SETUP.md)
 * ---------------------------------------------------------------------------
 *
 *   1. Register a new app in Azure Portal → Entra ID → App registrations
 *   2. Grant it Microsoft Graph → Application permission `Mail.Send`
 *      (NOT delegated — the app sends without a user session)
 *   3. Have an admin click "Grant admin consent" on the permission
 *   4. Create a client secret and record its value once (it never shows again)
 *   5. Set the four env vars listed below
 *
 * OPTIONAL but strongly recommended: an Exchange Application Access Policy
 * scoped to your MAIL_FROM mailbox only. Without this the app can technically
 * send as any mailbox in the tenant; the policy locks it to one identity.
 * Command: `New-ApplicationAccessPolicy -AppId <client-id> -PolicyScopeGroupId
 * <mail-group> -AccessRight RestrictAccess`. Not required for the transport
 * to work — required to sleep at night.
 *
 * ---------------------------------------------------------------------------
 * Environment
 * ---------------------------------------------------------------------------
 *
 *   AZURE_TENANT_ID       — Directory (tenant) ID of the Azure AD tenant
 *   AZURE_CLIENT_ID       — Application (client) ID of the registered app
 *   AZURE_CLIENT_SECRET   — Client secret value (NOT the secret ID)
 *   MAIL_FROM             — Sender mailbox address (must exist in the tenant)
 *
 * Optional:
 *   MAIL_FROM_NAME        — Display name shown alongside MAIL_FROM
 *   GRAPH_SAVE_TO_SENT    — 'true' to keep a copy in the sender's Sent Items;
 *                            defaults to 'false' since a shared service mailbox
 *                            typically shouldn't accumulate every send.
 *
 * ---------------------------------------------------------------------------
 * Error shape
 * ---------------------------------------------------------------------------
 *
 * Every thrown error carries a stable `code` so callers (the dispatcher, the
 * OTP path, the test suite) don't have to grep response bodies:
 *
 *   GRAPH_TOKEN_FAILED    — token endpoint refused the client credentials
 *   GRAPH_SEND_FAILED     — token OK, sendMail returned a non-2xx
 *   GRAPH_MISCONFIGURED   — one of the four required env vars is missing
 */

let cachedToken = null

function normaliseEmail(email) {
  return String(email || '').trim().toLowerCase()
}

/**
 * Resolve config from the environment once per call — the notification path is
 * off the hot path for latency, and reading env each time makes the module
 * safe to import before dotenv has populated process.env.
 */
export function getGraphConfig() {
  return {
    tenantId: process.env.AZURE_TENANT_ID || '',
    clientId: process.env.AZURE_CLIENT_ID || '',
    clientSecret: process.env.AZURE_CLIENT_SECRET || '',
    from: normaliseEmail(process.env.MAIL_FROM || process.env.EMAIL_FROM || ''),
    fromName: process.env.MAIL_FROM_NAME || '',
    saveToSent: process.env.GRAPH_SAVE_TO_SENT === 'true',
  }
}

export function isGraphConfigured() {
  const cfg = getGraphConfig()
  return Boolean(cfg.tenantId && cfg.clientId && cfg.clientSecret && cfg.from)
}

/**
 * Token acquisition + reuse. Tokens are valid for ~60 minutes; we refresh
 * with a 60-second safety margin so a request that begins near expiry cannot
 * cross the boundary.
 */
async function getAccessToken(cfg, { forceRefresh = false } = {}) {
  const now = Date.now()
  if (!forceRefresh && cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.value
  }

  const params = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  })

  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() },
  )
  const data = await res.json().catch(() => ({}))

  if (!res.ok || !data?.access_token) {
    const err = new Error(
      `Microsoft Graph token request failed (${res.status}): ${data?.error_description || data?.error || 'unknown error'}`,
    )
    err.code = 'GRAPH_TOKEN_FAILED'
    err.details = data
    throw err
  }

  const ttl = Number(data.expires_in || 3600) * 1000
  cachedToken = { value: data.access_token, expiresAt: now + ttl }
  return cachedToken.value
}

// Exported for tests.
export function _resetTokenCache() {
  cachedToken = null
}

function toRecipient(email) {
  return { emailAddress: { address: email } }
}

function buildMessage(cfg, { to, subject, body, html, replyTo }) {
  const recipients = Array.isArray(to) ? to : [to]
  const message = {
    subject: subject || '',
    toRecipients: recipients.filter(Boolean).map(toRecipient),
    // Prefer HTML when both are present, since that is the richer format;
    // clients that can't render HTML fall back to the browser view.
    body: html
      ? { contentType: 'HTML', content: html }
      : { contentType: 'Text', content: body || '' },
  }
  if (replyTo) {
    const replies = Array.isArray(replyTo) ? replyTo : [replyTo]
    message.replyTo = replies.filter(Boolean).map(toRecipient)
  }
  if (cfg.fromName) {
    // Graph honours 'from' only when the caller has Send As rights on that
    // mailbox — the app's Mail.Send permission usually satisfies that for
    // the mailbox the app is configured to use.
    message.from = { emailAddress: { address: cfg.from, name: cfg.fromName } }
  }
  return message
}

/**
 * Send one message via Graph. Returns a shape compatible with the other
 * transports in lib/notifications/email.js so the dispatcher does not care
 * which one it is talking to.
 */
export async function sendViaGraph({ to, subject, body, html, replyTo } = {}) {
  const cfg = getGraphConfig()
  if (!isGraphConfigured()) {
    const err = new Error('Microsoft Graph email transport is not configured (need AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, MAIL_FROM)')
    err.code = 'GRAPH_MISCONFIGURED'
    throw err
  }

  const recipient = normaliseEmail(Array.isArray(to) ? to[0] : to)
  if (!recipient) {
    const err = new Error('Recipient email is required')
    err.code = 'MISSING_RECIPIENT'
    throw err
  }
  if (!body?.trim() && !html?.trim()) {
    const err = new Error('Message body or html is required')
    err.code = 'MISSING_BODY'
    throw err
  }

  const message = buildMessage(cfg, { to: recipient, subject, body, html, replyTo })
  const payload = JSON.stringify({ message, saveToSentItems: cfg.saveToSent })
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.from)}/sendMail`

  const attempt = async () => {
    const token = await getAccessToken(cfg)
    return fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: payload,
    })
  }

  let res = await attempt()
  // A cached token can be invalidated server-side (secret rotation, tenant
  // policy change). Retry once with a forced refresh before giving up, so a
  // stale cache does not manifest as a user-visible send failure.
  if (res.status === 401) {
    await getAccessToken(cfg, { forceRefresh: true })
    res = await attempt()
  }

  if (res.status === 202) {
    // Graph sendMail returns 202 Accepted with no body and no message id —
    // the send is asynchronous inside the tenant. Callers get an accepted
    // status; delivery telemetry has to come from a Graph subscription, out
    // of scope for the initial transport.
    return {
      ok: true,
      provider: 'graph',
      provider_message_id: null,
      to: recipient,
      subject: subject || '',
      status: 'accepted',
    }
  }

  const text = await res.text().catch(() => '')
  let parsed = null
  try { parsed = JSON.parse(text) } catch { /* body is not JSON, keep as text */ }
  const graphError = parsed?.error?.code || parsed?.error?.message || text.slice(0, 200)
  const err = new Error(`Microsoft Graph sendMail failed (${res.status}): ${graphError || 'unknown error'}`)
  err.code = 'GRAPH_SEND_FAILED'
  err.status = res.status
  err.details = parsed || text
  throw err
}
