export const AreaLevel = {
  CITY: 'city',
  VILLAGE: 'village',
  NEIGHBORHOOD: 'neighborhood',
  TERRITORY: 'territory',
}

export const AreaStatus = {
  DRAFT: 'draft',
  UNDER_REVIEW: 'under_review',
  SCORING_ENABLED: 'scoring_enabled',
  ARCHIVED: 'archived',
}

export const SignalStatus = {
  PENDING_EXTRACTION: 'pending_extraction',
  EXTRACTED: 'extracted',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
}

export const AssignmentStatus = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  SKIPPED: 'skipped',
}

export const SubmissionStatus = {
  PENDING_REVIEW: 'pending_review',
  APPROVED: 'approved',
  REJECTED: 'rejected',
}

export const ScoringLogic = {
  WEIGHTED_AVERAGE: 'weighted_average',
  CONDITIONAL_RULES: 'conditional_rules',
  AI_SYNTHESIS: 'ai_synthesis',
  COMPOSITE: 'composite',
  MANUAL_ONLY: 'manual_only',
}

export const Archetype = {
  OFFICIAL_GOVERNMENT: 'official_government',
  GRASSROOTS_COMMUNITY: 'grassroots_community',
  COMMERCIAL_BUSINESS: 'commercial_business',
  NEWS_MEDIA: 'news_media',
  CULTURAL_ORGANIZATION: 'cultural_organization',
  FIELD_INSPECTION: 'field_inspection',
  GOOGLE_PLACES: 'google_places',
}

export const InputMethod = {
  GOOGLE_PLACES_API: 'google_places_api',
  GOOGLE_DISTANCE_MATRIX_API: 'google_distance_matrix_api',
  FIELD_MOBILE_FORM: 'field_mobile_form',
  WEB_FORM: 'web_form',
  RSS_FEED: 'rss_feed',
  WEB_SCRAPER: 'web_scraper',
  MANUAL_UPLOAD: 'manual_upload',
  WHATSAPP_COMMUNITY: 'whatsapp_community',
  SOCIAL_API: 'social_api',
}

export const SourceTypeSlug = {
  GOOGLE_PLACES_PROXIMITY: 'google_places_proximity',
  GOOGLE_PLACES_EDUCATION: 'google_places_education',
  GOOGLE_PLACES_FITNESS: 'google_places_fitness',
  GOOGLE_PLACES_MEDICAL: 'google_places_medical',
  GOOGLE_PLACES_FNBAR: 'google_places_fnbar',
  GOOGLE_DISTANCE_WALKING: 'google_distance_walking',
  GOOGLE_DISTANCE_DRIVING: 'google_distance_driving',
  FIELD_INSPECTION: 'field_inspection',
}

export const DimensionSlug = {
  PROXIMITY_ACCESSIBILITY: 'proximity_accessibility',
  WALKING_SCORE: 'walking_score',
  EDUCATION_ACCESS: 'education_access',
  FITNESS_RECREATION: 'fitness_recreation',
  MEDICAL_ACCESS: 'medical_access',
  SAFETY_SECURITY: 'safety_security',
  FNB_SCENE: 'fnb_scene',
  COMMUNITY_DYNAMISM: 'community_dynamism',
  INFRASTRUCTURE_MOMENTUM: 'infrastructure_momentum',
  POWER_GRID_STABILITY: 'power_grid_stability',
  OVERALL_LIVABILITY: 'overall_livability',
}

export const ArchetypeDefaults = {
  [Archetype.OFFICIAL_GOVERNMENT]: { reliability: 0.90, decayDays: 180 },
  [Archetype.GRASSROOTS_COMMUNITY]: { reliability: 0.70, decayDays: 60 },
  [Archetype.COMMERCIAL_BUSINESS]: { reliability: 0.60, decayDays: 90 },
  [Archetype.NEWS_MEDIA]: { reliability: 0.85, decayDays: 90 },
  [Archetype.CULTURAL_ORGANIZATION]: { reliability: 0.65, decayDays: 120 },
  [Archetype.FIELD_INSPECTION]: { reliability: 1.00, decayDays: 365 },
  [Archetype.GOOGLE_PLACES]: { reliability: 0.80, decayDays: 30 },
}

export function defaultScoreDimensions() {
  return [
    {
      name: 'Proximity & Accessibility',
      name_ar: 'القرب وإمكانية الوصول',
      slug: DimensionSlug.PROXIMITY_ACCESSIBILITY,
      description: 'Access to daily essentials and services',
      display_config: { type: 'gauge', color: '#3B82F6', icon: 'map-pin' },
      scoring_logic_config: { logic: ScoringLogic.WEIGHTED_AVERAGE },
      composite_weight: 0.15,
      sort_order: 1,
      is_active: true,
      is_default: true,
    },
    {
      name: 'Walking Score',
      name_ar: 'درجة المشي',
      slug: DimensionSlug.WALKING_SCORE,
      description: 'How walkable the area is',
      display_config: { type: 'gauge', color: '#10B981', icon: 'footprints' },
      scoring_logic_config: { logic: ScoringLogic.WEIGHTED_AVERAGE },
      composite_weight: 0.15,
      sort_order: 2,
      is_active: true,
      is_default: true,
    },
    {
      name: 'Education Access',
      name_ar: 'الوصول إلى التعليم',
      slug: DimensionSlug.EDUCATION_ACCESS,
      description: 'Count and proximity of schools — not quality ratings',
      display_config: { type: 'gauge', color: '#8B5CF6', icon: 'graduation-cap' },
      scoring_logic_config: { logic: ScoringLogic.WEIGHTED_AVERAGE },
      composite_weight: 0.10,
      sort_order: 3,
      is_active: true,
      is_default: true,
    },
    {
      name: 'Fitness & Recreation',
      name_ar: 'اللياقة والترفيه',
      slug: DimensionSlug.FITNESS_RECREATION,
      description: 'Gyms, pools, parks and sports facilities',
      display_config: { type: 'gauge', color: '#F59E0B', icon: 'dumbbell' },
      scoring_logic_config: { logic: ScoringLogic.WEIGHTED_AVERAGE },
      composite_weight: 0.10,
      sort_order: 4,
      is_active: true,
      is_default: true,
    },
    {
      name: 'Medical Access',
      name_ar: 'الوصول إلى الخدمات الطبية',
      slug: DimensionSlug.MEDICAL_ACCESS,
      description: 'Hospitals, clinics, pharmacies and medical services',
      display_config: { type: 'gauge', color: '#EF4444', icon: 'heart-pulse' },
      scoring_logic_config: { logic: ScoringLogic.WEIGHTED_AVERAGE },
      composite_weight: 0.15,
      sort_order: 5,
      is_active: true,
      is_default: true,
    },
    {
      name: 'Safety & Security',
      name_ar: 'الأمان والحماية',
      slug: DimensionSlug.SAFETY_SECURITY,
      description: 'Field-inspection only safety assessment',
      display_config: { type: 'gauge', color: '#6B7280', icon: 'shield' },
      scoring_logic_config: { logic: ScoringLogic.MANUAL_ONLY },
      composite_weight: 0.15,
      sort_order: 6,
      is_active: true,
      is_default: true,
    },
    {
      name: 'F&B Scene',
      name_ar: 'مشهد المطاعم والمقاهي',
      slug: DimensionSlug.FNB_SCENE,
      description: 'Restaurants, cafes, bars and bakeries',
      display_config: { type: 'gauge', color: '#EC4899', icon: 'utensils' },
      scoring_logic_config: { logic: ScoringLogic.WEIGHTED_AVERAGE },
      composite_weight: 0.10,
      sort_order: 7,
      is_active: true,
      is_default: true,
    },
    {
      name: 'Community Dynamism',
      name_ar: 'حيوية المجتمع',
      slug: DimensionSlug.COMMUNITY_DYNAMISM,
      description: 'Events, social activity, community coordination',
      display_config: { type: 'gauge', color: '#14B8A6', icon: 'users' },
      scoring_logic_config: { logic: ScoringLogic.AI_SYNTHESIS },
      composite_weight: 0.00,
      sort_order: 8,
      is_active: true,
      is_default: true,
    },
    {
      name: 'Infrastructure Momentum',
      name_ar: 'زخم البنية التحتية',
      slug: DimensionSlug.INFRASTRUCTURE_MOMENTUM,
      description: 'Roads, utilities, public projects momentum',
      display_config: { type: 'gauge', color: '#6366F1', icon: 'hard-hat' },
      scoring_logic_config: { logic: ScoringLogic.AI_SYNTHESIS },
      composite_weight: 0.00,
      sort_order: 9,
      is_active: true,
      is_default: true,
    },
    {
      name: 'Power Grid Stability',
      name_ar: 'استقرار شبكة الكهرباء',
      slug: DimensionSlug.POWER_GRID_STABILITY,
      description: 'Electricity reliability — Lebanon-specific field score',
      display_config: { type: 'gauge', color: '#EAB308', icon: 'zap' },
      scoring_logic_config: { logic: ScoringLogic.MANUAL_ONLY },
      composite_weight: 0.20,
      sort_order: 10,
      is_active: true,
      is_default: true,
    },
    {
      name: 'Overall Livability',
      name_ar: 'جودة المعيشة الإجمالية',
      slug: DimensionSlug.OVERALL_LIVABILITY,
      description: 'Composite livability score',
      display_config: { type: 'gauge', color: '#0F0F0F', icon: 'home' },
      scoring_logic_config: {
        logic: ScoringLogic.COMPOSITE,
        components: [
          { dimension_slug: DimensionSlug.PROXIMITY_ACCESSIBILITY, weight: 0.15 },
          { dimension_slug: DimensionSlug.WALKING_SCORE, weight: 0.15 },
          { dimension_slug: DimensionSlug.EDUCATION_ACCESS, weight: 0.10 },
          { dimension_slug: DimensionSlug.MEDICAL_ACCESS, weight: 0.15 },
          { dimension_slug: DimensionSlug.FNB_SCENE, weight: 0.10 },
          { dimension_slug: DimensionSlug.SAFETY_SECURITY, weight: 0.15 },
          { dimension_slug: DimensionSlug.POWER_GRID_STABILITY, weight: 0.20 },
        ],
      },
      composite_weight: 0.00,
      sort_order: 11,
      is_active: true,
      is_default: true,
    },
  ]
}

export function defaultSourceTypes() {
  const googlePlacesArchetype = Archetype.GOOGLE_PLACES
  const fieldArchetype = Archetype.FIELD_INSPECTION

  return [
    {
      name: 'Google Places — Proximity',
      slug: SourceTypeSlug.GOOGLE_PLACES_PROXIMITY,
      description: 'Nearby grocery, pharmacy, school, cafe, bank, gas station, park',
      archetype: googlePlacesArchetype,
      platform: 'google_places',
      input_method: InputMethod.GOOGLE_PLACES_API,
      extraction_config: {
        categories: ['grocery_or_supermarket', 'pharmacy', 'school', 'cafe', 'bank', 'gas_station', 'park'],
        radii_meters: [3000, 5000, 10000],
        dimension_slug: DimensionSlug.PROXIMITY_ACCESSIBILITY,
      },
      default_reliability: ArchetypeDefaults[googlePlacesArchetype].reliability,
      default_decay_days: ArchetypeDefaults[googlePlacesArchetype].decayDays,
      is_active: true,
      is_default: true,
    },
    {
      name: 'Google Places — Education',
      slug: SourceTypeSlug.GOOGLE_PLACES_EDUCATION,
      description: 'Preschool, primary, secondary, university',
      archetype: googlePlacesArchetype,
      platform: 'google_places',
      input_method: InputMethod.GOOGLE_PLACES_API,
      extraction_config: {
        categories: ['preschool', 'primary_school', 'secondary_school', 'university'],
        radii_meters: [3000, 5000, 10000],
        dimension_slug: DimensionSlug.EDUCATION_ACCESS,
      },
      default_reliability: ArchetypeDefaults[googlePlacesArchetype].reliability,
      default_decay_days: ArchetypeDefaults[googlePlacesArchetype].decayDays,
      is_active: true,
      is_default: true,
    },
    {
      name: 'Google Places — Fitness',
      slug: SourceTypeSlug.GOOGLE_PLACES_FITNESS,
      description: 'Gyms, sports complexes, pools, parks',
      archetype: googlePlacesArchetype,
      platform: 'google_places',
      input_method: InputMethod.GOOGLE_PLACES_API,
      extraction_config: {
        categories: ['gym', 'sports_complex', 'swimming_pool', 'park'],
        radii_meters: [3000, 5000],
        dimension_slug: DimensionSlug.FITNESS_RECREATION,
      },
      default_reliability: ArchetypeDefaults[googlePlacesArchetype].reliability,
      default_decay_days: ArchetypeDefaults[googlePlacesArchetype].decayDays,
      is_active: true,
      is_default: true,
    },
    {
      name: 'Google Places — Medical',
      slug: SourceTypeSlug.GOOGLE_PLACES_MEDICAL,
      description: 'Hospitals, clinics, dentists, physiotherapists, pharmacies',
      archetype: googlePlacesArchetype,
      platform: 'google_places',
      input_method: InputMethod.GOOGLE_PLACES_API,
      extraction_config: {
        categories: ['hospital', 'doctor', 'dentist', 'physiotherapist', 'pharmacy'],
        radii_meters: [3000, 5000, 10000],
        dimension_slug: DimensionSlug.MEDICAL_ACCESS,
      },
      default_reliability: ArchetypeDefaults[googlePlacesArchetype].reliability,
      default_decay_days: ArchetypeDefaults[googlePlacesArchetype].decayDays,
      is_active: true,
      is_default: true,
    },
    {
      name: 'Google Places — F&B',
      slug: SourceTypeSlug.GOOGLE_PLACES_FNBAR,
      description: 'Restaurants, cafes, bars, bakeries',
      archetype: googlePlacesArchetype,
      platform: 'google_places',
      input_method: InputMethod.GOOGLE_PLACES_API,
      extraction_config: {
        categories: ['restaurant', 'cafe', 'bar', 'bakery'],
        radii_meters: [3000, 5000],
        dimension_slug: DimensionSlug.FNB_SCENE,
      },
      default_reliability: ArchetypeDefaults[googlePlacesArchetype].reliability,
      default_decay_days: ArchetypeDefaults[googlePlacesArchetype].decayDays,
      is_active: true,
      is_default: true,
    },
    {
      name: 'Google Distance — Walking',
      slug: SourceTypeSlug.GOOGLE_DISTANCE_WALKING,
      description: 'Walking time to nearest key categories',
      archetype: googlePlacesArchetype,
      platform: 'google_maps',
      input_method: InputMethod.GOOGLE_DISTANCE_MATRIX_API,
      extraction_config: {
        mode: 'walking',
        categories: ['grocery_or_supermarket', 'pharmacy', 'school', 'cafe', 'park'],
        dimension_slug: DimensionSlug.WALKING_SCORE,
      },
      default_reliability: ArchetypeDefaults[googlePlacesArchetype].reliability,
      default_decay_days: ArchetypeDefaults[googlePlacesArchetype].decayDays,
      is_active: true,
      is_default: true,
    },
    {
      name: 'Google Distance — Driving',
      slug: SourceTypeSlug.GOOGLE_DISTANCE_DRIVING,
      description: 'Driving time to landmarks (beach, ski, airport, city center)',
      archetype: googlePlacesArchetype,
      platform: 'google_maps',
      input_method: InputMethod.GOOGLE_DISTANCE_MATRIX_API,
      extraction_config: {
        mode: 'driving',
        destinations: [
          { type: 'beach', keywords: ['beach'] },
          { type: 'ski', keywords: ['ski resort'] },
          { type: 'airport', keywords: ['airport'] },
          { type: 'city_center', keywords: ['city center'] },
        ],
        dimension_slug: DimensionSlug.PROXIMITY_ACCESSIBILITY,
      },
      default_reliability: ArchetypeDefaults[googlePlacesArchetype].reliability,
      default_decay_days: ArchetypeDefaults[googlePlacesArchetype].decayDays,
      is_active: true,
      is_default: true,
    },
    {
      name: 'Field Inspection',
      slug: SourceTypeSlug.FIELD_INSPECTION,
      description: 'Ground truth from assigned field inspectors',
      archetype: fieldArchetype,
      platform: 'field_team',
      input_method: InputMethod.FIELD_MOBILE_FORM,
      extraction_config: { dimensions: Object.values(DimensionSlug) },
      default_reliability: ArchetypeDefaults[fieldArchetype].reliability,
      default_decay_days: ArchetypeDefaults[fieldArchetype].decayDays,
      is_active: true,
      is_default: true,
    },
  ]
}

export function defaultAiScoringConfig() {
  return {
    name: 'Default Area Narrative & Synthesis',
    description: 'Gemini-powered narrative and ai_synthesis scoring',
    provider: 'gemini',
    model: 'gemini-1.5-flash',
    temperature: 0.3,
    max_tokens: 2048,
    system_prompt: `You are an expert real estate location analyst for Lebanon. You analyze neighborhood and city data to produce concise, factual area intelligence. You never claim data you do not have. You always respond in valid JSON matching the requested output_schema.`,
    scoring_prompt_template: `Analyze the following signals for the area "{{area_name}}" ({{area_level}}).

Signals:
{{signals_json}}

Instructions: {{task_instructions}}

Respond ONLY with valid JSON matching the schema. Do not include markdown formatting.`,
    output_schema: {
      type: 'object',
      properties: {
        score: { type: 'number', minimum: 0, maximum: 10 },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        rationale: { type: 'string' },
        summary: { type: 'string' },
        summary_ar: { type: 'string' },
      },
      required: ['score', 'confidence', 'rationale', 'summary', 'summary_ar'],
    },
    is_active: true,
  }
}

export function defaultAreas() {
  return [
    {
      name: 'Batroun',
      name_ar: 'بطرون',
      slug: 'batroun',
      level: AreaLevel.CITY,
      center_latitude: 34.2559,
      center_longitude: 35.6586,
      proximity_radii_json: { local: 3000, secondary: 5000, macro: 10000 },
      summary: 'Coastal city in North Lebanon known for its historic old town, seafront, and growing tourism.',
      summary_ar: 'مدينة ساحلية في شمال لبنان تشتهر ببلدتها القديمة التاريخية وواجهتها البحرية وتنامي السياحة فيها.',
      status: AreaStatus.DRAFT,
    },
    {
      name: 'Mar Mikhael',
      name_ar: 'مار ميخائيل',
      slug: 'mar-mikhael',
      level: AreaLevel.NEIGHBORHOOD,
      center_latitude: 33.8938,
      center_longitude: 35.5226,
      proximity_radii_json: { local: 1000, secondary: 3000, macro: 5000 },
      summary: 'Trendy Beirut neighborhood with a vibrant bar, restaurant, and arts scene.',
      summary_ar: 'حي بيروتي عصري يتميز بمشهد حيوي للبارات والمطاعم والفنون.',
      status: AreaStatus.DRAFT,
    },
  ]
}

export function defaultRadiiForLevel(level) {
  switch (level) {
    case AreaLevel.CITY:
    case AreaLevel.VILLAGE:
    case AreaLevel.TERRITORY:
      return { local: 3000, secondary: 5000, macro: 10000 }
    case AreaLevel.NEIGHBORHOOD:
      return { local: 1000, secondary: 3000, macro: 5000 }
    default:
      return { local: 3000, secondary: 5000, macro: 10000 }
  }
}
