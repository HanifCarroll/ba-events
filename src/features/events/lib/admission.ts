import { normalizeText } from '#shared/lib/utils/normalize-text.ts'

const A_LA_GORRA = /\ba la gorra\b/
const PAY_WHAT_YOU_CAN = /\b(?:a la gorra|contribucion consciente|a voluntad|paga lo que (?:quieras|puedas))\b/

export function isPayWhatYouCan(name: string, descriptionEs?: string | null, priceNote?: string | null): boolean {
  return A_LA_GORRA.test(normalizeText(name)) || A_LA_GORRA.test(normalizeText(descriptionEs ?? '')) ||
    (typeof priceNote === 'string' && PAY_WHAT_YOU_CAN.test(normalizeText(priceNote)))
}
