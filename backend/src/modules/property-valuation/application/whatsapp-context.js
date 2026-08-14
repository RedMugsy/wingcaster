export function createWhatsAppContextBuilder({ analysisService, config, logger }) {
  async function buildContext(extractedProperty) {
    if (!config.whatsAppContextEnabled) return ''
    if (!extractedProperty || !extractedProperty.price) return ''

    try {
      const sentence = await analysisService.analyzeDraft(extractedProperty)
      return sentence ? `\n💡 ${sentence}` : ''
    } catch (err) {
      logger.warn({ err: err.message }, 'Failed to build WhatsApp pricing context')
      return ''
    }
  }

  return {
    buildContext,
  }
}
