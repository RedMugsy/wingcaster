/**
 * Seed templates — shipped as owner_type='platform' (immutable) and
 * owner_type='store' (curated marketplace).
 *
 * `platform` templates always appear in every tenant's picker as the
 * "default" tab and cannot be edited. Agencies duplicate them to make
 * an editable copy.
 *
 * `store` templates appear in the "Template Store" tab. They can be
 * added to a tenant's library (duplicates into owner_type='agency' or
 * 'agent'), then customized freely.
 *
 * All templates author against `base_canvas: 1080x1080`. The renderer
 * scales layers proportionally for other platform sizes; templates can
 * declare `platform_overrides.<key>` for tighter per-platform layouts
 * where the responsive default doesn't look great (portrait vs landscape).
 */

/* eslint-disable no-multi-spaces */

const EDITORIAL = {
  id: 'platform_editorial_v1',
  schema_version: 1,
  name: 'Editorial',
  description: 'Cream ground, serif title, magazine-style hierarchy. Great for hero listings.',
  owner_type: 'platform',
  owner_id: null,
  engine: 'builtin',
  category: 'hero',
  tags: ['editorial', 'serif', 'minimal'],
  base_canvas: { width: 1080, height: 1080 },
  background: { color: '#FAF7F1' },
  layers: [
    { id: 'hero',       type: 'photo', bind: 'listing.photos[0]',
      x: 0, y: 0, w: 1080, h: 670, fit: 'cover' },
    { id: 'brand',      type: 'text',  bind: '{{upper brand.name | default: "LISTINGCLARION"}}',
      x: 1020, y: 630, size: 22, weight: 700, color: '#FFFFFF', font: "'Georgia', 'Times New Roman', serif", align: 'right',
      letter_spacing: '0.24em', stroke_color: 'rgba(0,0,0,0.35)', stroke_width: 2 },
    { id: 'title',      type: 'text',  bind: '{{truncate listing.title 40}}',
      x: 65, y: 780, size: 58, weight: 700, color: '#141310', font: "'Georgia', 'Times New Roman', serif" },
    { id: 'location',   type: 'text',  bind: '{{coalesce listing.neighborhood listing.city listing.location}}',
      x: 65, y: 830, size: 26, weight: 400, italic: true, color: '#5C574E', font: "'Georgia', 'Times New Roman', serif" },
    { id: 'divider',    type: 'line',  x: 65, y: 880, x2: 1015, y2: 880, color: '#E3DDCF', weight: 1 },
    { id: 'price',      type: 'text',  bind: '{{formatPrice listing.price listing.price_unit}}',
      x: 65, y: 950, size: 66, weight: 700, color: '#B98E3F', font: "'Georgia', 'Times New Roman', serif" },
    { id: 'meta',       type: 'text',  bind: '{{listing.bedrooms}} bd  ·  {{listing.bathrooms}} ba  ·  {{formatArea listing.area listing.area_unit}}',
      x: 1015, y: 950, size: 26, weight: 500, color: '#8B857A', align: 'right' },
    { id: 'agent_line', type: 'text',  bind: 'BY {{upper agent.name}}',
      show_if: 'agent.name', x: 65, y: 1035, size: 22, weight: 500, color: '#8B857A', letter_spacing: '0.14em' },
  ],
  platform_overrides: {
    instagram_story: {
      canvas: { width: 1080, height: 1920 },
      layers: {
        hero:       { x: 0, y: 0, w: 1080, h: 1150 },
        brand:      { x: 1020, y: 1110, size: 26 },
        title:      { x: 65, y: 1310, size: 72 },
        location:   { x: 65, y: 1380, size: 30 },
        divider:    { x: 65, y: 1450, x2: 1015, y2: 1450 },
        price:      { x: 65, y: 1560, size: 88 },
        meta:       { x: 1015, y: 1560, size: 30 },
        agent_line: { x: 65, y: 1830, size: 26 },
      },
    },
    x: {
      canvas: { width: 1600, height: 900 },
      layers: {
        hero:       { x: 0, y: 0, w: 900, h: 900 },
        brand:      { x: 860, y: 860, size: 22 },
        title:      { x: 950, y: 190, size: 62 },
        location:   { x: 950, y: 260, size: 30 },
        divider:    { x: 950, y: 340, x2: 1540, y2: 340 },
        price:      { x: 950, y: 460, size: 88 },
        meta:       { x: 950, y: 550, size: 30, align: 'left' },
        agent_line: { x: 950, y: 820, size: 24 },
      },
    },
  },
}

const BOLD_MODERN = {
  id: 'platform_bold_modern_v1',
  schema_version: 1,
  name: 'Bold Modern',
  description: 'High-contrast amber accent, offset white card, bold sans, icon meta row.',
  owner_type: 'platform',
  owner_id: null,
  engine: 'builtin',
  category: 'hero',
  tags: ['bold', 'sans', 'modern', 'accent'],
  base_canvas: { width: 1080, height: 1080 },
  background: { color: '#0F0F0F' },
  layers: [
    { id: 'accent_band', type: 'rect',
      x: 0, y: 0, w: 1080, h: 130, color: '{{brand.accent_color | default: "#EAB308"}}' },
    { id: 'brand',       type: 'text', bind: '{{upper brand.name | default: "LISTINGCLARION"}}',
      x: 55, y: 85, size: 30, weight: 900, color: '#0F0F0F', letter_spacing: '0.28em' },
    { id: 'type_label',  type: 'text', bind: 'FOR {{upper listing.type}}',
      x: 1025, y: 85, size: 22, weight: 700, color: '#0F0F0F', align: 'right', letter_spacing: '0.24em' },
    { id: 'card',        type: 'rect',
      x: 55, y: 160, w: 970, h: 870, color: '#FFFFFF', radius: 8 },
    { id: 'hero',        type: 'photo', bind: 'listing.photos[0]',
      x: 55, y: 160, w: 970, h: 540, fit: 'cover', radius: 8 },
    { id: 'title',       type: 'text', bind: '{{truncate listing.title 34}}',
      x: 115, y: 780, size: 52, weight: 900, color: '#0F0F0F' },
    { id: 'location',    type: 'text', bind: '{{coalesce listing.neighborhood listing.city listing.location}}',
      x: 115, y: 830, size: 26, weight: 500, color: '#3A3A3A' },
    { id: 'accent_bar',  type: 'rect',
      x: 115, y: 870, w: 100, h: 6, color: '{{brand.accent_color | default: "#EAB308"}}' },
    { id: 'price',       type: 'text', bind: '{{formatPrice listing.price listing.price_unit}}',
      x: 115, y: 950, size: 60, weight: 900, color: '#0F0F0F' },
    { id: 'ico_bed',     type: 'icon', icon: 'bed', x: 620, y: 900, size: 40, color: '#3A3A3A' },
    { id: 'txt_bed',     type: 'text', bind: '{{listing.bedrooms}}',
      show_if: 'listing.bedrooms > 0', x: 670, y: 935, size: 28, weight: 700, color: '#3A3A3A' },
    { id: 'ico_bath',    type: 'icon', icon: 'bath', x: 730, y: 900, size: 40, color: '#3A3A3A' },
    { id: 'txt_bath',    type: 'text', bind: '{{listing.bathrooms}}',
      show_if: 'listing.bathrooms > 0', x: 780, y: 935, size: 28, weight: 700, color: '#3A3A3A' },
    { id: 'ico_area',    type: 'icon', icon: 'area', x: 840, y: 900, size: 40, color: '#3A3A3A' },
    { id: 'txt_area',    type: 'text', bind: '{{listing.area}}',
      show_if: 'listing.area > 0', x: 895, y: 935, size: 28, weight: 700, color: '#3A3A3A' },
    { id: 'agent',       type: 'text', bind: 'WITH {{upper agent.name}}',
      show_if: 'agent.name', x: 970, y: 1000, size: 22, weight: 600, color: '#3A3A3A', align: 'right', letter_spacing: '0.14em' },
  ],
}

const LUXURY_DARK = {
  id: 'platform_luxury_dark_v1',
  schema_version: 1,
  name: 'Luxury Dark',
  description: 'Deep navy, gold-bordered photo, italic serif, centred layout.',
  owner_type: 'platform',
  owner_id: null,
  engine: 'builtin',
  category: 'hero',
  tags: ['luxury', 'dark', 'gold', 'serif'],
  base_canvas: { width: 1080, height: 1080 },
  background: { color: '#0B1220' },
  layers: [
    { id: 'brand',      type: 'text', bind: '{{upper brand.name | default: "LISTINGCLARION"}}',
      x: 540, y: 90, size: 22, weight: 700, color: '#C7A051', font: "'Georgia', 'Times New Roman', serif", align: 'center', letter_spacing: '0.34em' },
    { id: 'brand_rule', type: 'line', x: 460, y: 105, x2: 620, y2: 105, color: '#C7A051', weight: 1 },
    { id: 'photo_bg',   type: 'rect', x: 60, y: 160, w: 960, h: 620, color: '#0F1930', border_color: '#C7A051', border_width: 3 },
    { id: 'hero',       type: 'photo', bind: 'listing.photos[0]', x: 60, y: 160, w: 960, h: 620, fit: 'cover' },
    { id: 'location',   type: 'text', bind: '{{upper coalesce(listing.neighborhood, listing.city, listing.location)}}',
      show_if: 'listing.city', x: 540, y: 830, size: 24, color: '#9AA3B2', font: "'Georgia', 'Times New Roman', serif", align: 'center', letter_spacing: '0.28em' },
    { id: 'title',      type: 'text', bind: '{{truncate listing.title 42}}',
      x: 540, y: 900, size: 52, italic: true, color: '#EDE6D3', font: "'Georgia', 'Times New Roman', serif", align: 'center' },
    { id: 'price',      type: 'text', bind: '{{formatPrice listing.price listing.price_unit}}',
      x: 540, y: 970, size: 52, weight: 700, color: '#C7A051', font: "'Georgia', 'Times New Roman', serif", align: 'center' },
    { id: 'agent',      type: 'text', bind: '— presented by {{agent.name}}',
      show_if: 'agent.name', x: 540, y: 1040, size: 22, italic: true, color: '#C7A051', font: "'Georgia', 'Times New Roman', serif", align: 'center' },
  ],
}

/* ------------------------------ Store templates -------------------------- */

const STORE_JUST_LISTED = {
  id: 'store_just_listed_banner_v1',
  schema_version: 1,
  name: 'Just Listed Banner',
  description: 'Bold JUST LISTED banner over a full-bleed hero photo.',
  owner_type: 'store',
  owner_id: null,
  engine: 'builtin',
  category: 'announcement',
  tags: ['banner', 'just_listed', 'announcement'],
  base_canvas: { width: 1080, height: 1080 },
  background: { color: '#0F0F0F' },
  layers: [
    { id: 'hero',    type: 'photo', bind: 'listing.photos[0]', x: 0, y: 0, w: 1080, h: 1080, fit: 'cover' },
    { id: 'overlay', type: 'rect',  x: 0, y: 0, w: 1080, h: 1080, color: '#000000', opacity: 0.28 },
    { id: 'badge',   type: 'badge', bind: 'Just Listed',
      x: 320, y: 120, w: 440, h: 100, bg_color: '#EAB308', text_color: '#0F0F0F', radius: 50, size: 40, weight: 900 },
    { id: 'title',   type: 'text', bind: '{{truncate listing.title 42}}',
      x: 540, y: 780, size: 60, weight: 900, color: '#FFFFFF', align: 'center' },
    { id: 'price',   type: 'text', bind: '{{formatPrice listing.price listing.price_unit}}',
      x: 540, y: 870, size: 54, weight: 900, color: '#EAB308', align: 'center' },
    { id: 'meta',    type: 'text', bind: '{{listing.bedrooms}} BED  ·  {{listing.bathrooms}} BATH  ·  {{formatArea listing.area listing.area_unit}}',
      x: 540, y: 940, size: 26, weight: 700, color: '#FFFFFF', align: 'center', letter_spacing: '0.14em' },
    { id: 'agent',   type: 'text', bind: 'DM {{agent.name}} for a viewing',
      show_if: 'agent.name', x: 540, y: 1010, size: 22, weight: 500, color: '#FFFFFF', align: 'center', letter_spacing: '0.1em' },
  ],
}

const STORE_SOLD = {
  id: 'store_sold_stamp_v1',
  schema_version: 1,
  name: 'SOLD Stamp',
  description: 'Prominent SOLD stamp over the listing photo — for celebrating closes.',
  owner_type: 'store',
  owner_id: null,
  engine: 'builtin',
  category: 'announcement',
  tags: ['sold', 'closed', 'stamp'],
  base_canvas: { width: 1080, height: 1080 },
  background: { color: '#0F0F0F' },
  layers: [
    { id: 'hero',    type: 'photo', bind: 'listing.photos[0]', x: 0, y: 0, w: 1080, h: 1080, fit: 'cover' },
    { id: 'overlay', type: 'rect',  x: 0, y: 0, w: 1080, h: 1080, color: '#000000', opacity: 0.32 },
    { id: 'stamp_bg', type: 'rect',
      x: 340, y: 400, w: 400, h: 280, color: 'transparent', border_color: '#EA3B34', border_width: 6, radius: 12 },
    { id: 'stamp',   type: 'text', bind: 'SOLD',
      x: 540, y: 570, size: 140, weight: 900, color: '#EA3B34', align: 'center', letter_spacing: '0.05em' },
    { id: 'agent',   type: 'text', bind: 'Thank you to our client — brokered by {{agent.name}}',
      show_if: 'agent.name', x: 540, y: 780, size: 26, weight: 500, color: '#FFFFFF', align: 'center' },
    { id: 'brand',   type: 'text', bind: '{{upper brand.name | default: "LISTINGCLARION"}}',
      x: 540, y: 1010, size: 22, weight: 700, color: '#EAB308', align: 'center', letter_spacing: '0.28em' },
  ],
}

const STORE_PRICE_REDUCED = {
  id: 'store_price_reduced_v1',
  schema_version: 1,
  name: 'Price Reduced',
  description: 'Attention-grabbing PRICE REDUCED banner with the new price prominent.',
  owner_type: 'store',
  owner_id: null,
  engine: 'builtin',
  category: 'announcement',
  tags: ['price_reduced', 'announcement', 'urgent'],
  base_canvas: { width: 1080, height: 1080 },
  background: { color: '#FFFFFF' },
  layers: [
    { id: 'hero',    type: 'photo', bind: 'listing.photos[0]', x: 60, y: 220, w: 960, h: 540, fit: 'cover', radius: 8 },
    { id: 'badge',   type: 'badge', bind: 'Price Reduced',
      x: 300, y: 60, w: 480, h: 100, bg_color: '#DC2626', text_color: '#FFFFFF', radius: 50, size: 38, weight: 900 },
    { id: 'title',   type: 'text', bind: '{{truncate listing.title 42}}',
      x: 540, y: 830, size: 44, weight: 700, color: '#0F0F0F', align: 'center' },
    { id: 'price',   type: 'text', bind: 'Now {{formatPrice listing.price listing.price_unit}}',
      x: 540, y: 910, size: 62, weight: 900, color: '#DC2626', align: 'center' },
    { id: 'meta',    type: 'text', bind: '{{listing.bedrooms}} bd  ·  {{listing.bathrooms}} ba  ·  {{formatArea listing.area listing.area_unit}}',
      x: 540, y: 970, size: 24, weight: 500, color: '#5C574E', align: 'center' },
    { id: 'agent',   type: 'text', bind: 'Contact {{agent.name}} today',
      show_if: 'agent.name', x: 540, y: 1030, size: 22, weight: 500, color: '#0F0F0F', align: 'center' },
  ],
}

const STORE_OPEN_HOUSE = {
  id: 'store_open_house_v1',
  schema_version: 1,
  name: 'Open House',
  description: 'OPEN HOUSE card with photo, address, date+time slot ready for social.',
  owner_type: 'store',
  owner_id: null,
  engine: 'builtin',
  category: 'announcement',
  tags: ['open_house', 'event', 'schedule'],
  base_canvas: { width: 1080, height: 1080 },
  background: { color: '#FDF6EC' },
  layers: [
    { id: 'hero',    type: 'photo', bind: 'listing.photos[0]', x: 60, y: 60, w: 960, h: 540, fit: 'cover', radius: 8 },
    { id: 'header',  type: 'text', bind: 'OPEN HOUSE',
      x: 540, y: 680, size: 60, weight: 900, color: '#0F0F0F', align: 'center', letter_spacing: '0.14em' },
    { id: 'address', type: 'text', bind: '{{coalesce listing.address listing.location listing.city}}',
      x: 540, y: 750, size: 32, weight: 500, color: '#3A3A3A', align: 'center' },
    { id: 'meta',    type: 'text', bind: '{{listing.bedrooms}} bd  ·  {{listing.bathrooms}} ba  ·  {{formatArea listing.area listing.area_unit}}',
      x: 540, y: 820, size: 26, weight: 500, color: '#5C574E', align: 'center' },
    { id: 'cta',     type: 'text', bind: 'RSVP with {{agent.name | default: "your agent"}}',
      x: 540, y: 990, size: 26, weight: 700, color: '#0F0F0F', align: 'center', letter_spacing: '0.14em' },
    { id: 'ico_pin', type: 'icon', icon: 'pin', x: 900, y: 60, size: 60, color: '#B98E3F' },
  ],
}

const STORE_AGENT_INTRO = {
  id: 'store_agent_intro_v1',
  schema_version: 1,
  name: 'Meet Your Agent',
  description: 'Warm intro card featuring the agent photo + name + specialization + contact CTA.',
  owner_type: 'store',
  owner_id: null,
  engine: 'builtin',
  category: 'agent',
  tags: ['agent', 'intro', 'branding'],
  base_canvas: { width: 1080, height: 1080 },
  background: { color: '#F5F1EA' },
  layers: [
    { id: 'photo',   type: 'photo', bind: 'agent.photo', x: 340, y: 120, w: 400, h: 400, fit: 'cover', radius: 200 },
    { id: 'name',    type: 'text',  bind: '{{agent.name}}', x: 540, y: 620, size: 62, weight: 700, color: '#0F0F0F', align: 'center', font: "'Georgia', 'Times New Roman', serif" },
    { id: 'spec',    type: 'text',  bind: '{{agent.specialization | default: "Real estate specialist"}}',
      x: 540, y: 690, size: 28, weight: 500, italic: true, color: '#5C574E', align: 'center', font: "'Georgia', 'Times New Roman', serif" },
    { id: 'divider', type: 'line',  x: 440, y: 750, x2: 640, y2: 750, color: '#C7A051', weight: 1 },
    { id: 'agency',  type: 'text',  bind: '{{agent.agency_name}}', x: 540, y: 810, size: 30, weight: 500, color: '#0F0F0F', align: 'center' },
    { id: 'contact', type: 'text',  bind: '{{agent.phone}}  ·  {{agent.email}}',
      x: 540, y: 890, size: 24, weight: 500, color: '#5C574E', align: 'center' },
    { id: 'brand',   type: 'text',  bind: '{{upper brand.name | default: "LISTINGCLARION"}}',
      x: 540, y: 1010, size: 22, weight: 700, color: '#C7A051', align: 'center', letter_spacing: '0.28em' },
  ],
}

export const PLATFORM_TEMPLATES = [EDITORIAL, BOLD_MODERN, LUXURY_DARK]

export const STORE_TEMPLATES = [
  STORE_JUST_LISTED,
  STORE_SOLD,
  STORE_PRICE_REDUCED,
  STORE_OPEN_HOUSE,
  STORE_AGENT_INTRO,
]

export const ALL_SEED_TEMPLATES = [...PLATFORM_TEMPLATES, ...STORE_TEMPLATES]

/**
 * Idempotently ensure the seed templates exist in the DB. Called at boot.
 * Overwrites content of platform + store templates (they're immutable and
 * source-controlled here); never touches agency- or agent-owned rows.
 */
export async function seedSocialCardTemplates({ findOne, insert, update }) {
  for (const t of ALL_SEED_TEMPLATES) {
    const existing = await findOne('social_card_templates', (r) => r.id === t.id)
    const row = {
      ...t,
      created_at: existing?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    if (existing) {
      await update('social_card_templates', (r) => r.id === t.id, () => row)
    } else {
      await insert('social_card_templates', row)
    }
  }
}
