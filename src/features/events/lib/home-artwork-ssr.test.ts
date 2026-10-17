import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import type { HomeEventCard } from './home-feed.ts'

describe('homepage server-rendered artwork discovery', () => {
  // Bun's native runner has no Svelte compiler; Vitest's server project compiles this SSR fixture.
  it.skipIf('Bun' in globalThis)('puts responsive image candidates and initial priorities in HTML before hydration', async () => {
    const { default: HappeningSoonEvents } = await import('#features/chat/components/HappeningSoonEvents.svelte')
    const events = Array.from({ length: 4 }, (_, index) => ({
      id: `00000000-0000-4000-8000-00000000000${index}`,
      name: `Event ${index}`, starts_at: '2027-01-01T20:00:00Z', time_tba: false,
      image_url: `https://imagenes.passline.com/eventos/${index}.jpg`,
      image_width: null, image_height: null, venue_name: 'Venue', venue_neighborhood: null,
      price: null, is_free: true,
    })) as HomeEventCard[]
    const result = render(HappeningSoonEvents, { props: { initialEvents: events, onSelectPrompt: () => {} } })
    expect(result.body.match(/<source /g)).toHaveLength(4)
    expect(result.body).toContain('/api/event-artwork/')
    expect(result.body.match(/loading="eager"/g)).toHaveLength(2)
    expect(result.body.match(/loading="lazy"/g)).toHaveLength(2)
    expect(result.body.match(/fetchpriority="high"/g)).toHaveLength(1)
    expect(result.body).toContain('srcset=')
    expect(result.body).toContain('sizes=')
  }, 30_000)
})
