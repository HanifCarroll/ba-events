/**
 * Luma event detail (description and venue) from Luma's JSON API.
 *
 * `api2.luma.com/event/get?event_api_id=<slug or evt id>` returns the event
 * data the detail page renders. From Cloudflare Workers, luma.com HTML and the
 * `/url` lookup answer 429; `/event/get` does not.
 */
import { fetchLumaJson } from './http.ts'
import { lumaLocation } from './location.ts'

type ProsemirrorNode = { type: string; text?: string; content?: ProsemirrorNode[] }
const BLOCKS = new Set(['paragraph', 'heading', 'blockquote', 'list_item', 'listItem', 'code_block', 'codeBlock'])
const BREAKS = new Set(['hard_break', 'hardBreak'])

export interface LumaEventDetail {
  description: string | null
  venue: { name: string; address: string | null; latitude: number | null; longitude: number | null } | null
  /** true: guests-only, the address comes after registration, and `venue` is null. false: public address. null: can't tell. */
  location_hidden: boolean | null
}

/** Plain text from Luma's Prosemirror `description_mirror`: blocks become paragraphs, hard breaks newlines. */
export function prosemirrorText(content: ProsemirrorNode[]): string {
  const render = (nodes: ProsemirrorNode[]): string => nodes.map(node => {
    if (node.type === 'text') return node.text ?? ''
    if (BREAKS.has(node.type)) return '\n'
    const inner = render(node.content ?? [])
    return BLOCKS.has(node.type) ? `${inner}\n\n` : inner
  }).join('')
  return render(content).replace(/\n{3,}/g, '\n\n').trim()
}

export function lumaSlug(eventUrl: string): string | null {
  try {
    const slug = new URL(eventUrl, 'https://luma.com').pathname.replace(/^\/+|\/+$/g, '')
    return slug && !slug.includes('/') ? slug : null
  } catch {
    return null
  }
}

/** Description and public venue. Obfuscated (guests-only) locations are hidden and have no venue. */
export function parseLumaEventDetail(body: unknown): LumaEventDetail | null {
  const data = body as Record<string, unknown> | null
  if (!data || typeof data !== 'object' || !data.event) return null
  const event = (data.event ?? {}) as Record<string, unknown>
  const mirror = data.description_mirror as { content?: ProsemirrorNode[] } | undefined
  const description = (typeof event.description === 'string' && event.description)
    || (mirror?.content ? prosemirrorText(mirror.content) : '') || null
  const { hidden, venue } = lumaLocation(event.geo_address_info, event.coordinate)
  return {
    description,
    venue: venue && { name: venue.name, address: venue.address, latitude: venue.latitude, longitude: venue.longitude },
    location_hidden: hidden,
  }
}

export async function fetchLumaEventDetail(eventUrl: string, fetchImpl?: typeof fetch): Promise<LumaEventDetail | null> {
  const slug = lumaSlug(eventUrl)
  return slug ? parseLumaEventDetail(await fetchLumaJson(`/event/get?event_api_id=${encodeURIComponent(slug)}`, fetchImpl)) : null
}
