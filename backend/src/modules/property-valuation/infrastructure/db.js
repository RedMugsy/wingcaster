import { insert, findOne, findAll, update, remove, query, transaction } from '../../../db.js'

export const Collections = {
  PRICING_MATCH_CONFIGS: 'pricing_match_configs',
  PRICING_SOURCES: 'pricing_sources',
  PRICING_NORMALIZATION_RULES: 'pricing_normalization_rules',
  PROPERTY_PRICE_ANALYSES: 'property_price_analyses',
  ANALYSIS_RUNS: 'pricing_analysis_runs',
  ANALYSIS_COMPARABLE_EVIDENCE: 'analysis_comparable_evidence',
  PRICING_DECISIONS: 'pricing_decisions',
  EXTERNAL_COMPARABLES: 'external_comparables',
  PRICE_TREND_SNAPSHOTS: 'price_trend_snapshots',
  CURRENCY_RATES: 'currency_rates',
  COMPARABLE_REPORTS: 'comparable_reports',
  AGENT_PRICE_REPORTS: 'agent_price_reports',
  CSV_IMPORT_LOGS: 'csv_import_logs',
  RECALCULATION_JOBS: 'pricing_recalculation_jobs',
  RECALCULATION_JOB_ITEMS: 'pricing_recalculation_job_items',
}

export function createModuleDal() {
  return {
    insert: (collection, item) => insert(collection, item),
    findOne: (collection, filter) => findOne(collection, filter),
    findAll: (collection, filter) => findAll(collection, filter),
    update: (collection, filter, updater) => update(collection, filter, updater),
    remove: (collection, filter) => remove(collection, filter),
    query: (sql, params) => query(sql, params),
    transaction: (work) => transaction(work),
    async count(collection, filter) {
      const items = await findAll(collection, filter || (() => true))
      return items.length
    },
  }
}
