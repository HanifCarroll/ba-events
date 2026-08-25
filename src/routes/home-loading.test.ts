import { describe, expect, it, vi } from 'vitest'
import type { ChatEventPayload } from '#shared/lib/types.ts'

const getHappeningSoonEventsForGrid = vi.fn()

vi.mock('#features/events/api/crud.server.ts', () => ({ getHappeningSoonEventsForGrid }))

describe('homepage event loading', () => {
	it('does not load events in the homepage SSR loader', async () => {
		const { load } = await import('./+page.server.ts')

		await expect(load({} as Parameters<typeof load>[0])).resolves.toEqual({})
		expect(getHappeningSoonEventsForGrid).not.toHaveBeenCalled()
	})

	it('returns the bounded public event feed using the standard list response', async () => {
		const events = [{ id: 'event-1' }] as ChatEventPayload[]
		getHappeningSoonEventsForGrid.mockResolvedValueOnce(events)

		const { GET } = await import('./api/events/happening-soon/+server.ts')
		const response = await GET()

		expect(response.status).toBe(200)
		expect(await response.json()).toMatchObject({
			success: true,
			data: events,
			meta: { total: 1 }
		})
		expect(getHappeningSoonEventsForGrid).toHaveBeenCalledOnce()
	})
})
