import { v4 as uuidv4 } from 'uuid'
import {
  defaultScoreDimensions,
  defaultSourceTypes,
  defaultAiScoringConfig,
  defaultAreas,
} from '../domain/types.js'
import { findAllModule, insertModule } from '../infrastructure/db.js'

export async function seedAreaIntelligenceDefaults() {
  const existingDimensions = await findAllModule('score_dimensions')
  if (existingDimensions.length === 0) {
    for (const dim of defaultScoreDimensions()) {
      await insertModule('score_dimensions', {
        id: uuidv4(),
        ...dim,
        display_config: JSON.stringify(dim.display_config),
        scoring_logic_config: JSON.stringify(dim.scoring_logic_config),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
    }
  }

  const existingSourceTypes = await findAllModule('source_types')
  if (existingSourceTypes.length === 0) {
    for (const src of defaultSourceTypes()) {
      await insertModule('source_types', {
        id: uuidv4(),
        ...src,
        extraction_config: JSON.stringify(src.extraction_config),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
    }
  }

  const existingConfigs = await findAllModule('ai_scoring_configs')
  if (existingConfigs.length === 0) {
    const cfg = defaultAiScoringConfig()
    await insertModule('ai_scoring_configs', {
      id: uuidv4(),
      ...cfg,
      output_schema: JSON.stringify(cfg.output_schema),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
  }

  const existingAreas = await findAllModule('area_profiles')
  if (existingAreas.length === 0) {
    for (const area of defaultAreas()) {
      await insertModule('area_profiles', {
        id: uuidv4(),
        ...area,
        boundary_geojson: null,
        lifestyle_profile: '',
        investment_outlook: '',
        activity_score: null,
        activity_trend: null,
        family_profile_skew: null,
        estimated_population_density: null,
        published_at: null,
        proximity_radii_json: JSON.stringify(area.proximity_radii_json),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
    }
  }
}
