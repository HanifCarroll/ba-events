import * as m from '#paraglide/messages.js'

export function formatPrice(price: number | null, isFree: boolean): string {
  if (isFree || price === 0) return m.event_free()
  if (price === null) return m.event_price_tba()
  return `$${price.toLocaleString('es-AR')} ARS`
}
