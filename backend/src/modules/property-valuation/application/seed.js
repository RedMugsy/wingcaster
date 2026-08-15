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

}
