import logger from '../../lib/logger.js'

export function getModuleLogger() {
  return logger.child({ module: 'property-valuation' })
}
