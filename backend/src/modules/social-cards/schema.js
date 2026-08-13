/**
 * Social-card template schema (v1).
 *
 * Templates are JSON, not hardcoded SVG. Layers are declarative and
 * data-bound. Layer coords are expressed against the template's
 * `base_canvas`; each platform's render either scales responsively OR
 * uses `platform_overrides.<platform>.layers.<layer_id>` to override
 * specific properties for that canvas size.
 *
 * Ownership model:
 *   platform — shipped defaults, immutable, visible to every tenant
 *   store    — curated marketplace, immutable, visible to every tenant
 *   agency   — private to an agency, editable by agency admins
 *   agent    — private to an individual agent, editable by them
 *
 * Layer types (v1):
 *   photo    — raster image, bound to a URL/data field, cover/contain fit
 *   text     — plain text with data binding + typography
 *   rect     — filled rectangle, optional border + rounded corners
 *   line     — 2-point line with color + weight
 *   icon     — bundled inline icon (bed | bath | area | pin | phone | ...)
 *   group    — visual grouping (renders children with a translate offset)
 *   badge    — pill-shaped colored container for status text (SOLD, JUST LISTED)
 */

export const TEMPLATE_SCHEMA_VERSION = 1

export const LAYER_TYPES = ['photo', 'text', 'rect', 'line', 'icon', 'group', 'badge']

export const OWNER_TYPES = ['platform', 'store', 'agency', 'agent']

export const ICONS = ['bed', 'bath', 'area', 'pin', 'phone', 'mail', 'star', 'flame', 'clock']

export const FIT_MODES = ['cover', 'contain', 'fill', 'none']

/**
 * Validate a template object. Returns { ok, errors: [] }.
 * Errors are strings tagged with a JSON pointer-ish path so upstream
 * form UIs can highlight the offending field.
 */
export function validateTemplate(template) {
  const errors = []
  if (!template || typeof template !== 'object') return { ok: false, errors: ['template must be an object'] }
  if (template.schema_version && template.schema_version !== TEMPLATE_SCHEMA_VERSION) {
    errors.push(`unsupported schema_version=${template.schema_version} (want ${TEMPLATE_SCHEMA_VERSION})`)
  }
  if (!template.name || typeof template.name !== 'string' || template.name.length > 60) {
    errors.push('name: must be a non-empty string <=60 chars')
  }
  if (template.owner_type && !OWNER_TYPES.includes(template.owner_type)) {
    errors.push(`owner_type: must be one of ${OWNER_TYPES.join(', ')}`)
  }
  const c = template.base_canvas
  if (!c || typeof c.width !== 'number' || typeof c.height !== 'number') {
    errors.push('base_canvas: must be { width: number, height: number }')
  } else {
    if (c.width < 200 || c.width > 4000) errors.push('base_canvas.width out of range (200..4000)')
    if (c.height < 200 || c.height > 4000) errors.push('base_canvas.height out of range (200..4000)')
  }
  if (template.background && typeof template.background !== 'object') {
    errors.push('background: must be an object { color, image, opacity? }')
  }
  if (!Array.isArray(template.layers)) {
    errors.push('layers: must be an array')
  } else {
    if (template.layers.length > 60) errors.push(`layers: too many (max 60, got ${template.layers.length})`)
    const seenIds = new Set()
    template.layers.forEach((layer, i) => {
      const path = `layers[${i}]`
      if (!layer || typeof layer !== 'object') { errors.push(`${path}: must be an object`); return }
      if (!layer.id || typeof layer.id !== 'string') { errors.push(`${path}.id: required string`) }
      else if (seenIds.has(layer.id)) errors.push(`${path}.id: duplicate id "${layer.id}"`)
      else seenIds.add(layer.id)
      if (!LAYER_TYPES.includes(layer.type)) errors.push(`${path}.type: must be one of ${LAYER_TYPES.join(', ')}`)
      if (typeof layer.x !== 'number' || typeof layer.y !== 'number') {
        errors.push(`${path}.x/y: required numbers`)
      }
      if (layer.type === 'photo' || layer.type === 'rect' || layer.type === 'badge' || layer.type === 'group') {
        if (typeof layer.w !== 'number' || typeof layer.h !== 'number') {
          errors.push(`${path}: type ${layer.type} needs numeric w + h`)
        }
      }
      if (layer.type === 'photo' && layer.fit && !FIT_MODES.includes(layer.fit)) {
        errors.push(`${path}.fit: must be one of ${FIT_MODES.join(', ')}`)
      }
      if (layer.type === 'icon' && !ICONS.includes(layer.icon)) {
        errors.push(`${path}.icon: must be one of ${ICONS.join(', ')}`)
      }
      if (layer.type === 'text' && typeof layer.bind !== 'string') {
        errors.push(`${path}.bind: text layers require a string bind (may contain {{expressions}})`)
      }
      if (layer.show_if && typeof layer.show_if !== 'string') {
        errors.push(`${path}.show_if: must be a string expression`)
      }
    })
  }
  if (template.platform_overrides && typeof template.platform_overrides !== 'object') {
    errors.push('platform_overrides: must be an object keyed by platform key')
  }
  return { ok: errors.length === 0, errors }
}

/**
 * Merge platform-specific overrides into the base template. Returns a new
 * template object with `resolved_canvas` and `resolved_layers` fields that
 * the renderer consumes. When no override exists for a platform, the base
 * layers are scaled proportionally to fit the platform's canvas.
 */
export function resolveTemplateForPlatform(template, platformDimensions) {
  const base = template.base_canvas
  const target = platformDimensions
  const override = template.platform_overrides?.[platformDimensions.__key] || null

  const resolvedCanvas = override?.canvas || { width: target.width, height: target.height }

  // Scale factors relative to the base canvas so unspecified layers still fit.
  const sx = resolvedCanvas.width / base.width
  const sy = resolvedCanvas.height / base.height

  const resolvedLayers = template.layers.map((layer) => {
    const lo = override?.layers?.[layer.id] || {}
    // If the override supplies absolute coords for THIS platform, use them
    // as-is. Otherwise scale the base coords to the platform canvas.
    const scaled = {
      x: typeof lo.x === 'number' ? lo.x : layer.x * sx,
      y: typeof lo.y === 'number' ? lo.y : layer.y * sy,
    }
    if (typeof layer.w === 'number') scaled.w = typeof lo.w === 'number' ? lo.w : layer.w * sx
    if (typeof layer.h === 'number') scaled.h = typeof lo.h === 'number' ? lo.h : layer.h * sy
    // Type-specific size fields (text: size; line: x2/y2/weight; icon: size).
    if (layer.type === 'text') {
      scaled.size = typeof lo.size === 'number' ? lo.size : (layer.size ? Math.round(layer.size * Math.min(sx, sy)) : 32)
    }
    if (layer.type === 'line') {
      scaled.x2 = typeof lo.x2 === 'number' ? lo.x2 : layer.x2 * sx
      scaled.y2 = typeof lo.y2 === 'number' ? lo.y2 : layer.y2 * sy
      scaled.weight = typeof lo.weight === 'number' ? lo.weight : (layer.weight || 1)
    }
    if (layer.type === 'icon') {
      scaled.size = typeof lo.size === 'number' ? lo.size : (layer.size ? Math.round(layer.size * Math.min(sx, sy)) : 40)
    }
    return { ...layer, ...lo, ...scaled }
  })

  return {
    ...template,
    resolved_canvas: resolvedCanvas,
    resolved_layers: resolvedLayers,
    __platform_key: platformDimensions.__key,
  }
}
