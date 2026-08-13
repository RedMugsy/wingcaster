# WhatsApp Listing Module

A self-contained module that lets real-estate agents create and update property listings by sending photos, videos, text, or location pins over WhatsApp. The module is gated by subscriptions/credits, uses AI for extraction and caption generation, composites branded thumbnails, and publishes approved listings to social channels.

## Architecture

```
backend/src/modules/whatsapp-listings/
├── application/          # Use cases, orchestration
│   ├── entitlements.js   # Subscription/feature gating
│   ├── credits.js        # AI credit accounting
│   ├── pipeline.js       # Intake → extraction → approval → publish
│   ├── webhook.js        # WhatsApp webhook ingress
│   ├── intent.js         # create vs update classification
│   └── matcher.js        # Existing-listing matching for updates
├── domain/               # Entities, value objects, domain events
│   ├── state.js          # State-machine transitions
│   └── types.js          # Domain constants
├── infrastructure/       # DB, AI, storage, queue, templates
│   ├── ai/               # Provider-agnostic AI adapter + 6 providers
│   ├── templates/        # Sharp-based thumbnail compositing
│   ├── db.js             # Module collection helpers
│   ├── queue.js          # Worker queue
│   ├── sessions.js       # Intake state-machine store
│   └── storage.js        # WhatsApp media download
├── interface/            # HTTP handlers / routes
│   ├── admin-routes.js
│   ├── agency-routes.js
│   └── agent-routes.js
├── platform-adapter.js   # Boundary to the core platform
├── index.js              # Module registration
├── config.js             # WHATSAPP_LISTINGS_* env config
└── logger.js             # Structured module logger
```

## Module Boundary

The module only interacts with the core platform through `PlatformAdapter` (`platform-adapter.js`). If the module is extracted to a microservice, only that adapter needs reimplementation.

## Enable / Disable

Set `WHATSAPP_LISTINGS_ENABLED=true` to enable. Set `false` to disable gracefully. The module does not mount routes or start workers when disabled, and the core platform continues to compile/run.

## Environment Variables

All module config is prefixed with `WHATSAPP_LISTINGS_`:

| Variable | Default | Description |
|----------|---------|-------------|
| `WHATSAPP_LISTINGS_ENABLED` | `true` | Master enable switch |
| `WHATSAPP_LISTINGS_AI_PROVIDER` | `gemini` | Default AI provider |
| `WHATSAPP_LISTINGS_FALLBACK_AI_PROVIDERS` | `gemini,openai` | Comma-separated fallback chain |
| `WHATSAPP_LISTINGS_STORAGE_PATH` | `backend/uploads/whatsapp-listings` | Local storage root |
| `WHATSAPP_LISTINGS_INTAKE_WINDOW_MS` | `120000` | 2-minute intake window |
| `WHATSAPP_LISTINGS_MAX_MEDIA_PER_DRAFT` | `15` | Max media files per draft |
| `WHATSAPP_LISTINGS_MAX_MEDIA_SIZE_BYTES` | `12582912` | 12MB per file |
| `WHATSAPP_LISTINGS_INSTAGRAM_REAL_PUBLISHING` | `true` | Use real Graph API when credentials exist |
| `WHATSAPP_LISTINGS_WORKER_INTERVAL_MS` | `60000` | Worker poll interval |
| `WHATSAPP_LISTINGS_WORKER_BATCH_SIZE` | `20` | Max sessions per worker tick |
| `WHATSAPP_LISTINGS_DEDUPE_TTL_HOURS` | `24` | Message dedupe TTL |
| `WHATSAPP_LISTINGS_SESSION_TTL_HOURS` | `24` | Session TTL |
| `WHATSAPP_LISTINGS_*_API_KEY` | — | Provider API keys (openai, gemini, claude, deepseek, qwen, kimi) |

## Feature Gating

The module reads `feature_entitlements` with `scope: 'agent' | 'agency' | 'platform'`. Most-specific scope wins. Expected entitlement config:

```json
{
  "enabled": true,
  "max_drafts_per_month": 50,
  "ai_providers_allowed": ["gemini", "openai"],
  "thumbnail_variants": ["luxe", "modern", "urgent"],
  "auto_publish_social": false
}
```

If the entitlement is missing or `enabled: false`, the module replies: "This feature is not included in your current plan. Upgrade to enable listing creation via WhatsApp."

## AI Credit Accounting

Credits are reserved on intake, consumed after extraction/asset generation, and released on failure. If the balance is too low, the agent receives: "Your AI credit balance is too low. Please top up via your dashboard."

## Processing Pipeline

1. **Webhook ingress** — Meta HMAC verification, deduplication, agent lookup.
2. **Feature/quota gate** — Runs before media download or AI invocation.
3. **Intake aggregation** — Collects messages, media, and location pins in a 2-minute window. The agent can also send "done" to force immediate extraction.
4. **Intent classification** — Determines `create` vs `update` and matches existing listings.
5. **Credit reservation** — Reserves estimated extraction + thumbnail + caption cost.
6. **AI extraction** — Vision + text → structured property data. Location pins are treated as canonical coordinates; the AI skips address inference when a pin is present.
7. **Asset generation** — AI vision picks the best hero image, then Sharp composites luxe/modern/urgent variants at 1080x1080, 1080x1920, and 1200x675.
8. **Caption generation** — Platform-optimized captions for Instagram, TikTok, and X.
9. **Approval orchestration** — WhatsApp interactive card with Approve / Approve+Post / Edit (or Update / Update+Re-post / Discard for updates).
10. **Publication** — Creates/updates the listing and queues social distribution.

## Social Publishing

The module integrates with the existing `distributions` retry queue. Instagram feed and carousel publishing use the real Graph API when `INSTAGRAM_BUSINESS_ACCOUNT_ID` and page access token are configured; otherwise they fall back to a simulator.

## Adding a New AI Provider

1. Create `infrastructure/ai/providers/{name}.js` exporting `createProvider({ apiKey, logger })`.
2. Implement `extractProperty`, `classifyIntent`, `generateCaption`, `selectBestTemplate`, `healthCheck`.
3. Register the factory in `infrastructure/ai/adapter.js` `PROVIDER_FACTORIES`.
4. Add the API key env var to `API_KEY_ENV_VARS`.

## Extracting the Module to a Microservice

1. Move `application/`, `domain/`, and `interface/` to the new service.
2. Reimplement `infrastructure/` for the new environment (Postgres, S3, Bull/Redis, etc.).
3. Replace `platform-adapter.js` with HTTP/gRPC calls to the core platform.
4. Keep the same module interface contract so the core platform registration line stays unchanged.

## Testing

```bash
# Unit tests
npm run test -- backend/src/modules/whatsapp-listings

# Smoke test (requires backend server)
npm run smoke

# Type check + build
npm run typecheck
npm run build
```
