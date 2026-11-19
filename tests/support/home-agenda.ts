import type { HomeAgendaEvent } from '../../src/features/events/lib/home-feed.ts'

export function agendaEvent(id: string, starts_at: string, overrides: Partial<HomeAgendaEvent> = {}): HomeAgendaEvent {
  return {
    id, name: id, starts_at, time_tba: false, is_all_day: false, location_hidden: false, location_tba: false,
    image_url: 'https://imagenes.passline.com/eventos/synthetic.png', image_width: null, image_height: null, venue_name: 'Sala sintética', venue_neighborhood: 'Almagro',
    price: null, is_free: false, music: false, payWhatYouCan: false, sourceUrl: null, ...overrides,
  }
}
