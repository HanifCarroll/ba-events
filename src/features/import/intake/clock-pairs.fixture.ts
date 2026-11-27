/** Explicit clock and near-miss pairs from event-import-enrichment: Intake reads an entry or show clock. */
export interface ClockClaim { quote: string; time: string; source?: string }
interface Pair { name: string; accepted: ClockClaim; rejected: ClockClaim; previewAt?: string }

const claim = (quote: string, time: string, source?: string): ClockClaim => ({ quote, time, source })
const closesAtEleven = 'Desde las 20 hasta las 23 hs. Show: 23 hs.'

export const clockPairs: Pair[] = [
  { name: 'attached hours unit vs clipped unit', accepted: claim('21h', '21:00'),
    rejected: claim('21h', '21:00', '21hs') },
  { name: 'spaced hours unit vs competing price', accepted: claim('21 hs', '21:00'),
    rejected: claim('$21 hs', '21:00') },
  { name: 'complete colon minutes vs clipped minutes', accepted: claim('a las 21:30', '21:30'),
    rejected: claim('a las 21', '21:00', 'a las 21:30') },
  { name: 'complete dotted minutes vs clipped minutes', accepted: claim('a las 20.30', '20:30'),
    rejected: claim('a las 20', '20:00', 'a las 20.30') },
  { name: 'dotted clock vs price', accepted: claim('20.00', '20:00'),
    rejected: claim('20.00', '20:00', '20.00 USD') },
  { name: 'bare hours field vs longer clock token', accepted: claim('Puertas:21', '21:00'),
    rejected: claim('Puertas:21', '21:00', 'Puertas:21:30') },
  { name: 'clock introduction vs duration', accepted: claim('a las 21', '21:00'),
    rejected: claim('dura 21 horas', '21:00') },
  { name: 'midnight notation vs a range ending at midnight', accepted: claim('12 a.m.', '00:00'),
    rejected: claim('12 a.m.', '00:00', 'de 8 p.m. a 12 a.m.') },
  { name: 'day before a real span vs day-of-month', accepted: claim('Lunes de 23 a las 2 hs', '23:00'),
    rejected: claim('Lunes 23 a las 2 hs', '23:00'), previewAt: '2026-11-24T02:00:00.000Z' },
  { name: 'explicit opener vs independent clock', accepted: claim('Viernes 20 a las 23 hs', '23:00'),
    rejected: claim('Viernes de 20 a las 23 hs', '23:00') },
  { name: 'independent repeat vs isolated closing clock', accepted: claim('Show: 23 hs', '23:00', closesAtEleven),
    rejected: claim('hasta las 23 hs', '23:00', closesAtEleven), previewAt: '2026-11-24T02:00:00.000Z' },
  { name: 'explicit afternoon meridiem vs clipped meridiem', accepted: claim('a las 9:30 p. m.', '21:30'),
    rejected: claim('a las 9:30', '09:30', 'a las 9:30 p. m.'), previewAt: '2026-11-24T00:30:00.000Z' },
  { name: 'meridiem on both endpoints vs ambiguous opening', accepted: claim('de 8 pm a 11 pm', '20:00'),
    rejected: claim('de 8 a 11 pm', '20:00') },
  { name: 'complete shared unit vs clipped unit', accepted: claim('de 20 a 24 hs', '20:00'),
    rejected: claim('de 20 a 24', '20:00', 'de 20 a 24 hs') },
  { name: 'bare start with marked end vs non-time quantity', accepted: claim('de 20 a 24 h', '20:00'),
    rejected: claim('de 20 a 24 años', '20:00') },
  { name: 'colon-minutes range vs numeric date fragments', accepted: claim('20–23:30', '20:00'),
    rejected: claim('20/11–23:30', '20:00') },
]
