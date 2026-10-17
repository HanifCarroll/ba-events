# Homepage cards and artwork

The homepage reads a shared, compact four-card feed from the Workers Cache API.
Fresh entries (60 seconds) render in server HTML. Entries up to another 300
seconds old render immediately while `waitUntil` refreshes them. A cold read is
a nested SvelteKit loader promise: the hero renders while the row streams, with
a skeleton reserving its space. There is no hydration-triggered events fetch.
Database failures are not cached as successful empty feeds.

The public feed uses `Cache-Control: no-cache` for browsers and explicit
`CDN-Cache-Control` / `Cloudflare-CDN-Cache-Control` directives for 60 seconds
plus 300 seconds of stale-while-revalidate. The separate browser directive
prevents the zone's observed four-hour minimum browser TTL from extending
the feed's freshness. HTML remains locale/session dependent and is not shared.

`EventArtwork` selects WebP variants through a `<picture>` and accurate `sizes`.
Homepage cards 1–2 are eager; only card 1 has high priority. Remaining cards are
lazy. Event details and chat artwork use the same delivery path.
Reserved frames give the image an explicit box with `object-contain`, so switching
to a cached candidate cannot shrink it through density-corrected natural sizing.
Known source dimensions cap both the rendered maximum and candidate descriptors;
duplicate no-upscale candidates are omitted. Missing metadata keeps the explicit
frame geometry without enabling server-side upscaling.

## Image boundary

`/api/event-artwork/:id/:width.webp?v=:version` accepts only catalog UUIDs and
320/640/1280 variants. The version changes with the stored original URL. The
server resolves displayable catalog records itself; clients cannot provide an
upstream URL. Exact HTTPS media hosts/paths cover all current image providers:

| Platform | Media host |
| --- | --- |
| Passline | `imagenes.passline.com/eventos/` |
| Venti | `images.venti.live/user-images/` |
| Meetup | `secure.meetupstatic.com/photos/event/` |
| Eventbrite | `img.evbuc.com` wrapping `cdn.evbuc.com/images/`, or that CDN directly |
| Luma | `images.lumacdn.com/uploads/` or `/event-covers/` |

BA Tourism currently imports no artwork and keeps its existing placeholder.
Unrecognized/custom source URLs retain direct original delivery; adding a new
upstream media host requires reviewing this explicit allowlist. Redirects are
not followed and user cookies/authorization are never sent upstream. Input is
limited to raster media, 10 MiB, 40 megapixels, and a ten-second source-read
deadline. The Images binding scales down without cropping/upscaling, emits
quality-75 WebP, and caches successful variants for one day. Failed transforms,
missing bindings, and exhausted free allowance fall back to original approved
artwork without caching the fallback. The component also falls back on an image
error. Original import data is not rewritten.

Wrangler declares the `IMAGES` binding; no new credentials, storage bucket, or
paid plan is required. Cloudflare's Images Free allowance is 5,000 unique
transformations per month and rejects new transformations beyond its allowance
without charging overages. Do not upgrade a plan as an automatic recovery step.
See [Cloudflare pricing](https://developers.cloudflare.com/images/pricing/).

## Verification

`bun run cloudflare:ci`, `bun run build`, and `openspec validate --specs --json`
cover both test runners, SSR candidate discovery, fresh/stale/cold caching,
all-source transforms, format/dimension policy, and proxy/fallback boundaries.
The native Bun runner skips only the SSR component fixture because it lacks a
Svelte compiler; the authoritative Vitest server project executes that fixture.

After release, verify warm HTML includes four picture sources, the feed has
four compact records and the explicit CDN TTL, and real catalog image requests
from each image provider return WebP at bounded dimensions and cache on repeat.
Do not describe HTTP completion as browser paint or LCP.
