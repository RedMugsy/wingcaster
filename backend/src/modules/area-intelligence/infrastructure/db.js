import { findAll, findOne, insert, update, remove } from '../../../db.js'

export const Collections = {
  AREA_PROFILES: 'area_profiles',
  SCORE_DIMENSIONS: 'score_dimensions',
  SOURCE_TYPES: 'source_types',
  AREA_SOURCES: 'area_sources',
  AREA_SIGNALS: 'area_signals',
  AREA_SCORE_CALCULATIONS: 'area_score_calculations',
  AI_SCORING_CONFIGS: 'ai_scoring_configs',
  AREA_GOOGLE_SCORES: 'area_google_scores',
  INSPECTOR_ASSIGNMENTS: 'inspector_assignments',
  INSPECTION_SUBMISSIONS: 'inspection_submissions',
  GOOGLE_API_USAGE_LOG: 'google_api_usage_log',
}

export function findAllModule(collection, filter) {
  return findAll(collection, filter)
}

export function findOneModule(collection, filter) {
  return findOne(collection, filter)
}

export function insertModule(collection, item) {
  return insert(collection, item)
}

export function updateModule(collection, filter, updater) {
  return update(collection, filter, updater)
}

export function removeModule(collection, filter) {
  return remove(collection, filter)
}
