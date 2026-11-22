# Instagram publisher

A VPS job drafts four recurring posts for @baeventos.app from the catalog, previews each one in Slack #ba-eventos, and publishes it once Hanif approves. It uses the Instagram Graph API (`graph.facebook.com`) unless Hoy's optional Business Suite link stickers are on. The token is the system-user token of the Meta app "BA Eventos Publisher" (id 2298370517615574, business portfolio HC Studio), made with Facebook Login for Business, because new Meta apps no longer offer Instagram Login. The specification is `openspec/specs/instagram-publishing/spec.md`. Post and preview copy lives in `src/features/instagram-publisher/copy.md`, and alert copy lives in `src/features/instagram-publisher/alerts.ts`.

| Format | Draft id | Kind | Events | Draft (Slack) | Publishes | Approval cutoff | Deadline |
|---|---|---|---|---|---|---|---|
| Hoy | `hoy-YYYY-MM-DD` | story, 1080 × 1920 | today from 18:00, 2–4 | daily 11:00 | 17:00 | 17:00 | 19:00 |
| Este finde | `finde-<Friday>` | carousel, 1080 × 1350 | Friday–Sunday, 4–6 | Wednesday 18:00 | Thursday 12:00 | Friday 18:00 | Friday 18:00 |
| Gratis esta semana | `gratis-<Monday>` | carousel, 1080 × 1350 | Monday–Sunday, free, 5–8 | Sunday 18:00 | Monday 12:00 | Tuesday 20:00 | Tuesday 20:00 |
| Este finde Reel | `reel-<Friday>` | reel, 1080 × 1920 MP4 with music | Friday–Sunday, 4–6, the carousel's selection minus events over by Friday 18:00 | Thursday 18:00 | Friday 12:00 | Friday 18:00 | Friday 18:00 |

The approval cutoff is the last moment a ✅ counts. The deadline is the last moment any new Instagram write may start; after it the job only reconciles requests it already sent.

All times are Buenos Aires (UTC−3).

## Commands

Run from `~/projects/ba-events` on the VPS:

```sh
mise exec -- bun scripts/instagram-publisher.ts status
mise exec -- bun scripts/instagram-publisher.ts dry-run finde --date 2026-11-20 --out /tmp/finde   # no Slack, R2, or Instagram
mise exec -- bun scripts/instagram-publisher.ts dry-run reel --date 2026-11-20 --out /tmp/reel     # renders the real MP4 (about 75 s)
mise exec -- bun scripts/instagram-publisher.ts regenerate finde-2026-11-20 --exclude <event id>
mise exec -- bun scripts/instagram-publisher.ts regenerate reel-2026-11-20 --track <track id>      # keeps exclusions; --exclude works too
mise exec -- node --experimental-transform-types scripts/instagram-publisher.ts tick               # what the timer runs
mise exec -- node --experimental-transform-types scripts/instagram-publisher.ts stickers-dry-run hoy-2026-11-19 --out /tmp/hoy-stickers
```

`dry-run` takes the run's first day (any day for Hoy, a Friday for Este finde and the Reel, a Monday for Gratis) and writes the frames, `caption.txt`, the Slack text in `slack.txt`, and `events.txt` (the picks with their ids). For the Reel it writes `reel.mp4`, `cover.jpg`, and `timing.json` instead of frames, says which track it chose, and takes `--track <id>` to try another. `regenerate` keeps earlier exclusions, posts the rebuilt draft as a new top-level preview, and resets the approval: reactions on the old message no longer count. It refuses a draft that's publishing or published, or past its cutoff.

## How a tick works

The `ba-events-instagram.timer` user timer runs `tick` every 10 minutes. systemd never starts a second run of a oneshot service while one is still running, and a lock directory also guards against a manual `regenerate` racing a tick.

1. It checks the Instagram token (below).
2. For each format whose draft time has come and whose cutoff hasn't passed, it creates the draft if none exists: it reads the catalog, picks the events, renders the frames into `rev-1/`, and posts the preview. Too few events posts the skip message instead.
3. It delivers any Slack reply still pending from an earlier tick.
4. For each open draft it reads Hanif's reactions with `reactions.get` and decides (`approval.ts`). ❌ always skips. Before the slot it waits. At the slot it publishes when there's a ✅ seen before the cutoff (or auto mode is on) and the deadline hasn't passed. After the cutoff with no ✅ it skips. A ✅ first seen by the tick just after the cutoff still counts, because Slack doesn't timestamp reactions.
5. Publishing verifies the frames against the saved revision. The Graph API path uploads them to R2 and runs `instagram.ts`. When Hoy link stickers are enabled, it tries Business Suite first (see below).
6. **Before every Instagram write** (each container, the carousel, each `media_publish`, each story frame), including retries of a draft already in `publishing`, the job re-reads the reactions and the clock. Before the first new write of each attempt (every tick that writes), it also re-reads the selected events' status and times from D1 and checks them against the current time. An event that is no longer scheduled holds the draft with "Held: {title} was cancelled. Ask Hermes to regenerate it." An event that has ended (or started, with no end time) holds it with "Held: {title} has already happened. Ask Hermes to regenerate it." The alert explains whether a rebuild is still possible. Reconciling an earlier unclear publish is only a read, so none of these checks block it. ❌ ends the draft ("Skipped: you reacted ❌"). A removed ✅ (auto mode off) pauses it until the ✅ returns. At or after the deadline nothing new is created ("Skipped: not published by {HH:MM}"). If some story frames already went out, the draft is marked `failed` with an alert, and nothing more is posted.
7. The outcome ("Posted: {permalink}", "Skipped: …", "Held: …") is saved together with a pending Slack reply. If Slack fails, the outcome stands and later ticks retry the reply without publishing again.

Each failed attempt goes in the service log. Alerts go to #ba-eventos and put the outcome and next step first, using Buenos Aires times. The final line has the draft ID and any diagnostic or command Hermes needs.

| Alert key (after `ba-events/instagram/`) | When it opens |
|---|---|
| `tick` | An item fails across three consecutive ticks, or a failing run still has no preview at least an hour after its draft time. The thread updates only when the qualifying draft IDs or their causes change. |
| `draft/<id>` | Publishing fails three ticks in a row, fails with less than an hour left, or gives up. A hold, a partial post that cannot continue, an interrupted rebuild, or a preview that misses its cutoff also alerts immediately. |
| `draft/<id>/slack` | The outcome message fails to send three ticks in a row. |
| `token` | Token refresh fails, the token file is invalid, or a dated token has fewer than 10 days left. |

A draft's alert streak counts failed ticks across steps, so changing from a reaction read failure to a publish failure doesn't reset it. The first alert's thread follows the draft across steps, while a final publish failure gets a draft alert. Publishing retries every tick. After six publishing failures the draft is marked `failed` unless a `media_publish` result is still unclear, in which case the job keeps checking it. The alert streak resets when publishing pauses; the six-failure retry budget does not. When a preview misses its cutoff or a rebuild stops part-way, the job won't publish the draft. A successful retry closes the open alert with a ✅ line. If the draft ends skipped, held, or failed, the alert names that outcome rather than claiming recovery. The alert command has up to three minutes to raise or resolve an alert; the publisher does not queue alert delivery separately.

## Regenerate

`regenerate` refuses a draft that has started publishing, or is past its cutoff. It first saves the draft as revision n+1 in state `rebuilding` with approval cleared, then renders into `rev-<n+1>/` (old frames are never overwritten) and posts a new top-level preview. If it stops before rendering finishes, the next tick marks the draft `failed` and raises its alert with the exact command to run again if the cutoff is still open. If the frames are saved and Slack's response was lost, the next tick checks whether the preview arrived before trying to upload again. Publishing uploads only frames that sit in the saved revision's directory and match its hash.

## The Reel

The Reel shows the Este finde selection again as a video: a cover card, one card per event, and a closing card, in the same flyer-led look as the still frames (see "Look and artwork"; the HyperFrames project is built in `src/features/instagram-publisher/reel/project.ts`). It is built only from events that have artwork, unless fewer than four have any; then it uses the carousel's picks and shows the no-flyer card for the rest. Its picks use the Este finde rules, leave out the finde draft's `--exclude` ids, and leave out any event that would be over by the Reel's Friday 18:00 deadline (its end, or its start when it has no end), so the pre-publish check never holds it at the slot or at a late ✅. So it shows the carousel's selection minus Friday daytime events, with the next picks filling their places; a 12:00–20:00 exhibition stays, a 12:00 talk with no end time doesn't. Each card holds still for H = max(3.0 s, 0.35 s × words, characters / 17) after a 0.5 s entrance and before a 0.2 s exit, rounded up to whole beats of the track, so every cut lands on a beat. A Reel is about 37 s with 4 events and 48 s with 6.

**Music.** The tracks live outside the repo, in the directory `reel.musicDir` in the config (default `~/.local/share/ba-events/reel-music`): one audio file per track and `tracks.json`, whose `tracks` entries have `id`, `title`, `artist`, `file`, `durationSec`, `bpm`, `startSec`, `credit`, `source`, and `license`. The Meta Sound Collection tracks may only be used in content on Meta's products and never distributed separately, and the repo is public, so never commit the files or anything made from them. `startSec` is a downbeat where the full arrangement plays, with enough music after it for the longest Reel (6 events with long titles, about 82–87 s) before the track ends or goes quiet. `bpm` comes from the kick, not from `hyperframes beats`, which can follow off-beats.

**Rotation.** A new Reel draft takes the track whose last published Reel is oldest; tracks never published come first, in `tracks.json` order. The draft saves its track, `regenerate` keeps it unless given `--track <id>`, and the preview's last line names it ("Music: …"). A track with a `credit` adds that line to the caption. A missing directory or file, a track without `bpm` and `startSec`, or a track whose `license` starts with "CC BY" but has no `credit`, fails the draft with the tick alert; there's never a Reel without music. The excerpt starts at `startSec`, fades in over 0.3 s and out over 1.0 s, and is normalized to −14 LUFS and −1.5 dBTP; the build refuses one that runs past the end of the file.

**Rendering.** `npx --yes hyperframes@0.9.66 render --quality delivery --workers 1` (telemetry off) runs in `systemd-run --user --scope --collect --unit=ba-events-instagram-reel-<pid>-<ms> -p MemoryMax=1000M -p MemorySwapMax=0 -p RuntimeMaxSec=600`; a timeout or error stops the scope. It uses HyperFrames' managed Chrome Headless Shell in `~/.cache/hyperframes/chrome/`, not Playwright's (which exits at once). If it's missing the draft fails with an alert naming `npx --yes hyperframes@0.9.66 browser ensure`; the VPS has no `unzip`, so that install needs an unzip shim on `PATH`. ffmpeg and ffprobe come from `BA_INSTAGRAM_FFMPEG_DIR`, `PATH`, or `~/.hermes/tools/ffmpeg-*/bin`. On the VPS the 48 s Reel took about 75 s and peaked at about 850 MB in its scope with the earlier text-only look; measure it again with flyers. Fonts, the logo (`static/logo.svg`), the flyers downloaded for this render, and GSAP (`node_modules/gsap`) are copied into the project; nothing is fetched at render time. During a card's hold only the flyer moves (a 4% zoom over the card's length); the words stay still. The job checks the MP4 (1080 × 1920 H.264 yuv420p at 30 fps with AAC, the expected length) before it's previewed.

**Publishing.** It uploads `instagram/<draft id>/<hash>/reel.mp4` (`video/mp4`) and `cover.jpg` (the cover card's hold frame) to R2, creates one `media_type=REELS` container with `video_url`, `cover_url`, `caption`, and `share_to_feed=true`, and polls its `status_code` for up to about 5 minutes per tick. A video still processing leaves the draft `publishing` without counting a failure, and the next tick polls the same container, but only after the same reaction and deadline check as a write: ❌ skips it, a removed ✅ pauses it, and the deadline ends it. After an unclear `media_publish`, the media id is looked up by exact caption among posts of the same kind (`REELS` for a Reel, `CAROUSEL_ALBUM` for a carousel), because the two often share a caption. The render's project directory, which holds the audio excerpt, is removed whether the render succeeds or fails. Then it checks `content_publishing_limit` and calls `media_publish`, with the same idempotency and checks as a carousel (below).

**Slack.** The preview is a new top-level message with the MP4 attached (through Slack's external upload, which sends the bytes straight to the upload URL; a 10 MB video is fine) and ends with `Music: "{title}" by {artist}.`

## Selection

Events come from the Instagram intake (they have `event_source_evidence`) and must be scheduled, not time-TBA, not all-day, not location-hidden, and have a venue with a barrio. An event that is over by the publish slot (its end, or its start when it has no end) is left out, so Sunday's Gratis draft doesn't list Monday-morning events. The pick is greedy and deterministic: one event per venue (names compared without accents or punctuation), a free event first for Hoy and Este finde when one qualifies, then whichever event has artwork (`events.image_url`), adds a new barrio, a new category, and a description line, earliest first on ties. Artwork outweighs the other three together, but an event without artwork is still picked when no candidate with artwork is left. The cards are in start order.

Placeholder start times don't count as real ones: a 23:59 start (the intake's end-of-day stand-in), and a 00:00 start when an intake candidate (not a link to a scraped event) left `time` empty. Time-TBA rows are already `time_tba`. A title ending in "@ {venue}" (or "@{venue}") that names the event's own venue loses that suffix.

The tag is the venue's `instagram_handle`, else the account of the intake post the event came from, else none (the caption then names the venue). When the tag is the posting account and its name doesn't match the venue's (`accountIsVenue`: "salalucida" is Sala Lúcida, "ccmacedonia" is Centro Cultural Macedonia, "vamos_gratis" isn't Facultad de Derecho), the caption names the venue and ends the line "Vía @handle.", and the card footer reads "Vía @handle". "A la gorra" comes from the intake candidate's `price_note` when its `price_kind` is `conditional` and the note says "a la gorra", "contribución consciente", or "a voluntad"; the catalog has no column for it.

## Look and artwork

Every format uses the website's look (`look.ts`): its near-black ground `#101012`, the logo's coral `#e8484a` and paper `#fbf3e6`, the lime `#d0ff36` of its filter pills, Newsreader semibold for headlines, DM Sans for everything else, and the real logo (`static/logo.svg`) at the top left. No format uses a stock photo.

- **Event card.** The event's own flyer, whole (never cropped), over a blurred, darkened copy of itself, above a solid near-black panel with the kicker, title, description line, venue, barrio, price pill, and footer handle. The words never sit on the flyer. On a carousel the panel starts at a fixed seam. On a Hoy frame and in the Reel the blur fills the whole frame, the panel is a rounded box only as tall as its words, and the page sizes the flyer into the space between the logo row and the panel (`placeFlyers` in `look.ts`), so the link sticker's band and everything under the panel show the blurred flyer. Titles are fitted in the page to two lines with a size floor (`data-fit`), and cut with an ellipsis only at the floor.
- **No flyer.** An event without usable artwork gets the same card with a dark tile in the flyer's place: a coral rule and the title.
- **Covers.** The carousels and the Reel show the post's first three flyers as tilted, overlapping prints, like the site's header. The Reel's cover sets them on a blend of their blurred copies. The Hoy cover shows tonight's flyers in a grid that runs from the top of the frame to the bottom; the part behind and below the headline is dimmed. The headline is paper on a coral box with a lime date chip above it.
- **Closing.** A dimmed mosaic of the post's flyers behind the closing words.

Before a render, `artwork.ts` downloads each picked event's `image_url` next to the render directory: https only, 10 s, at most 15 MB, and it must decode as a JPEG, PNG, WebP, GIF, or AVIF of at least 200 px. It saves a JPEG of at most 1280 px on the long side and a small blurred backdrop, one image at a time, and removes them when the render ends. Any failure is logged (`artwork: <id> (<title>) failed (<why>); using the no-flyer card`) and that event renders the no-flyer card; a flyer never fails a render. The frames page sets `data-ready` once its fonts are loaded and its text is fitted, and the render fails if a vendored font or a local image didn't load, so a frame never goes out in a fallback face.

On a 1080 × 1920 frame the logo, counter, words, and footer stay between y 250 and 1670. In the Reel the words also stay left of x 916 and above y 1330, clear of Instagram's buttons and caption, and the cover's words sit inside the profile grid's centre 3:4 crop.

## Hoy link stickers

Set `"linkStickers": {"hoy": true}` in `~/.config/ba-events/instagram-publisher.json` to enable them. Leave it absent or `false` until you've reviewed a dry run and are ready to supervise the first approved Hoy. Carousels, Reels, and drafts already using Graph are unaffected.

Use the pinned Node version for `tick` and `stickers-dry-run`. The systemd unit uses Node with `--experimental-transform-types`, and the still-frame render child inherits that flag. After updating a checkout, run `systemctl --user daemon-reload` to pick up the tracked unit change (reinstall the unit first if it was copied rather than symlinked). Keep the existing Bun lockfile and install. On the VPS, the publisher gives `~/.agents/skills/remote-desktop/scripts/rbrowser pro url` 20 seconds to open or reuse the loopback tunnel at `http://127.0.0.1:9342`. If it cannot open the tunnel, the job falls back to Graph before Share. On the Pro the endpoint is `http://127.0.0.1:9333`; `BA_INSTAGRAM_STICKERS_CDP` can override either default. Meta must be signed in on the Pro's AgentBrowser. Never point this job at the LinkedIn or personal Chrome profile.

`stickers-dry-run` works with the flag off. It takes a saved Hoy draft with its original revision's frames still on disk. It uploads those frames into a new Business Suite composer tab, saves the Instagram preview as `frame-1.png`, `frame-2.png`, and so on in `--out`, discards the composer, and closes its tab. It never shares, schedules, calls the Graph API, or changes the draft. Use `BA_INSTAGRAM_STATE_DIR` to point to a private copy of a draft and its frames, with the saved paths updated to that copy.

Without an R2 bucket configured, the job does not start a new publish through either route. It still reconciles a saved Share attempt. The publisher opens its own Chrome target and uploads the JPEGs over that tab's DevTools connection. It does not attach to other tabs or change browser-wide settings. It then places the cover's **Ver la agenda** sticker and the closing frame's **Buscar planes** sticker on `https://baeventos.com`. Each event's **Ver evento** sticker goes to its event page. Business Suite edits each frame and uses **Share now** for `baeventos.app` only, not the Facebook Page. The job re-checks approval, time, and the catalog just before Share. The link-sticker route adds a native Instagram Mention for the same venue or curator account Graph would tag. Business Suite's smaller mention pill sits over the printed handle in the card's footer (`CARD.story.footer` in `html.ts`). The link stickers sit in bands the layout leaves empty (`STICKER_Y` in `html.ts`: centre y 1440 on the cover, 1590 on an event frame, 1390 on the closing frame). The publisher ignores lookalikes and display-name matches. If it can't find the exact username, it skips only that mention and lists the skipped usernames in the draft outcome note and Slack reply (or prints them for a dry run).

If the composer fails, the error and any composer alert point to a private `composer-failure-*` directory. It contains `failure.json` with the failed step and last known page URL (without its query string), and `screenshot.jpg` if the tab was still reachable. If a DevTools command times out before the final Share checks, the publisher closes that tab and tries one fresh composer within the same six-minute limit. Look under `--out` for a dry run, or `drafts/<id>/` under the publisher's state directory for a live attempt. Keep those files private.

If Business Suite fails before the Share attempt, the job discards the composer and uses Graph subject to the usual checks. A successful fallback alerts under `draft/<id>/stickers` with the cause (including a lapsed sign-in) and the next step. The browser flow has a six-minute cap. After saving the Share attempt, the job never makes a second write for that draft, even if approval is withdrawn or the feature is turned off. The job checks Graph for exactly the expected number of new Story IDs in the five minutes after the attempt, excluding IDs seen before Share. It polls for about a minute after the click, checks on later ticks, and holds with an alert if it can't confirm by the deadline. Don't publish manually on the account in that five-minute window: Graph counts frames but does not identify their composer or verify their stickers.

## Graph API publishing and idempotency

Reels: see "The Reel" above. Carousels: one image container per slide (`is_carousel_item=true`, `user_tags` positioned on the footer handle), wait for `FINISHED`, then the `CAROUSEL` container with the caption, wait for `FINISHED`, check `content_publishing_limit`, and `media_publish`. Stories: one `media_type=STORIES` container per frame with a `user_tags` mention and no coordinates, each published in order.

Each container and media id is saved to the draft's state file before the next step. Just before `media_publish` the unit records `pendingSince`. If the call has no clear answer, the next attempt reads **that container's own** `status_code`: `PUBLISHED` means this attempt went out (a carousel's media id is then looked up by its exact caption; a story frame is recorded as published without one); `FINISHED` means it didn't, and the same container is retried (a container publishes at most once); `EXPIRED` or `ERROR` starts over; anything else holds with an alert. Recent media and stories never decide whether something was posted, so an unrelated story posted around the same time is never adopted. Reconciling reads don't need approval, so an unclear publish is still settled after the deadline or a ❌.

## State and files

- State: `~/.local/state/ba-events-instagram/drafts/<id>.json` (one per draft) and the rendered frames in `drafts/<id>/current/`. Frames of finished drafts are removed after 14 days; the state files stay.
- Config: `~/.config/ba-events/instagram-publisher.json`, for example `{"auto": {"hoy": false, "finde": false, "gratis": false, "reel": false}, "r2": {"bucket": "baeventos-instagram-media", "publicBaseUrl": "https://ig-media.baeventos.com"}, "reel": {"musicDir": "~/.local/share/ba-events/reel-music"}}`. Auto mode is off unless set to `true`, and `reel.musicDir` defaults to that path. Without `r2`, the job stays preview-only.
- Instagram token: `~/.config/ba-events/instagram-token.json` (mode 600) with `access_token`, `ig_user_id`, and `expires_at`. A system-user token never expires: write `"expires_at": "never"` and the job skips refreshing and the expiry warning. For a dated token, once the token is more than 7 days old (by `refreshed_at`, or the file's modification time) the job refreshes it with `refresh_access_token` and writes it back atomically. A failed refresh or fewer than 10 days left raises `ba-events/instagram/token`. Without the file the job drafts and previews, then logs that it skipped publishing.
- R2: frames go to `instagram/<draft id>/<hash>/frame-N.jpg` (a Reel's to `reel.mp4` and `cover.jpg`) through the Cloudflare API, using the token `bin/ba-d1-read.sh` reads (`~/.config/ba-events/cloudflare-deploy-token`). A bucket lifecycle rule deletes them after 7 days.
- Slack: `~/.hermes/skills/productivity/slack-workspace/scripts/slack_api.py` (it reads the bot token itself).
- Rendering: the Reel as above; the frames with Playwright's Chromium headless shell from `~/.cache/ms-playwright`, in a child process under `systemd-run --user --scope --unit=ba-events-instagram-render-<pid>-<ms> -p MemoryMax=900M -p MemorySwapMax=0 -p RuntimeMaxSec=170`. On a timeout or error the job runs `systemctl --user stop <unit>.scope`, so no Chromium process outlives the render.
- Secrets never reach a command line: `bin/ba-d1-read.sh` hands curl its Authorization header on stdin (`curl -K -`), R2 uploads and Instagram calls use `fetch` inside the process, and `slack_api.py` reads the bot token itself. Fonts are the local woff2 files in `src/features/instagram-publisher/assets/fonts/` (Newsreader and DM Sans, OFL-1.1, from Fontsource).

## Troubleshooting

- **No preview or repeated tick failures:** run `journalctl --user -u ba-events-instagram.service -n 50`. The current streaks are in `~/.local/state/ba-events-instagram/tick-failures.json`, including failures before a draft file existed. If that file can't be read, the job logs the error, tries to move it aside as `tick-failures.json.bad-<timestamp>`, and starts with empty streaks. A render timeout mentions low memory only if the job measured less than 600 MB available when the render failed.
- **Publishing or a Slack reply failed:** run `mise exec -- bun scripts/instagram-publisher.ts status` and read the draft JSON. Check the saved container IDs and `pendingSince` before taking any action on Instagram. A pending `notify` does not mean Instagram needs another attempt.
- **Held or interrupted rebuild:** use `mise exec -- bun scripts/instagram-publisher.ts regenerate <draft id> --exclude <event id>` before the cutoff if publishing hasn't started. Omit `--exclude` if the picks don't need to change. After the cutoff, don't rebuild or manually retry the old draft.

## Install on the VPS

```sh
ln -sf ~/projects/ba-events/ops/systemd/ba-events-instagram.service ~/.config/systemd/user/
ln -sf ~/projects/ba-events/ops/systemd/ba-events-instagram.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now ba-events-instagram.timer
systemctl --user list-timers ba-events-instagram.timer
journalctl --user -u ba-events-instagram.service -n 50
```
