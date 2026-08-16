/**
 * Send a platform notification through the shared transport, resolving
 * the template from the database with a hardcoded-copy fallback.
 *
 * The public seam every existing send site (OTP, welcome, etc.) collapses
 * onto in commit 4. Callers stop knowing which provider is configured,
 * stop rendering their own copy, and stop needing to touch email.js
 * directly — they name a template code and hand over the variables.
 *
 * ---------------------------------------------------------------------------
 * Fallback semantics
 * ---------------------------------------------------------------------------
 *
 * A hardcoded `fallback` argument is used when:
 *
 *   * the template code is not present in the database (accidentally
 *     deleted seed, first run before migrations, resolver returned null);
 *   * the template exists but rendering blows up on a required variable
 *     the caller failed to supply.
 *
 * This is defence, not a happy path: the platform admin CAN edit any
 * seed template (bumping the version), but they CANNOT delete it. A
 * missing template therefore means something has gone wrong at the DB
 * level, and OTP/welcome must still leave the building. The metric
 * `used_fallback` on the return value lets us alert on how often this
 * fires — a non-zero baseline is a red flag.
 *
 * A caller with no fallback and no template gets a hard error rather
 * than a silent no-op. That is deliberate for auth codes: dropping an
 * OTP silently would look like a working platform until a user tries to
 * verify.
 */

import { resolveTemplate } from './resolver.js'
import { renderTemplate, findUnknownVariables } from './variables.js'
import { sendEmail } from '../../lib/notifications/email.js'
import logger from '../../lib/logger.js'

/**
 * @param {object} args
 * @param {string} args.code - stable template code
 * @param {string} args.to - recipient (email address; other channels TBD)
 * @param {object} [args.variables={}] - substituted into the template
 * @param {string} [args.language='en'] - preferred language for the resolver
 * @param {string} [args.territoryId] - territory to prefer, if any
 * @param {object} [args.fallback] - hardcoded {subject, html, text} used when
 *   the template is missing or rendering fails. If absent, this function
 *   throws PLATFORM_TEMPLATE_MISSING rather than sending nothing.
 * @param {string} [args.replyTo]
 * @returns {Promise<{
 *   sent: true,
 *   provider: string,
 *   provider_message_id: string|null,
 *   used_template_id: string|null,
 *   used_fallback: boolean,
 *   unknown_variables?: string[]
 * }>}
 */
export async function sendPlatformNotification({ code, to, variables = {}, language, territoryId, fallback, replyTo } = {}) {
  if (!code) throw Object.assign(new Error('code is required'), { code: 'MISSING_CODE' })
  if (!to) throw Object.assign(new Error('to is required'), { code: 'MISSING_RECIPIENT' })

  const template = await resolveTemplate({ code, language, territoryId }).catch((err) => {
    logger.warn({ err: err.message, code }, 'platform-template: resolver failed; will attempt fallback')
    return null
  })

  const useFallback = (reason) => {
    if (!fallback) {
      const err = new Error(`No template found for code='${code}' and no fallback provided (reason=${reason})`)
      err.code = 'PLATFORM_TEMPLATE_MISSING'
      err.template_code = code
      err.reason = reason
      throw err
    }
    return sendWithPayload({
      subject: fallback.subject,
      html: fallback.html,
      text: fallback.text,
      to,
      replyTo,
    }).then((result) => ({
      ...result,
      used_template_id: null,
      used_fallback: true,
    }))
  }

  if (!template) {
    logger.warn({ code, language, territoryId }, 'platform-template: no active template found, using fallback')
    return useFallback('template_not_found')
  }

  // Render — a broken template (e.g. a caller failed to supply a
  // required variable) is caught here and drops through to fallback
  // rather than silently sending a message with blanks where a name
  // should be.
  let rendered
  try {
    rendered = renderTemplate(template, variables)
  } catch (err) {
    logger.warn({ err: err.message, code, template_id: template.id }, 'platform-template: render failed, using fallback')
    return useFallback('render_failed')
  }

  const unknown = findUnknownVariables(
    { subject: template.subject, html_body: template.html_body, text_body: template.text_body },
    template.required_variables || [],
    template.optional_variables || [],
  )
  if (unknown.length) {
    // Non-fatal — the template referenced variables the caller didn't
    // provide. They render as blank. Log so the admin can be shown a
    // warning in the UI, but do not block the send.
    logger.info({ code, template_id: template.id, unknown }, 'platform-template: referenced unknown variables; rendered blank')
  }

  const result = await sendWithPayload({
    subject: rendered.subject,
    html: rendered.html_body,
    text: rendered.text_body,
    to,
    replyTo,
  })

  return {
    ...result,
    used_template_id: template.id,
    used_fallback: false,
    ...(unknown.length ? { unknown_variables: unknown } : {}),
  }
}

async function sendWithPayload({ subject, html, text, to, replyTo }) {
  const result = await sendEmail({
    to,
    subject,
    body: text || undefined,
    html: html || undefined,
    replyTo,
  })
  return {
    sent: true,
    provider: result.provider,
    provider_message_id: result.provider_message_id || null,
  }
}
