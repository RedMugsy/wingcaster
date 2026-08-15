/**
 * WhatsApp Listing pipeline orchestration.
 *
 * Stages:
 *   1. Intake — collect messages/media into a session during a 2-minute window.
 *   2. Intent classification — determine create vs update and matched listing.
 *   3. Credit reservation — reserve estimated credits for extraction + thumbnails + captions.
 *   4. AI extraction — extract structured property data from text + images.
 *   5. Asset generation — select hero image, composite branded thumbnails.
 *   6. Caption generation — platform-optimized captions.
 *   7. Approval — send WhatsApp interactive card with variants and actions.
 *   8. Publish — create/update listing, optionally publish to social channels.
 */

import { v4 as uuidv4 } from 'uuid'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { Collections, insertModule, updateModule, findOneModule } from '../infrastructure/db.js'
import { createStorage } from '../infrastructure/storage.js'
import { createSessionStore } from '../infrastructure/sessions.js'
import { createIntentClassifier } from './intent.js'
import { createListingMatcher } from './matcher.js'
import { DraftStatus, SessionState, Intent, TemplateVariant, SocialPlatform, CreditScope, CreditType, LocationSource } from '../domain/types.js'

export function createPipeline({ adapter, entitlements, credits, aiAdapter, templateEngine, config, logger }) {
  const storage = createStorage({ config, logger })
  const sessions = createSessionStore({ config, logger })
  const classifier = createIntentClassifier({ aiAdapter })
  const matcher = createListingMatcher({ adapter })

  async function ingest({ from, messageId, text, interactiveId, mediaIds, location, messageType, rawPayload }) {
    // NOTE: message_id deduplication happens atomically in the webhook layer
    // (createWebhookHandler → claimProcessedMessage) BEFORE reaching this
    // function. Doing a second find-then-insert here would be redundant AND
    // would false-positive when webhook has already claimed the row on our
    // behalf. Direct callers (tests, admin retry tools) get a clean pipeline
    // — dedup is a webhook-layer concern.

    // Find agent by WhatsApp number.
    const agent = await adapter.getAgentByWhatsAppNumber(from)
    if (!agent) {
      logger.warn({ from }, 'no agent found for WhatsApp number')
      return { handled: false, reason: 'no_agent' }
    }

    const agencyId = await adapter.getAgentAgencyId(agent.id)

    // Feature gate.
    if (!(await entitlements.isEnabled({ agentId: agent.id, agencyId }))) {
      await sendWhatsAppReply(from, 'This feature is not included in your current plan. Upgrade to enable listing creation via WhatsApp.')
      return { handled: true, reason: 'feature_disabled' }
    }

    const quota = await entitlements.checkMonthlyQuota({ agentId: agent.id })
    if (!quota.allowed) {
      await sendWhatsAppReply(from, `You have reached your monthly limit of ${quota.max} WhatsApp listing drafts. Please upgrade your plan.`)
      return { handled: true, reason: 'quota_exceeded' }
    }

    // Get or create session.
    let session = await sessions.getByAgentPhone(agent.id, from)
    if (!session || session.state === SessionState.COMPLETED || session.state === SessionState.DISCARDED || session.state === SessionState.ERROR) {
      session = await sessions.getOrCreateSession({ agentId: agent.id, phoneNumber: from })
    }

    // If session is awaiting approval and this is a response, handle it.
    if (session.state === SessionState.AWAITING_APPROVAL || session.state === SessionState.AWAITING_PRICE_ADJUSTMENT) {
      return await handleApprovalResponse({ session, text, interactiveId, agent, agencyId, from })
    }

    // If session is collecting or idle, add content.
    if (session.state === SessionState.IDLE) {
      await sessions.transition(session.id, SessionState.COLLECTING)
    }

    session = await sessions.getById(session.id)
    if (text || interactiveId) {
      await sessions.addMessage(session.id, { direction: 'inbound', type: messageType || 'text', text, interactive_id: interactiveId || null, raw_payload: rawPayload })
    }

    let downloadedMedia = []
    if (mediaIds && mediaIds.length) {
      for (const mediaId of mediaIds) {
        try {
          const media = await storage.downloadMedia(mediaId)
          downloadedMedia.push(media)
          await sessions.addMedia(session.id, media)
        } catch (err) {
          logger.warn({ err: err.message, mediaId }, 'media download failed')
        }
      }
    }

    session = await sessions.getById(session.id)

    // Handle location pins with canonical priority.
    const locationInfo = recordLocationPin(session, location, text)
    if (locationInfo.hasPin && locationInfo.previousPinCount > 0) {
      logger.warn({ sessionId: session.id, pinCount: locationInfo.pinCount }, 'multiple location pins in intake window; using most recent')
    }

    // Check for explicit "done" trigger.
    const doneTriggered = isDoneTrigger(text)
    if (doneTriggered) {
      logger.info({ sessionId: session.id }, 'explicit done trigger received; scheduling extraction immediately')
    }

    // Schedule extraction via worker by marking session ready.
    // We transition to ready immediately; the worker will wait for the intake window.
    await sessions.updateSession(session.id, {
      ready_for_extraction_at: doneTriggered
        ? new Date().toISOString()
        : new Date(Date.now() + config.intakeWindowMs).toISOString(),
      ...locationInfo.sessionPatch,
    })

    session = await sessions.getById(session.id)
    return { handled: true, sessionId: session.id, mediaCount: downloadedMedia.length, locationPin: locationInfo.hasPin, doneTriggered }
  }

  async function runExtraction(sessionId) {
    let session = await sessions.getById(sessionId)
    if (!session) return null
    if (session.state !== SessionState.COLLECTING && session.state !== SessionState.READY_FOR_EXTRACTION) {
      return null
    }

    await sessions.transition(session.id, SessionState.EXTRACTING)
    session = await sessions.getById(session.id)

    const agent = await adapter.getAgentById(session.agent_id)
    const agencyId = await adapter.getAgentAgencyId(session.agent_id)
    const entitlementConfig = await entitlements.getConfig({ agentId: session.agent_id, agencyId })

    // Determine scope for credits (agency pool if exists, else agent).
    const creditScope = agencyId ? CreditScope.AGENCY : CreditScope.AGENT
    const creditScopeId = agencyId || session.agent_id

    // Estimate and reserve credits.
    const estimatedCost = config.credits.extractionCost + config.credits.thumbnailCost + config.credits.captionCost
    const reserve = await credits.reserve(creditScope, creditScopeId, estimatedCost, {
      description: 'Reserve for WhatsApp listing extraction',
      relatedDraftId: session.draft_id,
    })
    if (!reserve.ok) {
      await sessions.transition(session.id, SessionState.ERROR)
      await sendWhatsAppReply(session.phone_number, 'Your AI credit balance is too low. Please top up via your dashboard.')
      return null
    }

    // Classify intent.
    const agentListings = await adapter.getAgentListings(session.agent_id)
    let intentResult
    try {
      intentResult = await classifier.classify({
        messages: session.messages.map((m) => ({ role: 'user', text: m.text })),
        images: session.media.map((m) => ({ url: m.publicUrl, mimeType: m.mimeType })),
        agentListings,
      })
    } catch (err) {
      logger.warn({ err: err.message }, 'intent classification failed, defaulting to create')
      intentResult = { intent: Intent.CREATE, confidence: 0.5, reason: 'classification failed', method: 'fallback' }
    }

    await sessions.updateSession(session.id, {
      intent: intentResult.intent,
      matched_listing_id: intentResult.matched_listing_id || null,
    })

    let matchedListing = null
    if (intentResult.intent === Intent.UPDATE) {
      if (intentResult.matched_listing_id) {
        matchedListing = agentListings.find((l) => l.id === intentResult.matched_listing_id) || null
      }
      if (!matchedListing) {
        const canonicalLocation = resolveCanonicalLocation(session)
        const matches = await matcher.findMatches({
          agentId: session.agent_id,
          text: session.messages.map((m) => m.text).join(' '),
          detectedCoordinates: canonicalLocation
            ? { latitude: canonicalLocation.latitude, longitude: canonicalLocation.longitude }
            : undefined,
          photoCount: session.media.filter((m) => /^image\//.test(m.mimeType)).length,
        })
        if (matches.length) {
          matchedListing = matches[0].listing
          await sessions.updateSession(session.id, { matched_listing_id: matchedListing.id })
        }
      }
    }

    // If update intent and multiple matches, ask for clarification and pause.
    if (intentResult.intent === Intent.UPDATE && !matchedListing) {
      const canonicalLocation = resolveCanonicalLocation(session)
      const matches = await matcher.findMatches({
        agentId: session.agent_id,
        text: session.messages.map((m) => m.text).join(' '),
        detectedCoordinates: canonicalLocation
          ? { latitude: canonicalLocation.latitude, longitude: canonicalLocation.longitude }
          : undefined,
        photoCount: session.media.filter((m) => /^image\//.test(m.mimeType)).length,
      }, 0.3)
      if (matches.length > 1) {
        await sessions.updateSession(session.id, { pending_match_resolution: true })
        await sendMatchClarification(session.phone_number, matches)
        return session
      }
      if (!matches.length) {
        await sendWhatsAppReply(session.phone_number, "I couldn't find an existing listing to update. Should I create a new one?\n\n1. Create new listing\n2. Cancel")
        await sessions.updateSession(session.id, { pending_match_resolution: true, awaiting_create_confirmation: true })
        return session
      }
    }

    // Resolve canonical location from session (most recent WhatsApp pin wins).
    const canonicalLocation = resolveCanonicalLocation(session)

    // AI extraction.
    let extraction
    try {
      extraction = await aiAdapter.extractProperty({
        messages: session.messages.map((m) => ({ role: 'user', text: m.text })),
        images: session.media.map((m) => ({ url: m.publicUrl, mimeType: m.mimeType })),
        provider: entitlementConfig.ai_providers_allowed?.[0] || config.aiProvider,
        locationPin: canonicalLocation,
        hasPin: Boolean(canonicalLocation),
        intent: intentResult.intent,
        existingListing: matchedListing || null,
      })
    } catch (err) {
      logger.error({ err: err.message }, 'property extraction failed')
      await credits.release(creditScope, creditScopeId, estimatedCost, { description: 'Release on extraction failure', relatedDraftId: session.draft_id })
      await sessions.transition(session.id, SessionState.ERROR)
      await sessions.updateSession(session.id, { last_error: err.message })
      await scheduleRetry(session, sessions)
      await sendWhatsAppReply(session.phone_number, 'Sorry, I had trouble extracting the listing details. Please try again with clearer photos or a text summary.')
      return null
    }

    let extractedProperty = extraction.property
    if (matchedListing) {
      extractedProperty = mergeUpdateContext(matchedListing, extractedProperty, intentResult)
    }

    // Enforce canonical coordinates from WhatsApp pin when present.
    if (canonicalLocation) {
      extractedProperty.latitude = canonicalLocation.latitude
      extractedProperty.longitude = canonicalLocation.longitude
      extractedProperty.location_source = LocationSource.WHATSAPP_PIN
      extractedProperty.address_display = canonicalLocation.name || canonicalLocation.address || session.address_description || null
    } else {
      extractedProperty.location_source = session.location_source || LocationSource.UNKNOWN
      extractedProperty.address_display = session.address_description || null
    }

    await sessions.updateSession(session.id, { extracted_property: extractedProperty })

    // Generate thumbnails.
    let thumbnails = null
    let selectedVariant = null
    try {
      const imageMedia = session.media.filter((m) => /^image\//.test(m.mimeType))
      if (imageMedia.length) {
        let heroImage = imageMedia[0]
        try {
          const heroResult = await aiAdapter.selectHeroImage({
            images: imageMedia.map((m) => ({ url: m.publicUrl, mimeType: m.mimeType })),
            provider: entitlementConfig.ai_providers_allowed?.[0] || config.aiProvider,
          })
          heroImage = imageMedia[heroResult.index] || imageMedia[0]
          logger.info({ heroIndex: heroResult.index, reason: heroResult.reason }, 'AI selected hero image')
        } catch (err) {
          logger.warn({ err: err.message }, 'AI hero selection failed, falling back to first image')
        }

        selectedVariant = await selectVariant(extractedProperty, heroImage, entitlementConfig)
        const outputDir = join(config.storagePath, 'thumbnails')
        if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })
        thumbnails = await templateEngine.generate({
          property: extractedProperty,
          inputImagePath: heroImage.localPath,
          variant: selectedVariant,
          outputDir,
          version: matchedListing ? (matchedListing.asset_version || 1) + 1 : 1,
        })
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'thumbnail generation failed')
    }

    // Generate captions.
    let captions = {}
    try {
      captions.instagram = await aiAdapter.generateCaption({ platform: 'instagram', property: extractedProperty, variant: selectedVariant })
      captions.tiktok = await aiAdapter.generateCaption({ platform: 'tiktok', property: extractedProperty, variant: selectedVariant })
      captions.x = await aiAdapter.generateCaption({ platform: 'x', property: extractedProperty, variant: selectedVariant })
    } catch (err) {
      logger.warn({ err: err.message }, 'caption generation failed')
    }

    await sessions.updateSession(session.id, {
      selected_variant: selectedVariant,
      generated_thumbnails: thumbnails,
      generated_captions: captions,
    })

    // Create draft record.
    const draft = await insertModule(Collections.DRAFTS, {
      id: uuidv4(),
      session_id: session.id,
      agent_id: session.agent_id,
      agency_id: agencyId || null,
      intent: intentResult.intent,
      update_of: matchedListing?.id || null,
      extracted_property: extractedProperty,
      change_summary: intentResult.intent === Intent.UPDATE
        ? buildAiChangeSummary(matchedListing, extractedProperty, extraction.changeSummary, session.media)
        : null,
      thumbnails: thumbnails || null,
      captions: captions || null,
      location_pin_latitude: canonicalLocation ? canonicalLocation.latitude : null,
      location_pin_longitude: canonicalLocation ? canonicalLocation.longitude : null,
      location_pin_name: canonicalLocation ? canonicalLocation.name : null,
      location_source: canonicalLocation ? LocationSource.WHATSAPP_PIN : (session.location_source || LocationSource.UNKNOWN),
      address_description: session.address_description || null,
      status: DraftStatus.AWAITING_APPROVAL,
      credits_reserved: estimatedCost,
      credit_scope: creditScope,
      credit_scope_id: creditScopeId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    await sessions.updateSession(session.id, { draft_id: draft.id })
    await sessions.transition(session.id, SessionState.AWAITING_APPROVAL)

    // Deduct actual thumbnail/caption costs, release remainder if none.
    const actualCost = config.credits.extractionCost + (thumbnails ? config.credits.thumbnailCost : 0) + (captions.x ? config.credits.captionCost : 0)
    await credits.release(creditScope, creditScopeId, estimatedCost - actualCost, { description: 'Release over-reserved credits', relatedDraftId: draft.id })
    await credits.consume(creditScope, creditScopeId, actualCost, { description: 'Consumption for extraction and asset generation', relatedDraftId: draft.id })

    // Send approval card.
    const draftChangeSummary = intentResult.intent === Intent.UPDATE
      ? buildAiChangeSummary(matchedListing, extractedProperty, extraction.changeSummary, session.media)
      : null
    await sendApprovalCard(session.phone_number, extractedProperty, thumbnails, captions, intentResult.intent, matchedListing, canonicalLocation, draftChangeSummary)

    return draft
  }

  async function handleApprovalResponse({ session, text, interactiveId, agent, agencyId, from }) {
    const normalized = String(text || '').trim().toLowerCase()
    const replyId = interactiveId || null

    if (session.state === SessionState.AWAITING_PRICE_ADJUSTMENT) {
      if (['discard', 'cancel', 'delete'].includes(normalized) || replyId === 'discard') {
        await discardDraft(session.id)
        await sendWhatsAppReply(from, 'Draft discarded. Send a new message when you want to create or update a listing.')
        return { handled: true, action: 'discard' }
      }
      const parsed = parsePriceAdjustment(text)
      if (!parsed.ok) {
        await sendWhatsAppReply(from, `${parsed.error} Send the amount and currency, for example: 450000 USD or 40500000000 LBP. Reply "cancel" to discard.`)
        return { handled: true, action: 'invalid_price_adjustment' }
      }
      const draft = session.draft_id ? await findOneModule(Collections.DRAFTS, (item) => item.id === session.draft_id) : null
      if (!draft) {
        await sessions.transition(session.id, SessionState.ERROR)
        await sendWhatsAppReply(from, 'I could not find this draft. Please restart the listing flow.')
        return { handled: true, action: 'missing_draft' }
      }
      const previousPrice = draft.extracted_property?.price ?? session.extracted_property?.price ?? null
      const adjustedProperty = {
        ...(draft.extracted_property || session.extracted_property || {}),
        price: parsed.price,
        currency: parsed.currency,
      }
      const changeSummary = {
        ...(draft.change_summary || {}),
        price_changed: { from: previousPrice, to: parsed.price, currency: parsed.currency },
      }
      await updateModule(Collections.DRAFTS, (item) => item.id === draft.id, (item) => ({
        ...item,
        extracted_property: adjustedProperty,
        change_summary: changeSummary,
        updated_at: new Date().toISOString(),
      }))
      await sessions.updateSession(session.id, { extracted_property: adjustedProperty })
      await sessions.transition(session.id, SessionState.AWAITING_APPROVAL)
      await sendApprovalCard(from, adjustedProperty, draft.thumbnails, draft.captions, draft.intent, draft.update_of ? { id: draft.update_of, title: adjustedProperty.title } : null, null, changeSummary, { priceReviewed: true })
      return { handled: true, action: 'adjust_price', price: parsed.price, currency: parsed.currency }
    }

    const isApprove = ['approve', 'yes', '1', 'publish', 'post'].includes(normalized) || replyId === 'approve' || replyId === 'approve_and_post'
    const isUpdate = replyId === 'update_listing' || replyId === 'update_and_repost'
    const isEdit = ['edit', '2', 'change', 'reprocess'].includes(normalized) || replyId === 'edit'
    const isDiscard = ['discard', 'no', '3', 'cancel', 'delete'].includes(normalized) || replyId === 'discard'
    const isPostSocial = replyId === 'approve_and_post' || replyId === 'update_and_repost' || normalized.includes('post') || normalized.includes('social')
    const isKeepPrice = replyId === 'keep_price' || ['keep price', 'keep'].includes(normalized)
    const isAdjustPrice = replyId === 'adjust_price' || ['adjust price', 'change price'].includes(normalized)

    if (isAdjustPrice) {
      await sessions.transition(session.id, SessionState.AWAITING_PRICE_ADJUSTMENT)
      await sendWhatsAppReply(from, 'Send the new positive amount and currency, for example: 450000 USD or 40500000000 LBP. Reply "cancel" to discard.')
      return { handled: true, action: 'request_price_adjustment' }
    }

    if (isKeepPrice) {
      const draft = session.draft_id ? await findOneModule(Collections.DRAFTS, (item) => item.id === session.draft_id) : null
      if (!draft) {
        await sendWhatsAppReply(from, 'I could not find this draft. Please restart the listing flow.')
        return { handled: true, action: 'missing_draft' }
      }
      await sendApprovalCard(from, draft.extracted_property, draft.thumbnails, draft.captions, draft.intent, draft.update_of ? { id: draft.update_of, title: draft.extracted_property?.title } : null, null, draft.change_summary, { priceReviewed: true })
      return { handled: true, action: 'keep_price' }
    }

    if (isDiscard) {
      await discardDraft(session.id)
      await sendWhatsAppReply(from, 'Draft discarded. Send a new message when you want to create or update a listing.')
      return { handled: true, action: 'discard' }
    }

    if (isEdit) {
      await sessions.transition(session.id, SessionState.COLLECTING)
      await sendWhatsAppReply(from, 'Sure. Send me the updated details or photos and I will re-process.')
      return { handled: true, action: 'edit' }
    }

    if (isApprove || isUpdate) {
      await publishDraft(session.id, { publishSocial: isPostSocial })
      return { handled: true, action: isUpdate ? 'update' : 'approve' }
    }

    // Variant selection via list reply.
    if (replyId && replyId.startsWith('variant:')) {
      const variant = replyId.split(':')[1]
      if (['luxe', 'modern', 'urgent'].includes(variant)) {
        await sessions.updateSession(session.id, { selected_variant: variant })
        await sendWhatsAppReply(from, `Template updated to ${variant}. Reply "approve" to publish.`)
        return { handled: true, action: 'variant' }
      }
    }

    await sendWhatsAppReply(from, 'I did not understand. Reply: approve, edit, or discard.')
    return { handled: true, action: 'unknown' }
  }

  async function publishDraft(sessionId, { publishSocial = false } = {}) {
    const session = await sessions.getById(sessionId)
    if (!session || !session.draft_id) return null

    const draft = await findOneModule(Collections.DRAFTS, (d) => d.id === session.draft_id)
    if (!draft) return null

    await sessions.transition(session.id, SessionState.PUBLISHING)

    const agent = await adapter.getAgentById(session.agent_id)
    const agencyId = await adapter.getAgentAgencyId(session.agent_id)
    const entitlementConfig = await entitlements.getConfig({ agentId: session.agent_id, agencyId })

    let property
    try {
      if (draft.intent === Intent.UPDATE && draft.update_of) {
        const updatePayload = buildUpdatePayload(draft)
        property = await adapter.updateListing(draft.update_of, updatePayload)
      } else {
        const createPayload = buildCreatePayload(draft, agent, agencyId)
        property = await adapter.createListing(createPayload)
      }
    } catch (err) {
      logger.error({ err: err.message }, 'listing publish failed')
      await sessions.transition(session.id, SessionState.ERROR)
      await sessions.updateSession(session.id, { last_error: err.message })
      await scheduleRetry(session, sessions)
      await updateModule(Collections.DRAFTS, (d) => d.id === draft.id, (d) => ({ ...d, status: DraftStatus.ERROR, error: err.message, updated_at: new Date().toISOString() }))
      await sendWhatsAppReply(session.phone_number, 'Sorry, I could not publish the listing. Please check your dashboard.')
      return null
    }

    await updateModule(Collections.DRAFTS, (d) => d.id === draft.id, (d) => ({
      ...d,
      property_id: property.id,
      status: DraftStatus.PUBLISHED,
      updated_at: new Date().toISOString(),
    }))

    // Social publishing.
    let socialResults = []
    if (publishSocial || entitlementConfig.auto_publish_social) {
      socialResults = await publishToSocial({ property, draft, session, entitlementConfig, publishSocial })
    }

    await sessions.transition(session.id, SessionState.COMPLETED)
    await sendWhatsAppReply(
      session.phone_number,
      `Your listing "${property.title}" has been ${draft.intent === Intent.UPDATE ? 'updated' : 'published'}.\n${property.photos?.[0] ? `View: ${property.photos[0]}` : ''}`,
    )

    return { property, socialResults }
  }

  async function publishToSocial({ property, draft, session, entitlementConfig, explicitPublish = false }) {
    const results = []
    const caption = draft.captions?.instagram?.caption || `${property.title} · ${property.city || property.location || ''}`
    const mediaUrls = draft.thumbnails ? [draft.thumbnails.paths['1080x1080'], draft.thumbnails.paths['1080x1920']].filter(Boolean) : property.photos || []
    const thumbnailUrls = draft.thumbnails?.paths || {}
    const platforms = [SocialPlatform.INSTAGRAM]

    // Enforce social re-posting rules on updates.
    if (draft.intent === Intent.UPDATE && !explicitPublish) {
      const summary = draft.change_summary || {}
      const hasSignificantChange = Boolean(
        summary.price_changed ||
        summary.status_changed ||
        summary.photos_added ||
        summary.location_changed ||
        summary.other_changes?.length
      )
      if (!hasSignificantChange) {
        logger.info({ draftId: draft.id }, 'skipping auto social re-post for minor update')
        return results
      }
    }

    for (const platform of platforms) {
      try {
        if (platform === SocialPlatform.INSTAGRAM) {
          const dist = await adapter.publishToInstagram({
            property_id: property.id,
            agent_id: session.agent_id,
            caption,
            media_urls: mediaUrls,
            thumbnail_urls: thumbnailUrls,
            formats: mediaUrls.length > 1 ? ['carousel'] : ['feed_image'],
            auto_published: true,
            update_badge: draft.intent === Intent.UPDATE ? (draft.change_summary?.price_changed ? 'PRICE DROP' : 'UPDATED') : null,
          })
          results.push({ platform, ok: true, distribution_id: dist.id })
        }
      } catch (err) {
        logger.warn({ err: err.message, platform }, 'social publish failed')
        results.push({ platform, ok: false, error: err.message })
      }
    }
    return results
  }

  async function discardDraft(sessionId) {
    const session = await sessions.getById(sessionId)
    if (!session) return null

    if (session.draft_id) {
      const draft = await findOneModule(Collections.DRAFTS, (d) => d.id === session.draft_id)
      if (draft) {
        // Release any remaining reserved credits.
        if (draft.credits_reserved) {
          await credits.release(draft.credit_scope, draft.credit_scope_id, draft.credits_reserved, { description: 'Release on discard', relatedDraftId: draft.id })
        }
        await updateModule(Collections.DRAFTS, (d) => d.id === draft.id, (d) => ({ ...d, status: DraftStatus.DISCARDED, updated_at: new Date().toISOString() }))
      }
    }
    await sessions.transition(session.id, SessionState.COMPLETED)
    return session
  }

  async function sendWhatsAppReply(to, body) {
    const { sendWhatsAppText } = await import('../../../whatsapp.js')
    try {
      await sendWhatsAppText(to, body)
    } catch (err) {
      logger.warn({ err: err.message, to }, 'failed to send WhatsApp reply')
    }
  }

  async function sendMatchClarification(to, matches) {
    const rows = matches.slice(0, 10).map((m, idx) => ({
      id: `match:${m.listing.id}`,
      title: `${idx + 1}. ${m.listing.title || m.listing.location || 'Listing'}`,
      description: `${m.listing.location || ''} · ${m.listing.price || ''}`,
    }))
    const { sendWhatsAppInteractive } = await import('../../../whatsapp.js')
    try {
      await sendWhatsAppInteractive(to, {
        type: 'list',
        header: { type: 'text', text: 'Multiple listings found' },
        body: { text: 'I found several listings that could match. Which one do you want to update?' },
        action: { button: 'Choose listing', sections: [{ title: 'Active listings', rows }] },
      })
    } catch (err) {
      logger.warn({ err: err.message }, 'interactive match clarification failed, falling back to text')
      const text = matches.slice(0, 5).map((m, idx) => `${idx + 1}. ${m.listing.title} (${m.listing.location})`).join('\n')
      await sendWhatsAppText(to, `I found several listings that could match. Which one do you want to update?\n\n${text}\n\nReply with the number.`)
    }
  }

  async function sendApprovalCard(to, property, thumbnails, captions, intent, matchedListing, locationPin, changeSummary, { priceReviewed = false } = {}) {
    const { sendWhatsAppInteractive } = await import('../../../whatsapp.js')
    const isUpdate = intent === Intent.UPDATE && matchedListing
    const headline = isUpdate
      ? `Update draft for ${matchedListing.title}`
      : `New listing draft: ${property.title}`

    const locationLine = locationPin
      ? `📍 Location: ${locationPin.latitude.toFixed(6)}, ${locationPin.longitude.toFixed(6)} (from your shared pin)`
      : property.address_display
        ? `📍 Location: ${property.address_display} (from your text — please share a pin for accuracy)`
        : property.location
          ? `📍 Location: ${property.location} (please share a pin for accuracy)`
          : '📍 Location: not set — please share a location pin for accuracy'

    const changeLines = []
    if (isUpdate && changeSummary && Object.keys(changeSummary).length) {
      changeLines.push('')
      changeLines.push('What changed:')
      if (changeSummary.price_changed) changeLines.push(`• Price: ${changeSummary.price_changed.from} → ${changeSummary.price_changed.to}`)
      if (changeSummary.title_changed) changeLines.push(`• Title updated`)
      if (changeSummary.description_changed) changeLines.push(`• Description updated`)
      if (changeSummary.status_changed) changeLines.push(`• Status: ${changeSummary.status_changed.from} → ${changeSummary.status_changed.to}`)
      if (changeSummary.photos_added) changeLines.push(`• ${changeSummary.photos_added} new photo(s) added`)
      if (changeSummary.location_changed) changeLines.push(`• Location changed`)
      if (changeSummary.other_changes?.length) changeLines.push(...changeSummary.other_changes.map((c) => `• ${c}`))
    }

    let pricingContext = ''
    try {
      pricingContext = await adapter.getPricingContext(property)
    } catch {
      pricingContext = ''
    }

    const bodyText = [
      `🏠 ${property.title || 'Untitled'}`,
      property.price ? `💵 ${property.price}` : '',
      pricingContext,
      priceReviewed ? '✅ Price reviewed. Confirm how you want to publish.' : 'Review the price before publishing.',
      locationLine,
      ...changeLines,
      '',
      isUpdate ? 'Reply with an action:' : 'Reply with an action:',
      isUpdate ? 'Location looks wrong? Send a new pin.' : 'Location looks wrong? Send a new pin.',
    ].filter(Boolean).join('\n')

    const publishButtons = isUpdate
      ? [
          { type: 'reply', reply: { id: 'update_listing', title: 'Update Listing' } },
          { type: 'reply', reply: { id: 'update_and_repost', title: 'Update + Re-post' } },
          { type: 'reply', reply: { id: 'discard', title: 'Discard' } },
        ]
      : [
          { type: 'reply', reply: { id: 'approve', title: 'Approve' } },
          { type: 'reply', reply: { id: 'approve_and_post', title: 'Approve + Post' } },
          { type: 'reply', reply: { id: 'edit', title: 'Edit' } },
        ]
    const buttons = priceReviewed
      ? publishButtons
      : [
          { type: 'reply', reply: { id: 'keep_price', title: 'Keep Price' } },
          { type: 'reply', reply: { id: 'adjust_price', title: 'Adjust Price' } },
          { type: 'reply', reply: { id: 'edit', title: 'Edit Details' } },
        ]

    try {
      await sendWhatsAppInteractive(to, {
        type: 'button',
        header: { type: 'text', text: headline },
        body: { text: bodyText },
        action: { buttons },
      })
    } catch (err) {
      logger.warn({ err: err.message }, 'interactive approval card failed, falling back to text')
      const fallbackButtons = priceReviewed && isUpdate
        ? 'Reply: update listing | update + re-post | discard'
        : priceReviewed
          ? 'Reply: approve | approve + post | edit | discard'
          : 'Reply: keep price | adjust price | edit | discard'
      await sendWhatsAppReply(to, `${headline}\n\n${bodyText}\n\n${fallbackButtons}`)
    }

    // If thumbnails exist, send the hero image with variant caption.
    if (thumbnails?.paths?.['1080x1080']) {
      try {
        const { sendWhatsAppImage } = await import('../../../whatsapp.js')
        await sendWhatsAppImage(to, {
          link: thumbnails.paths['1080x1080'],
          caption: `Preview (${thumbnails.variant || 'modern'}). Reply "variant" to change style.`,
        })
      } catch (err) {
        logger.warn({ err: err.message }, 'thumbnail preview send failed')
      }
    }
  }

  async function selectVariant(property, heroImage, entitlementConfig) {
    const allowed = entitlementConfig.thumbnail_variants || ['modern']
    if (allowed.length === 1) return allowed[0]

    try {
      const variant = await aiAdapter.selectBestTemplate({ imageDescriptions: [property.description || ''] })
      if (allowed.includes(variant.variant)) return variant.variant
    } catch (err) {
      logger.warn({ err: err.message }, 'AI template selection failed')
    }
    return allowed[0] || 'modern'
  }

  return {
    ingest,
    runExtraction,
    publishDraft,
    discardDraft,
    // Exposed for tests and diagnostics only.
    aiAdapter,
    sessions,
  }
}

function buildCreatePayload(draft, agent, agencyId) {
  const p = draft.extracted_property
  return {
    title: p.title,
    description: p.description,
    type: p.type || 'sale',
    property_type: p.property_type || 'apartment',
    price: p.price ? Number(p.price) : 0,
    currency: p.currency || 'USD',
    price_unit: p.price_unit,
    bedrooms: p.bedrooms != null ? Number(p.bedrooms) : null,
    bathrooms: p.bathrooms != null ? Number(p.bathrooms) : null,
    area: p.area != null ? Number(p.area) : null,
    area_unit: p.area_unit || 'sqm',
    location: p.location,
    city: p.city,
    neighborhood: p.neighborhood,
    address: p.address,
    latitude: p.latitude != null ? Number(p.latitude) : null,
    longitude: p.longitude != null ? Number(p.longitude) : null,
    location_source: p.location_source || draft.location_source || null,
    address_display: p.address_display || draft.address_description || null,
    amenities: p.amenities || [],
    furnished: p.furnished != null ? Number(p.furnished) : 0,
    media: (draft.thumbnails?.paths
      ? Object.values(draft.thumbnails.paths).filter(Boolean).map((url) => ({ url, media_type: 'image', source: 'whatsapp_listings' }))
      : []).concat((p.photos || []).map((url) => ({ url, media_type: 'image', source: 'whatsapp_listings' }))),
    agent_id: draft.agent_id,
    agent_name: agent?.name,
    template_variant: draft.thumbnails?.variant,
  }
}

function buildUpdatePayload(draft) {
  const p = draft.extracted_property
  const patch = {}
  if (p.title !== undefined) patch.title = p.title
  if (p.description !== undefined) patch.description = p.description
  if (p.price !== undefined) patch.price = Number(p.price)
  if (p.currency !== undefined) patch.currency = p.currency
  if (p.price_unit !== undefined) patch.price_unit = p.price_unit
  if (p.bedrooms !== undefined) patch.bedrooms = p.bedrooms != null ? Number(p.bedrooms) : null
  if (p.bathrooms !== undefined) patch.bathrooms = p.bathrooms != null ? Number(p.bathrooms) : null
  if (p.area !== undefined) patch.area = p.area != null ? Number(p.area) : null
  if (p.area_unit !== undefined) patch.area_unit = p.area_unit
  if (p.location !== undefined) patch.location = p.location
  if (p.city !== undefined) patch.city = p.city
  if (p.neighborhood !== undefined) patch.neighborhood = p.neighborhood
  if (p.address !== undefined) patch.address = p.address
  if (p.latitude !== undefined) patch.latitude = p.latitude != null ? Number(p.latitude) : null
  if (p.longitude !== undefined) patch.longitude = p.longitude != null ? Number(p.longitude) : null
  if (p.location_source !== undefined) patch.location_source = p.location_source || draft.location_source || null
  if (p.address_display !== undefined) patch.address_display = p.address_display || draft.address_description || null
  if (p.amenities !== undefined) patch.amenities = p.amenities || []
  if (p.furnished !== undefined) patch.furnished = p.furnished != null ? Number(p.furnished) : 0
  if (draft.thumbnails?.paths) {
    patch.media = Object.values(draft.thumbnails.paths).filter(Boolean).map((url) => ({ url, media_type: 'image', source: 'whatsapp_listings' }))
  }
  patch.change_summary = draft.change_summary
  return patch
}

function mergeUpdateContext(existing, extracted, intentResult) {
  return {
    ...existing,
    ...extracted,
    id: existing.id,
    agent_id: existing.agent_id,
  }
}

export function parsePriceAdjustment(input) {
  const value = String(input || '').trim().toUpperCase()
  const currencyMatch = value.match(/\b(USD|LBP)\b/)
  if (!currencyMatch) return { ok: false, error: 'Currency is required and must be USD or LBP.' }
  const numericText = value
    .replace(/\b(USD|LBP)\b/g, '')
    .replace(/[$£€]/g, '')
    .replace(/,/g, '')
    .trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(numericText)) {
    return { ok: false, error: 'Price must be a positive number with at most two decimal places.' }
  }
  const price = Number(numericText)
  if (!Number.isFinite(price) || price <= 0) return { ok: false, error: 'Price must be greater than zero.' }
  return { ok: true, price, currency: currencyMatch[1] }
}

function buildAiChangeSummary(existing, extracted, aiSummary, media) {
  const summary = {}
  if (aiSummary?.price_changed?.from !== aiSummary?.price_changed?.to) {
    summary.price_changed = aiSummary.price_changed
  } else if (existing.price !== extracted.price) {
    summary.price_changed = { from: existing.price, to: extracted.price }
  }
  if (aiSummary?.title_changed?.from !== aiSummary?.title_changed?.to) {
    summary.title_changed = aiSummary.title_changed
  } else if (existing.title !== extracted.title) {
    summary.title_changed = { from: existing.title, to: extracted.title }
  }
  if (aiSummary?.description_changed?.from !== aiSummary?.description_changed?.to) {
    summary.description_changed = aiSummary.description_changed
  } else if (existing.description !== extracted.description) {
    summary.description_changed = { from: existing.description, to: extracted.description }
  }
  if (aiSummary?.status_changed?.from !== aiSummary?.status_changed?.to) {
    summary.status_changed = aiSummary.status_changed
  } else if (existing.status !== extracted.status) {
    summary.status_changed = { from: existing.status, to: extracted.status }
  }

  const newPhotoCount = media.filter((m) => /^image\//.test(m.mimeType)).length
  if (newPhotoCount > 0 || (aiSummary?.photos_added || 0) > 0) {
    summary.photos_added = aiSummary?.photos_added || newPhotoCount
  }

  if (aiSummary?.location_changed || (existing.latitude !== extracted.latitude || existing.longitude !== extracted.longitude)) {
    summary.location_changed = true
  }

  if (aiSummary?.other_changes?.length) {
    summary.other_changes = aiSummary.other_changes
  }

  return summary
}

function buildChangeSummary(existing, extracted) {
  const summary = {}
  if (existing.price !== extracted.price) {
    summary.price_changed = { from: existing.price, to: extracted.price }
  }
  if (existing.title !== extracted.title) {
    summary.title_changed = { from: existing.title, to: extracted.title }
  }
  if (existing.description !== extracted.description) {
    summary.description_changed = { from: existing.description, to: extracted.description }
  }
  if (existing.status !== extracted.status) {
    summary.status_changed = { from: existing.status, to: extracted.status }
  }
  return summary
}

function isDoneTrigger(text) {
  if (!text) return false
  const normalized = String(text).trim().toLowerCase()
  if (normalized === 'done') return true
  if (normalized === 'finished') return true
  if (normalized === 'complete') return true
  if (normalized === 'go') return true
  if (normalized === 'process') return true
  if (normalized.startsWith('done ') || normalized.endsWith(' done')) return true
  return false
}

async function scheduleRetry(session, sessions) {
  const retryCount = (session.retry_count || 0) + 1
  const backoffMs = Math.min(300_000, 5000 * Math.pow(2, retryCount - 1))
  await sessions.updateSession(session.id, {
    retry_count: retryCount,
    next_retry_at: new Date(Date.now() + backoffMs).toISOString(),
    last_error: session.last_error || 'processing failed',
  })
}

function resolveCanonicalLocation(session) {
  const pins = session.location_pins || []
  if (!pins.length) return null
  // Most recent pin is canonical.
  return pins[pins.length - 1]
}

function recordLocationPin(session, location, text) {
  const patch = {}
  let hasPin = false
  let previousPinCount = 0
  let pinCount = 0

  if (location && typeof location.latitude === 'number' && typeof location.longitude === 'number') {
    const pin = {
      id: uuidv4(),
      latitude: location.latitude,
      longitude: location.longitude,
      name: location.name || null,
      address: location.address || null,
      received_at: new Date().toISOString(),
    }
    previousPinCount = (session.location_pins || []).length
    const pins = [...(session.location_pins || []), pin]
    patch.location_pins = pins
    patch.location_source = LocationSource.WHATSAPP_PIN
    patch.address_description = location.name || location.address || text || null
    hasPin = true
    pinCount = pins.length
  } else if (text && text.trim() && (!session.location_pins || session.location_pins.length === 0)) {
    // No pin yet, but agent provided text. Store the text as a display address
    // description and flag source as agent_text until a pin arrives.
    patch.address_description = text.trim()
    if (!session.location_source || session.location_source === LocationSource.UNKNOWN) {
      patch.location_source = LocationSource.AGENT_TEXT
    }
  }

  return { hasPin, previousPinCount, pinCount, sessionPatch: patch }
}
