import { v4 as uuidv4 } from 'uuid'
import { Collections } from '../infrastructure/db.js'
import {
  DEFAULT_MATCH_CONFIG,
  DEFAULT_NORMALIZATION_RULES,
  DEFAULT_PRICING_SOURCES,
} from '../domain/types.js'

export async function seedMarketPricingDefaults({ dal, config, logger }) {
  // Default match config
  const existingDefaultConfig = await dal.findOne(Collections.PRICING_MATCH_CONFIGS, (c) => c.is_default === true)
  if (!existingDefaultConfig) {
    await dal.insert(Collections.PRICING_MATCH_CONFIGS, {
      id: uuidv4(),
      name: 'Default comparable match config',
      config_json: DEFAULT_MATCH_CONFIG,
      is_default: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    logger.info('Seeded default pricing match config')
  }

  // Default pricing sources
  for (const source of DEFAULT_PRICING_SOURCES) {
    const exists = await dal.findOne(Collections.PRICING_SOURCES, (s) => s.source === source.source)
    if (!exists) {
      await dal.insert(Collections.PRICING_SOURCES, {
        id: uuidv4(),
        ...source,
        config_json: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
    }
  }

  // Default normalization rules
  for (const rule of DEFAULT_NORMALIZATION_RULES) {
    const exists = await dal.findOne(
      Collections.PRICING_NORMALIZATION_RULES,
      (r) => r.rule_type === rule.rule_type && r.value === rule.value
    )
    if (!exists) {
      await dal.insert(Collections.PRICING_NORMALIZATION_RULES, {
        id: uuidv4(),
        ...rule,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
    }
  }

  // Seed a manual USD/LBP parallel rate if none exists
  const existingRate = await dal.findOne(
    Collections.CURRENCY_RATES,
    (r) => r.from_currency === 'LBP' && r.to_currency === config.baseCurrency
  )
  if (!existingRate) {
    await dal.insert(Collections.CURRENCY_RATES, {
      id: uuidv4(),
      from_currency: 'LBP',
      to_currency: config.baseCurrency,
      rate: config.defaultParallelRate,
      source: 'manual',
      source_config: { note: 'Default seeded rate. Update via admin panel.' },
      effective_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    logger.info({ rate: config.defaultParallelRate }, 'Seeded default LBP/USD parallel rate')
  }

  // Seed demo properties in Batroun and Mar Mikhael for immediate comparables.
  // Only create them if explicitly enabled via env (default false for production).
  if (config.seedDemoProperties) {
    await seedDemoProperties({ dal, config, logger })
  } else {
    logger.info('Demo property seed disabled (MARKET_PRICING_SEED_DEMO not true)')
  }
}

async function seedDemoProperties({ dal, config, logger }) {
  const areas = await dal.findAll('area_profiles', (a) => ['batroun', 'mar-mikhael'].includes(a.slug))
  if (!areas.length) {
    logger.info('No Batroun or Mar Mikhael area profiles found; skipping demo property seed')
    return
  }

  const existingDemo = await dal.findOne('properties', (p) => p.data?.source === 'market_pricing_demo_seed')
  if (existingDemo) {
    logger.info('Demo properties already seeded')
    return
  }

  const demoAgent = await dal.findOne('agents', () => true)
  if (!demoAgent) {
    logger.info('No agents found; skipping demo property seed')
    return
  }

  const propertyTemplates = [
    {
      slug: 'batroun',
      title: 'Sea-view villa in Batroun',
      property_type: 'villa',
      price: 450000,
      bedrooms: 3,
      bathrooms: 3,
      area: 220,
      condition: 'good',
      furnished: 'unfurnished',
      view_type: 'sea_view',
      payment_method: 'cash',
    },
    {
      slug: 'batroun',
      title: 'Modern apartment near Batroun old town',
      property_type: 'apartment',
      price: 210000,
      bedrooms: 2,
      bathrooms: 2,
      area: 110,
      condition: 'newly_renovated',
      furnished: 'semi_furnished',
      view_type: 'city_view',
      payment_method: 'cash',
    },
    {
      slug: 'batroun',
      title: 'Cozy chalet in Batroun hills',
      property_type: 'chalet',
      price: 175000,
      bedrooms: 1,
      bathrooms: 1,
      area: 70,
      condition: 'fair',
      furnished: 'fully_furnished',
      view_type: 'mountain_view',
      payment_method: 'cash',
    },
    {
      slug: 'mar-mikhael',
      title: 'Loft-style apartment in Mar Mikhael',
      property_type: 'apartment',
      price: 320000,
      bedrooms: 2,
      bathrooms: 2,
      area: 120,
      condition: 'newly_renovated',
      furnished: 'semi_furnished',
      view_type: 'city_view',
      payment_method: 'cash',
    },
    {
      slug: 'mar-mikhael',
      title: 'Renovated studio in Mar Mikhael',
      property_type: 'apartment',
      price: 145000,
      bedrooms: 1,
      bathrooms: 1,
      area: 55,
      condition: 'good',
      furnished: 'fully_furnished',
      view_type: 'city_view',
      payment_method: 'cash',
    },
  ]

  for (const tpl of propertyTemplates) {
    const area = areas.find((a) => a.slug === tpl.slug)
    if (!area) continue

    const id = uuidv4()
    const now = new Date().toISOString()
    await dal.insert('properties', {
      id,
      agent_id: demoAgent.id,
      agency_id: demoAgent.agency_id || null,
      canonical_id: id,
      title: tpl.title,
      description: `Demo property seeded for Market Pricing testing in ${area.name}.`,
      status: 'active',
      listing_type: 'sale',
      property_type: tpl.property_type,
      price: tpl.price,
      price_unit: 'total',
      bedrooms: tpl.bedrooms,
      bathrooms: tpl.bathrooms,
      area: tpl.area,
      area_unit: 'sqm',
      city: area.name,
      neighborhood: area.name,
      location: area.name,
      latitude: area.center_latitude,
      longitude: area.center_longitude,
      territory_id: 'territory-lb',
      marketplace_syndicated: true,
      asset_version: 1,
      last_asset_generated_at: now,
      listed_date: now.split('T')[0],
      views: 0,
      created_at: now,
      updated_at: now,
      data: {
        source: 'market_pricing_demo_seed',
        condition: tpl.condition,
        furnished: tpl.furnished,
        view_type: tpl.view_type,
        payment_method: tpl.payment_method,
      },
    })
  }

  logger.info('Seeded demo properties for Market Pricing')
}
