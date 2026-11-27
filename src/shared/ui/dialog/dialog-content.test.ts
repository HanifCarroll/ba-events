import { load } from 'cheerio'
import { render } from 'svelte/server'
import { expect, it, vi } from 'vitest'
import { paraglideMiddleware } from '#paraglide/server.js'
import OpenDialog from '../../../../tests/support/OpenDialog.svelte'

// The real portal moves content to document.body on the client. Keep it inline to inspect SSR markup.
vi.mock('./dialog-portal.svelte', async () => ({ default: (await import('../../../../tests/support/InlineSlot.svelte')).default }))

it.each([['es', 'Cerrar'], ['en', 'Close']])('gives the rendered %s close button an accessible name', async (locale, label) => {
  const req = new Request('https://baeventos.com/privacy', { headers: { cookie: `PARAGLIDE_LOCALE=${locale}` } })
  await paraglideMiddleware(req, () => {
    const $ = load(render(OpenDialog).body)
    const button = $('button[data-slot="dialog-close"]')
    expect(button.length).toBe(1)
    expect(button.attr('aria-label')).toBe(label)
    return new Response()
  })
})
