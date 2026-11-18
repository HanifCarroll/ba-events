# Instagram publisher

A VPS job drafts four recurring posts for @baeventos.app from the catalog, previews each one in Slack #ba-eventos, and publishes it through the Instagram Graph API (`graph.facebook.com`) once Hanif approves. The token is the system-user token of the Meta app "BA Eventos Publisher" (id 2298370517615574, business portfolio HC Studio), made with Facebook Login for Business, because new Meta apps no longer offer Instagram Login. The specification is `openspec/specs/instagram-publishing/spec.md`, and every word the posts and messages use is in `src/features/instagram-publisher/copy.md`.

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
mise exec -- bun scripts/instagram-publisher.ts tick                                               # what the timer runs
```

`dry-run` takes the run's first day (any day for Hoy, a Friday for Este finde and the Reel, a Monday for Gratis) and writes the frames, `caption.txt`, the Slack text in `slack.txt`, and `events.txt` (the picks with their ids). For the Reel it writes `reel.mp4`, `cover.jpg`, and `timing.json` instead of frames, says which track it chose, and takes `--track <id>` to try another. `regenerate` keeps earlier exclusions, posts the rebuilt draft as a new top-level preview, and resets the approval: reactions on the old message no longer count. It refuses a draft that's publishing or published, or past its cutoff.

## How a tick works

The `ba-events-instagram.timer` user timer runs `tick` every 10 minutes. systemd never starts a second run of a oneshot service while one is still running, and a lock directory also guards against a manual `regenerate` racing a tick.

1. It checks the Instagram token (below).
2. For each format whose draft time has come and whose cutoff hasn't passed, it creates the draft if none exists: it reads the catalog, picks the events, renders the frames into `rev-1/`, and posts the preview. Too few events posts the skip message instead.
3. It delivers any Slack reply still pending from an earlier tick.
4. For each open draft it reads Hanif's reactions with `reactions.get` and decides (`approval.ts`). ❌ always skips. Before the slot it waits. At the slot it publishes when there's a ✅ seen before the cutoff (or auto mode is on) and the deadline hasn't passed. After the cutoff with no ✅ it skips. A ✅ first seen by the tick just after the cutoff still counts, because Slack doesn't timestamp reactions.
5. Publishing uploads the frames to R2 (only if their hash still matches the saved revision), then runs `instagram.ts`.
6. **Before every Instagram write** (each container, the carousel, each `media_publish`, each story frame), including retries of a draft already in `publishing`, the job re-reads the reactions and the clock. Before the first new write of each attempt (every tick that writes), it also re-reads the selected events' status and times from D1 and checks them against the current time. An event that is no longer scheduled holds the draft with "Held: {title} was cancelled. Ask Hermes to regenerate it." An event that has ended (or started, with no end time) holds it with "Held: {title} has already happened. Ask Hermes to regenerate it." The alert names the `regenerate … --exclude <id>` command. Reconciling an earlier unclear publish is only a read, so none of these checks block it. ❌ ends the draft ("Skipped: you reacted ❌"). A removed ✅ (auto mode off) pauses it until the ✅ returns. At or after the deadline nothing new is created ("Skipped: not published by {HH:MM}"). If some story frames already went out, the draft is marked `failed` with an alert, and nothing more is posted.
7. The outcome ("Posted: {permalink}", "Skipped: …", "Held: …") is saved together with a pending Slack reply. If Slack fails, the outcome stands, the reply stays pending, later ticks retry it, and the alert `ba-events/instagram/draft/<id>/slack` says what happened on Instagram.

A failure raises the alert `ba-events/instagram/tick` or `ba-events/instagram/draft/<id>` (routed to #ba-eventos). Publishing retries every tick. After 6 failures the draft is marked `failed`, unless a `media_publish` is still unclear, in which case it keeps checking. A draft whose preview never reached Slack is marked `failed` at its cutoff, and a `regenerate` that stopped part-way is marked `failed` on the next tick. Both raise `ba-events/instagram/draft/<id>` with what failed and how to recover, and later ticks never resolve that alert.

## Regenerate

`regenerate` refuses a draft that has started publishing, or is past its cutoff. It first saves the draft as revision n+1 in state `rebuilding` with approval cleared, then renders into `rev-<n+1>/` (old frames are never overwritten) and posts a new top-level preview. If it crashes part-way, the next tick marks the draft `failed` and raises its alert with the exact command to run again. Publishing uploads only frames that sit in the saved revision's directory and match its hash.

## The Reel

The Reel shows the Este finde selection again as a video: a cover card, one card per event, and a closing card, in the look Hanif approved (HyperFrames project v3, ported to `src/features/instagram-publisher/reel/project.ts`). Its picks use the Este finde rules, leave out the finde draft's `--exclude` ids, and leave out any event that would be over by the Reel's Friday 18:00 deadline (its end, or its start when it has no end), so the pre-publish check never holds it at the slot or at a late ✅. So it shows the carousel's selection minus Friday daytime events, with the next picks filling their places; a 12:00–20:00 exhibition stays, a 12:00 talk with no end time doesn't. Each card holds still for H = max(3.0 s, 0.35 s × words, characters / 17) after a 0.5 s entrance and before a 0.2 s exit, rounded up to whole beats of the track, so every cut lands on a beat. A Reel is about 37 s with 4 events and 48 s with 6.

**Music.** The tracks live outside the repo, in the directory `reel.musicDir` in the config (default `~/.local/share/ba-events/reel-music`): one audio file per track and `tracks.json`, whose `tracks` entries have `id`, `title`, `artist`, `file`, `durationSec`, `bpm`, `startSec`, `credit`, `source`, and `license`. The Meta Sound Collection tracks may only be used in content on Meta's products and never distributed separately, and the repo is public, so never commit the files or anything made from them. `startSec` is a downbeat where the full arrangement plays, with enough music after it for the longest Reel (6 events with long titles, about 82–87 s) before the track ends or goes quiet. `bpm` comes from the kick, not from `hyperframes beats`, which can follow off-beats.

**Rotation.** A new Reel draft takes the track whose last published Reel is oldest; tracks never published come first, in `tracks.json` order. The draft saves its track, `regenerate` keeps it unless given `--track <id>`, and the preview's last line names it ("Music: …"). A track with a `credit` adds that line to the caption. A missing directory or file, or a track without `bpm` and `startSec`, fails the draft with the tick alert; there's never a Reel without music. The excerpt starts at `startSec`, fades in over 0.3 s and out over 1.0 s, and is normalized to −14 LUFS and −1.5 dBTP; the build refuses one that runs past the end of the file.

**Rendering.** `npx --yes hyperframes@0.9.66 render --quality delivery --workers 1` (telemetry off) runs in `systemd-run --user --scope --collect --unit=ba-events-instagram-reel-<pid>-<ms> -p MemoryMax=1000M -p MemorySwapMax=0 -p RuntimeMaxSec=600`; a timeout or error stops the scope. It uses HyperFrames' managed Chrome Headless Shell in `~/.cache/hyperframes/chrome/`, not Playwright's (which exits at once). If it's missing the draft fails with an alert naming `npx --yes hyperframes@0.9.66 browser ensure`; the VPS has no `unzip`, so that install needs an unzip shim on `PATH`. ffmpeg and ffprobe come from `BA_INSTAGRAM_FFMPEG_DIR`, `PATH`, or `~/.hermes/tools/ffmpeg-*/bin`. On the VPS the 48 s Reel takes about 75 s and peaked at about 850 MB in its scope. Fonts, the hero photo, the noise tile (`reel/assets/noise.png`), and GSAP (`node_modules/gsap`) are copied into the project; nothing is fetched at render time. The job checks the MP4 (1080 × 1920 H.264 yuv420p at 30 fps with AAC, the expected length) before it's previewed.

**Publishing.** It uploads `instagram/<draft id>/<hash>/reel.mp4` (`video/mp4`) and `cover.jpg` (the cover card's hold frame) to R2, creates one `media_type=REELS` container with `video_url`, `cover_url`, `caption`, and `share_to_feed=true`, and polls its `status_code` for up to about 5 minutes per tick. A video still processing leaves the draft `publishing` without counting a failure, and the next tick polls the same container. Then it checks `content_publishing_limit` and calls `media_publish`, with the same idempotency and checks as a carousel (below).

**Slack.** The preview is a new top-level message with the MP4 attached (through Slack's external upload, which sends the bytes straight to the upload URL; a 10 MB video is fine) and ends with `Music: "{title}" by {artist}.`

## Selection

Events come from the Instagram intake (they have `event_source_evidence`) and must be scheduled, not time-TBA, not all-day, not location-hidden, and have a venue with a barrio. An event that is over by the publish slot (its end, or its start when it has no end) is left out, so Sunday's Gratis draft doesn't list Monday-morning events. The pick is greedy and deterministic: one event per venue (names compared without accents or punctuation), a free event first for Hoy and Este finde when one qualifies, then whichever event adds a new barrio, a new category, and a description line, earliest first on ties. The cards are in start order.

Placeholder start times don't count as real ones: a 23:59 start (the intake's end-of-day stand-in), and a 00:00 start when an intake candidate (not a link to a scraped event) left `time` empty. Time-TBA rows are already `time_tba`. A title ending in "@ {venue}" (or "@{venue}") that names the event's own venue loses that suffix.

The tag is the venue's `instagram_handle`, else the account of the intake post the event came from, else none (the caption then names the venue). When the tag is the posting account and its name doesn't match the venue's (`accountIsVenue`: "salalucida" is Sala Lúcida, "ccmacedonia" is Centro Cultural Macedonia, "vamos_gratis" isn't Facultad de Derecho), the caption names the venue and ends the line "Vía @handle.", and the card footer reads "Vía @handle". "A la gorra" comes from the intake candidate's `price_note` when its `price_kind` is `conditional` and the note says "a la gorra", "contribución consciente", or "a voluntad"; the catalog has no column for it.

## Publishing and idempotency

Reels: see "The Reel" above. Carousels: one image container per slide (`is_carousel_item=true`, `user_tags` positioned on the footer handle), wait for `FINISHED`, then the `CAROUSEL` container with the caption, wait for `FINISHED`, check `content_publishing_limit`, and `media_publish`. Stories: one `media_type=STORIES` container per frame with a `user_tags` mention and no coordinates, each published in order.

Each container and media id is saved to the draft's state file before the next step. Just before `media_publish` the unit records `pendingSince`. If the call has no clear answer, the next attempt reads **that container's own** `status_code`: `PUBLISHED` means this attempt went out (a carousel's media id is then looked up by its exact caption; a story frame is recorded as published without one); `FINISHED` means it didn't, and the same container is retried (a container publishes at most once); `EXPIRED` or `ERROR` starts over; anything else holds with an alert. Recent media and stories never decide whether something was posted, so an unrelated story posted around the same time is never adopted. Reconciling reads don't need approval, so an unclear publish is still settled after the deadline or a ❌.

## State and files

- State: `~/.local/state/ba-events-instagram/drafts/<id>.json` (one per draft) and the rendered frames in `drafts/<id>/current/`. Frames of finished drafts are removed after 14 days; the state files stay.
- Config: `~/.config/ba-events/instagram-publisher.json`, for example `{"auto": {"hoy": false, "finde": false, "gratis": false, "reel": false}, "r2": {"bucket": "baeventos-instagram-media", "publicBaseUrl": "https://ig-media.baeventos.com"}, "reel": {"musicDir": "~/.local/share/ba-events/reel-music"}}`. Auto mode is off unless set to `true`, and `reel.musicDir` defaults to that path. Without `r2`, the job drafts and previews but doesn't publish.
- Instagram token: `~/.config/ba-events/instagram-token.json` (mode 600) with `access_token`, `ig_user_id`, and `expires_at`. A system-user token never expires: write `"expires_at": "never"` and the job skips refreshing and the expiry warning. For a dated token, once the token is more than 7 days old (by `refreshed_at`, or the file's modification time) the job refreshes it with `refresh_access_token` and writes it back atomically. A failed refresh or fewer than 10 days left raises `ba-events/instagram/token`. Without the file the job drafts and previews, then logs that it skipped publishing.
- R2: frames go to `instagram/<draft id>/<hash>/frame-N.jpg` (a Reel's to `reel.mp4` and `cover.jpg`) through the Cloudflare API, using the token `bin/ba-d1-read.sh` reads (`~/.config/ba-events/cloudflare-deploy-token`). A bucket lifecycle rule deletes them after 7 days.
- Slack: `~/.hermes/skills/productivity/slack-workspace/scripts/slack_api.py` (it reads the bot token itself).
- Rendering: the Reel as above; the frames with Playwright's Chromium headless shell from `~/.cache/ms-playwright`, in a child process under `systemd-run --user --scope --unit=ba-events-instagram-render-<pid>-<ms> -p MemoryMax=900M -p MemorySwapMax=0 -p RuntimeMaxSec=170`. On a timeout or error the job runs `systemctl --user stop <unit>.scope`, so no Chromium process outlives the render.
- Secrets never reach a command line: `bin/ba-d1-read.sh` hands curl its Authorization header on stdin (`curl -K -`), R2 uploads and Instagram calls use `fetch` inside the process, and `slack_api.py` reads the bot token itself. Fonts are the local woff2 files in `src/features/instagram-publisher/assets/fonts/` (Newsreader and DM Sans, OFL-1.1, from Fontsource).

## Install on the VPS

```sh
ln -sf ~/projects/ba-events/ops/systemd/ba-events-instagram.service ~/.config/systemd/user/
ln -sf ~/projects/ba-events/ops/systemd/ba-events-instagram.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now ba-events-instagram.timer
systemctl --user list-timers ba-events-instagram.timer
journalctl --user -u ba-events-instagram.service -n 50
```
