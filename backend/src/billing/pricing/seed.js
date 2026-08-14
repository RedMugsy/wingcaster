/**
 * Launch seed — Lebanon-first, then the rest of the waves.
 *
 * User instruction (14 Aug 2026): "The launch will be Lebanon first
 * then The Rest as we sequenced them."
 *
 *   Wave 1 (Lebanon LAUNCHED, others PLANNED): LB, JO, AE, SY, EG, KW, QA, OM
 *   Wave 2 (PLANNED):                          AU, FR, IT, ES, SA (blocked
 *                                              on data residency), DE
 *   Wave 3 (PLANNED):                          US, GB
 *
 * Every row is INSERT-only if the code doesn't exist yet, so re-running
 * the seed on an existing DB is a no-op. Multipliers are opinionated
 * defaults matching the spec §7 emerging/gulf/developed banding — admin
 * can and will edit them post-seed.
 */

import { pino } from 'pino'
import { getTerritoryByCode, createTerritory, updateTerritory, ensureUsageEventsPartition } from './territories.js'
import { listZones, createZone } from './zones.js'
import { findCityByName, createCity } from './cities.js'
import { ensureSeedRateCard } from './core-rate-cards.js'

const logger = pino({ name: 'billing.pricing.seed' })

const TERRITORY_SEED = [
  // Wave 1 — Lebanon-first
  { code: 'LB', name: 'Lebanon',       currency: 'USD', wave: 1, status: 'launched', pricing_multiplier: 0.40, vat_percent: 11.00, regulator_id_type: 'ORDER_OF_ENGINEERS',   payment_primary: 'areeba',    payment_secondary: 'airwallex' },
  { code: 'JO', name: 'Jordan',        currency: 'JOD', wave: 1, status: 'planned',  pricing_multiplier: 0.55, vat_percent: 16.00, regulator_id_type: 'JO_REALTOR_LICENSE',   payment_primary: 'hyperpay',  payment_secondary: 'stripe' },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED', wave: 1, status: 'planned',  pricing_multiplier: 1.00, vat_percent: 5.00,  regulator_id_type: 'RERA_ID',              payment_primary: 'stripe',    payment_secondary: 'telr' },
  { code: 'SY', name: 'Syria',         currency: 'USD', wave: 1, status: 'blocked',  pricing_multiplier: 0.30, vat_percent: 0,     regulator_id_type: null,                   payment_primary: 'manual',    payment_secondary: null,        data_residency: false, billing_mode: 'manual' },
  { code: 'EG', name: 'Egypt',         currency: 'EGP', wave: 1, status: 'planned',  pricing_multiplier: 0.35, vat_percent: 14.00, regulator_id_type: 'EG_BROKER_LICENSE',    payment_primary: 'paymob',    payment_secondary: 'stripe' },
  { code: 'KW', name: 'Kuwait',        currency: 'KWD', wave: 1, status: 'planned',  pricing_multiplier: 1.10, vat_percent: 0,     regulator_id_type: 'KW_BROKER_LICENSE',    payment_primary: 'stripe',    payment_secondary: null },
  { code: 'QA', name: 'Qatar',         currency: 'QAR', wave: 1, status: 'planned',  pricing_multiplier: 1.10, vat_percent: 0,     regulator_id_type: 'QA_BROKER_LICENSE',    payment_primary: 'stripe',    payment_secondary: null },
  { code: 'OM', name: 'Oman',          currency: 'OMR', wave: 1, status: 'planned',  pricing_multiplier: 0.90, vat_percent: 5.00,  regulator_id_type: 'OM_BROKER_LICENSE',    payment_primary: 'stripe',    payment_secondary: null },

  // Wave 2 — developed markets + Saudi
  { code: 'AU', name: 'Australia',     currency: 'AUD', wave: 2, status: 'planned',  pricing_multiplier: 1.80, vat_percent: 10.00, regulator_id_type: 'AU_REA_LICENSE',       payment_primary: 'stripe',    payment_secondary: null },
  { code: 'FR', name: 'France',        currency: 'EUR', wave: 2, status: 'planned',  pricing_multiplier: 1.70, vat_percent: 20.00, regulator_id_type: 'CARTE_T',              payment_primary: 'stripe',    payment_secondary: null },
  { code: 'IT', name: 'Italy',         currency: 'EUR', wave: 2, status: 'planned',  pricing_multiplier: 1.60, vat_percent: 22.00, regulator_id_type: 'AGENTE_IMMOBILIARE',   payment_primary: 'stripe',    payment_secondary: null },
  { code: 'ES', name: 'Spain',         currency: 'EUR', wave: 2, status: 'planned',  pricing_multiplier: 1.60, vat_percent: 21.00, regulator_id_type: 'API_LICENSE',          payment_primary: 'stripe',    payment_secondary: null },
  { code: 'SA', name: 'Saudi Arabia',  currency: 'SAR', wave: 2, status: 'blocked',  pricing_multiplier: 1.10, vat_percent: 15.00, regulator_id_type: 'FAL_LICENSE',          payment_primary: 'hyperpay',  payment_secondary: null,        data_residency: true, billing_mode: 'invoice_only' },
  { code: 'DE', name: 'Germany',       currency: 'EUR', wave: 2, status: 'planned',  pricing_multiplier: 1.75, vat_percent: 19.00, regulator_id_type: 'IHK_34C',              payment_primary: 'stripe',    payment_secondary: null },

  // Wave 3 — anglophone majors
  { code: 'US', name: 'United States', currency: 'USD', wave: 3, status: 'planned',  pricing_multiplier: 2.00, vat_percent: 0,     regulator_id_type: 'STATE_REALTOR_LICENSE', payment_primary: 'stripe',   payment_secondary: null },
  { code: 'GB', name: 'United Kingdom',currency: 'GBP', wave: 3, status: 'planned',  pricing_multiplier: 1.85, vat_percent: 20.00, regulator_id_type: 'PROPERTYMARK',         payment_primary: 'stripe',    payment_secondary: null },
]

// Zones per territory. We seed the launched market (LB) with the full
// Beirut / Mount Lebanon / North / Bekaa / South slice. Other markets get
// a single default 'metropolitan' zone at multiplier 1.00 that admin
// will subdivide before flipping the market to 'launched'.
const ZONE_SEED = {
  LB: [
    { code: 'beirut',      name: 'Beirut',           pricing_multiplier: 2.00, is_default: false, sort_order: 1 },
    { code: 'mount',       name: 'Mount Lebanon',    pricing_multiplier: 1.00, is_default: true,  sort_order: 2 },
    { code: 'north',       name: 'North Lebanon',    pricing_multiplier: 0.50, is_default: false, sort_order: 3 },
    { code: 'bekaa',       name: 'Bekaa',            pricing_multiplier: 0.50, is_default: false, sort_order: 4 },
    { code: 'south',       name: 'South Lebanon',    pricing_multiplier: 0.55, is_default: false, sort_order: 5 },
    { code: 'nabatieh',    name: 'Nabatieh',         pricing_multiplier: 0.45, is_default: false, sort_order: 6 },
    { code: 'baalbek',     name: 'Baalbek-Hermel',   pricing_multiplier: 0.40, is_default: false, sort_order: 7 },
    { code: 'akkar',       name: 'Akkar',            pricing_multiplier: 0.40, is_default: false, sort_order: 8 },
  ],
  AE: [
    { code: 'dubai',       name: 'Dubai',            pricing_multiplier: 1.50, is_default: true,  sort_order: 1 },
    { code: 'abu_dhabi',   name: 'Abu Dhabi',        pricing_multiplier: 1.25, is_default: false, sort_order: 2 },
    { code: 'sharjah',     name: 'Sharjah',          pricing_multiplier: 0.90, is_default: false, sort_order: 3 },
    { code: 'ajman',       name: 'Ajman',            pricing_multiplier: 0.70, is_default: false, sort_order: 4 },
    { code: 'rak',         name: 'Ras Al Khaimah',   pricing_multiplier: 0.75, is_default: false, sort_order: 5 },
    { code: 'fujairah',    name: 'Fujairah',         pricing_multiplier: 0.65, is_default: false, sort_order: 6 },
    { code: 'uaq',         name: 'Umm Al Quwain',    pricing_multiplier: 0.60, is_default: false, sort_order: 7 },
  ],
  JO: [{ code: 'default', name: 'All Jordan',   pricing_multiplier: 1.00, is_default: true, sort_order: 1 }],
  SY: [{ code: 'default', name: 'All Syria',    pricing_multiplier: 1.00, is_default: true, sort_order: 1 }],
  EG: [{ code: 'default', name: 'All Egypt',    pricing_multiplier: 1.00, is_default: true, sort_order: 1 }],
  KW: [{ code: 'default', name: 'All Kuwait',   pricing_multiplier: 1.00, is_default: true, sort_order: 1 }],
  QA: [{ code: 'default', name: 'All Qatar',    pricing_multiplier: 1.00, is_default: true, sort_order: 1 }],
  OM: [{ code: 'default', name: 'All Oman',     pricing_multiplier: 1.00, is_default: true, sort_order: 1 }],
  AU: [{ code: 'default', name: 'All Australia',pricing_multiplier: 1.00, is_default: true, sort_order: 1 }],
  FR: [{ code: 'default', name: 'All France',   pricing_multiplier: 1.00, is_default: true, sort_order: 1 }],
  IT: [{ code: 'default', name: 'All Italy',    pricing_multiplier: 1.00, is_default: true, sort_order: 1 }],
  ES: [{ code: 'default', name: 'All Spain',    pricing_multiplier: 1.00, is_default: true, sort_order: 1 }],
  SA: [{ code: 'default', name: 'All Saudi Arabia', pricing_multiplier: 1.00, is_default: true, sort_order: 1 }],
  DE: [{ code: 'default', name: 'All Germany',  pricing_multiplier: 1.00, is_default: true, sort_order: 1 }],
  US: [{ code: 'default', name: 'All United States', pricing_multiplier: 1.00, is_default: true, sort_order: 1 }],
  GB: [{ code: 'default', name: 'All United Kingdom',pricing_multiplier: 1.00, is_default: true, sort_order: 1 }],
}

// A small canonical city list per launched market. Admin can add more
// via the CRUD UI; the seed only bootstraps enough so the resolver's
// city→zone path is exercised at launch.
const CITY_SEED = {
  LB: [
    { name: 'Beirut',      zone_code: 'beirut'   },
    { name: 'Ashrafieh',   zone_code: 'beirut'   },
    { name: 'Hamra',       zone_code: 'beirut'   },
    { name: 'Verdun',      zone_code: 'beirut'   },
    { name: 'Achrafieh',   zone_code: 'beirut'   },
    { name: 'Jounieh',     zone_code: 'mount'    },
    { name: 'Jbeil',       zone_code: 'mount'    },
    { name: 'Baabda',      zone_code: 'mount'    },
    { name: 'Broummana',   zone_code: 'mount'    },
    { name: 'Aley',        zone_code: 'mount'    },
    { name: 'Tripoli',     zone_code: 'north'    },
    { name: 'Batroun',     zone_code: 'north'    },
    { name: 'Zahle',       zone_code: 'bekaa'    },
    { name: 'Chtaura',     zone_code: 'bekaa'    },
    { name: 'Sidon',       zone_code: 'south'    },
    { name: 'Tyre',        zone_code: 'south'    },
    { name: 'Nabatieh',    zone_code: 'nabatieh' },
    { name: 'Baalbek',     zone_code: 'baalbek'  },
    { name: 'Halba',       zone_code: 'akkar'    },
  ],
  AE: [
    { name: 'Dubai',       zone_code: 'dubai'     },
    { name: 'Downtown Dubai', zone_code: 'dubai'  },
    { name: 'Dubai Marina',zone_code: 'dubai'     },
    { name: 'Palm Jumeirah', zone_code: 'dubai'   },
    { name: 'Abu Dhabi',   zone_code: 'abu_dhabi' },
    { name: 'Al Ain',      zone_code: 'abu_dhabi' },
    { name: 'Sharjah',     zone_code: 'sharjah'   },
    { name: 'Ajman',       zone_code: 'ajman'     },
    { name: 'Ras Al Khaimah', zone_code: 'rak'    },
    { name: 'Fujairah',    zone_code: 'fujairah'  },
    { name: 'Umm Al Quwain', zone_code: 'uaq'     },
  ],
}

/**
 * Idempotent seed. Runs at billing module boot.
 */
export async function seedPricingHierarchy() {
  await ensureSeedRateCard()

  for (const t of TERRITORY_SEED) {
    let territory = await getTerritoryByCode(t.code)
    // Ensure the per-territory partition of commercial.usage_events
    // exists even for territories seeded on a prior boot (idempotent).
    if (territory) {
      await ensureUsageEventsPartition(territory.id, territory.code).catch(() => {})
    }
    if (!territory) {
      territory = await createTerritory({
        code: t.code,
        name: t.name,
        currency: t.currency,
        pricing_multiplier: t.pricing_multiplier,
        launch_status: t.status,
        launch_wave: t.wave,
        data_residency_required: t.data_residency === true,
        billing_mode: t.billing_mode || 'card',
        vat_percent: t.vat_percent,
        regulator_id_type: t.regulator_id_type,
        payment_gateway_primary: t.payment_primary,
        payment_gateway_secondary: t.payment_secondary,
        sort_order: t.wave * 100,
      })
      logger.info({ code: t.code, wave: t.wave, status: t.status }, 'seeded territory')
    }

    const zones = ZONE_SEED[t.code] || []
    const existingZones = await listZones({ territoryId: territory.id, includeInactive: true })
    const existingCodes = new Set(existingZones.map((z) => z.code))
    for (const z of zones) {
      if (existingCodes.has(z.code)) continue
      await createZone({
        territory_id: territory.id,
        code: z.code,
        name: z.name,
        pricing_multiplier: z.pricing_multiplier,
        is_default: z.is_default,
        sort_order: z.sort_order,
      })
      logger.info({ territory: t.code, zone: z.code }, 'seeded zone')
    }

    // Backfill default_zone_id if we just seeded zones for the first time
    if (!territory.default_zone_id) {
      const all = await listZones({ territoryId: territory.id })
      const def = all.find((z) => z.is_default) || all[0]
      if (def) await updateTerritory(territory.id, { default_zone_id: def.id })
    }

    const cities = CITY_SEED[t.code] || []
    if (cities.length) {
      const allZones = await listZones({ territoryId: territory.id })
      const zoneByCode = new Map(allZones.map((z) => [z.code, z]))
      for (const c of cities) {
        const zone = zoneByCode.get(c.zone_code)
        if (!zone) continue
        const existing = await findCityByName(territory.id, c.name)
        if (existing) continue
        await createCity({
          territory_id: territory.id,
          zone_id: zone.id,
          name: c.name,
        })
      }
    }
  }
  logger.info('pricing hierarchy seed complete')
}
