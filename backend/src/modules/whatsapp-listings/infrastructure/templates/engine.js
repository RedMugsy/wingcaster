import { mkdir } from 'fs/promises'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { TemplateVariant } from '../../domain/types.js'
import * as luxe from './luxe.js'
import * as modern from './modern.js'
import * as urgent from './urgent.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const SIZES = [
  { key: '1080x1080', width: 1080, height: 1080 },
  { key: '1080x1920', width: 1080, height: 1920 },
  { key: '1200x675', width: 1200, height: 675 },
]

const VARIANT_RENDERERS = {
  [TemplateVariant.LUXE]: luxe,
  [TemplateVariant.MODERN]: modern,
  [TemplateVariant.URGENT]: urgent,
}

/**
 * Create the branded thumbnail compositing engine.
 *
 * @param {Object} deps
 * @param {Object} deps.config - Module config (from config.js). Uses
 *   `storagePath` as a fallback only when an explicit `outputDir` is not
 *   provided in a generate call.
 * @param {Object} deps.logger - Module logger (from logger.js). Used for
 *   debug timing of generation operations.
 *
 * @returns {Object} engine with `generate`, `generateAllVariants`, and
 *   `selectVariant`.
 */
export function createTemplateEngine({ config, logger }) {
  const fontsDir = join(__dirname, 'fonts')
  const brandMark = config.brandMark || 'REAL ESTATE BAZAAR'

  return {
    /**
     * Generate the three required sizes for a single variant.
     *
     * @param {Object} params
     * @param {Object} params.property - Listing object with `id`, `title`,
     *   `price`, `currency`, `location`, `neighborhood`, `city`, and optional
     *   `intent`.
     * @param {string} params.inputImagePath - Absolute path to the hero photo.
     * @param {string} params.variant - One of TemplateVariant values.
     * @param {string} [params.outputDir] - Root output directory. Defaults to
     *   config.storagePath when omitted.
     * @param {number|string} [params.version=1] - Version segment for the path.
     *
     * @returns {Promise<{paths: Object, variant: string}>}
     */
    async generate({ property, inputImagePath, variant, outputDir, version = 1 }) {
      const renderer = VARIANT_RENDERERS[variant]
      if (!renderer) {
        throw new Error(`Unknown template variant: ${variant}`)
      }

      const log = logger.child ? logger.child({ propertyId: property.id, variant, version }) : logger
      log.debug('Generating WhatsApp listing template thumbnails')

      const baseDir = join(
        outputDir || config.storagePath,
        'properties',
        String(property.id),
        `v${version}`
      )
      await mkdir(baseDir, { recursive: true })

      const paths = {}

      for (const size of SIZES) {
        const outputPath = join(baseDir, `${variant}-${size.key}.jpg`)
        await renderer.render(inputImagePath, outputPath, {
          width: size.width,
          height: size.height,
          property,
          fontsDir,
          brandMark,
          logoPath: config.logoPath,
        })
        paths[size.key] = resolve(outputPath)
      }

      return { paths, variant }
    },

    /**
     * Generate all three variants for a listing.
     *
     * @param {Object} params - Same as `generate` except no `variant`.
     *
     * @returns {Promise<Object>} Map keyed by variant value.
     */
    async generateAllVariants({ property, inputImagePath, outputDir, version = 1 }) {
      const results = {}
      for (const variant of Object.values(TemplateVariant)) {
        results[variant] = await this.generate({
          property,
          inputImagePath,
          variant,
          outputDir,
          version,
        })
      }
      return results
    },

    /**
     * Select a variant based on an explicit request or image description
     * keywords.
     *
     * @param {string} [imageDescription='']
     * @param {string} [requestedVariant]
     *
     * @returns {string} One of TemplateVariant values.
     */
    selectVariant(imageDescription = '', requestedVariant) {
      if (requestedVariant && Object.values(TemplateVariant).includes(requestedVariant)) {
        return requestedVariant
      }

      const lower = String(imageDescription).toLowerCase()

      const luxurySignals =
        /\b(luxury|luxe|vip|premium|marble|finishes|penthouse|private pool|jacuzzi|sauna|elevator|gym|concierge|rooftop|view|sea view|mountain view)\b/
      const urgentSignals =
        /\b(urgent|hot|price drop|reduced|must sell|asap|limited|quick|update|new listing|exclusive|motivated|deadline|today|now)\b/

      if (luxurySignals.test(lower)) return TemplateVariant.LUXE
      if (urgentSignals.test(lower)) return TemplateVariant.URGENT

      return TemplateVariant.MODERN
    },
  }
}
