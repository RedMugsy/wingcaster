/**
 * Platform message templates — public barrel.
 *
 * Callers should import from here rather than reaching into the submodules
 * directly, so the internal shape stays free to change.
 */

export {
  createTemplate,
  updateTemplate,
  deleteTemplate,
  listTemplates,
  getTemplate,
  getVersionHistory,
  revertTemplateToVersion,
} from './service.js'

export { resolveTemplate } from './resolver.js'

export {
  extractVariables,
  extractAllVariables,
  assertRequiredVariablesPresent,
  findUnknownVariables,
  renderText,
  renderHtml,
  renderTemplate,
} from './variables.js'
