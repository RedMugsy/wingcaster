import logger from '../../lib/logger.js'

const MODULE_PREFIX = '[whatsapp-listings]'

export function getModuleLogger() {
  return logger.child({ module: 'whatsapp-listings' })
}

export function logContext(logger, ctx) {
  return logger.child(ctx)
}
