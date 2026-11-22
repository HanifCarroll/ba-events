# Instagram Publishing Specification

## Purpose
Define how the VPS job drafts the recurring @baeventos.app posts from the catalog, gets Hanif's approval in Slack, and publishes without ever posting twice. The words come from `src/features/instagram-publisher/copy.md`.

## Requirements

### Requirement: Posts show only qualifying intake events
A post MUST show only events from the Instagram intake that are scheduled, marked `scope = 'in'`, have a real start time (not time-TBA, not all-day), a venue, and a barrio, and fall in the format's days. Hoy MUST show only events starting at 18:00 or later Buenos Aires time; Gratis MUST show only free events. A post MUST NOT show two events at the same venue.

#### Scenario: Placeholder start time
- **WHEN** an event starts at 23:59, or at 00:00 while its intake candidate has no time
- **THEN** it does not qualify

#### Scenario: The tag is a curator, not the venue
- **WHEN** the tagged account is the intake post's account and isn't the venue's own
- **THEN** the caption line names the venue and ends "Vía @{handle}.", and the card footer reads "Vía @{handle}"

#### Scenario: Too few events qualify
- **WHEN** fewer events qualify than the format's minimum (Hoy 2, Este finde 4, Gratis 5, Este finde Reel 4)
- **THEN** the run is skipped and a new top-level message in #ba-eventos says "Skipped: only {n} events qualified"

#### Scenario: A free event qualifies for Hoy or Este finde
- **WHEN** at least one free event qualifies
- **THEN** the post includes at least one free event

### Requirement: Frames show each event's own artwork in the website's look
Every event card MUST show that event's own artwork whole, uncropped, above a solid panel that holds every word, so no text depends on the artwork's colors. Before a render the job MUST download each picked event's `image_url` over https and only from the catalog's known image origins (the R2 artwork route and the listed CDN hosts and paths), following at most three redirects and requesting no address or redirect hop outside those origins, with one 10 second limit for the whole download and a 15 MB limit, and MUST use it only if it decodes as a raster image. No format may use a stock photo. Among qualifying events the pick MUST prefer events that have artwork.

#### Scenario: A flyer can't be used
- **WHEN** an event has no `image_url`, or its download fails, times out, is too large, isn't https, or doesn't decode as an image
- **THEN** that event's card shows a dark tile with its title in the flyer's place, the reason is logged, and the render does not fail

#### Scenario: Too few events have artwork
- **WHEN** fewer qualifying events have artwork than the post has places
- **THEN** qualifying events without artwork fill the remaining places and are not dropped

#### Scenario: The Reel and the covers
- **WHEN** a Reel is drafted
- **THEN** it picks by the same rule as the carousel, so a qualifying event without artwork is not dropped and the free event is still included when one qualifies
- **AND** a Reel card for an event without artwork shows the dark titled tile
- **AND** a cover or closing frame shows only the artwork of events that have it

#### Scenario: The artwork address is not https or not a known image origin
- **WHEN** an event's `image_url` is empty, relative, not an `https:` URL, or not on one of the known image origins
- **THEN** it counts as having no artwork, for the pick and for the render, and it is never requested

#### Scenario: A redirect leaves the known image origins
- **WHEN** an allowed artwork address redirects to an address outside the known image origins
- **THEN** the job does not request that address, logs the reason, and renders the no-flyer card for that event

#### Scenario: A font or image file is missing at render time
- **WHEN** a vendored font or a downloaded image does not load in the frames page
- **THEN** the render fails instead of producing frames in a fallback face
- **AND** a Reel whose card can't load its fonts fails the render promptly instead of waiting or producing a video

### Requirement: The Este finde Reel shows the weekend's carousel picks as a video with rotating music
The Reel MUST be one 1080 × 1920 H.264/AAC MP4 at 30 fps, drafted Thursday 18:00 and published Friday 12:00, with Friday 18:00 as its cutoff and deadline. It MUST show 4 to 6 events picked by Este finde's rules, without the Este finde draft's exclusions and without any event that would be over by its Friday 18:00 deadline, hold each card's words still for max(3.0 s, 0.35 s a word, characters / 17), and cut on the track's beats. During the hold only the flyer may move, by a slow zoom of at most 4%.

#### Scenario: A Friday daytime event
- **WHEN** an event ends by Friday 18:00, or starts by then and has no end time
- **THEN** it is left out of the Reel (the carousel keeps it), and the next picks fill its place, so the Reel is never held at its slot or at a late ✅ for an event that is over

#### Scenario: The Reel's caption
- **WHEN** a Reel draft is built
- **THEN** its caption is the Este finde carousel's caption, with the track's credit line after "Más planes en baeventos.com (link en la bio)." when the track has one

#### Scenario: Choosing the track
- **WHEN** a Reel draft is created
- **THEN** it uses the track in the music directory whose last published Reel is oldest, tracks never published first in `tracks.json` order, and saves that track in the draft
- **AND** `regenerate` keeps the track unless given `--track <id>`

#### Scenario: The track can't be used
- **WHEN** the music directory or the track's file is missing, or the track has no `bpm` and `startSec`, or the excerpt would run past the end of the track
- **THEN** the draft fails with an alert and no Reel without music is made

#### Scenario: The video is still processing
- **WHEN** the Reel's container hasn't finished processing within a tick's polling time
- **THEN** the draft stays publishing, nothing new is created, and later ticks poll the same container

#### Scenario: The rendering environment is incomplete
- **WHEN** HyperFrames' managed Chrome is missing
- **THEN** the draft fails with an alert that names the install command

### Requirement: Every draft is approved in Slack before it is published
Each draft MUST go to #ba-eventos as a new top-level message with every frame attached (for a Reel, the video, and a last line naming the track). Only Hanif's ✅ and ❌ reactions count; thread replies do not.

#### Scenario: Hanif reacts ❌
- **WHEN** Hanif's ❌ is on the preview before the post goes out
- **THEN** the draft is skipped, even in auto mode, and the thread gets "Skipped: you reacted ❌"

#### Scenario: No ✅ by the cutoff
- **WHEN** there is no ✅ by 17:00 for Hoy, Friday 18:00 for Este finde and the Reel, or Tuesday 20:00 for Gratis, and auto mode is off
- **THEN** the draft is skipped and the thread gets "Skipped: no ✅ by {HH:MM}"

#### Scenario: Approval changes after publishing has started
- **WHEN** a draft is publishing and Hanif reacts ❌, or removes his ✅ with auto mode off
- **THEN** no further Instagram write is made: ❌ skips the draft, a removed ✅ pauses it

#### Scenario: Past the deadline
- **WHEN** the deadline has passed (Hoy 19:00, a carousel's or the Reel's cutoff)
- **THEN** the job creates and publishes no new media and only reconciles requests it already sent

#### Scenario: A selected event is cancelled before publishing
- **WHEN** any selected event is no longer scheduled at the first write of a publishing attempt, including a retry
- **THEN** the draft is held and the thread gets "Held: {title} was cancelled. Ask Hermes to regenerate it."

#### Scenario: A selected event is out of scope or unjudged before publishing
- **WHEN** a selected event is not marked `in` at the first write of a publishing attempt
- **THEN** the draft is held and the thread explains which event is no longer marked in scope

#### Scenario: A selected event is over by the time the post would go out
- **WHEN** at the first write of a publishing attempt a selected event has ended, or has started and has no end time
- **THEN** the draft is held and the thread gets "Held: {title} has already happened. Ask Hermes to regenerate it."

#### Scenario: Late ✅ on a carousel or the Reel
- **WHEN** a carousel's or the Reel's ✅ arrives after its slot but before its cutoff
- **THEN** it publishes at once

#### Scenario: Auto mode
- **WHEN** both the saved Instagram preview mode and the current config allow auto mode for the format
- **THEN** the preview is still posted and the post goes out at its slot unless Hanif reacted ❌
- **AND** if either setting is false or the preview predates saved modes, a ✅ is required

### Requirement: Hoy can publish with Instagram link stickers

With `linkStickers.hoy` enabled and no Graph API publish underway for the draft, the job MUST use Business Suite's Share now for Instagram only. Every frame MUST have an Instagram link sticker that leaves the artwork's text clear. The cover links to `https://baeventos.com` with “Ver la agenda”, each event frame to `https://baeventos.com/events/<event id>` with “Ver evento”, and the closing frame to `https://baeventos.com` with “Buscar planes”. If the composer does not support custom text, use its default. The job MUST re-check reactions, deadline, and event validity before Share and never use Business Suite scheduling.

#### Scenario: R2 is not configured
- **WHEN** the R2 bucket name or public base URL is missing or blank after trimming
- **THEN** it starts no new publish via Business Suite or Graph, even when link stickers are enabled
- **AND** it still reconciles a saved Share attempt without publishing again

#### Scenario: An event has a venue or curator handle
- **WHEN** the Graph route would tag an event frame's account
- **THEN** the Business Suite route adds an Instagram Mention sticker for that same username without covering the link sticker or other artwork text
- **AND** if the results list does not open or show an exact username match within five seconds, it skips only that mention and lists it in the outcome note

#### Scenario: The composer is unavailable before Share
- **WHEN** the browser flow fails before a Share attempt, including if Meta requires sign-in
- **THEN** the job discards the composer and uses the Graph API subject to the same publishing gates. If it publishes, it alerts that the Story went out without links and says what needs attention.

#### Scenario: Share was attempted but its outcome is unclear
- **WHEN** the job records a Share attempt with its time and frame count before dispatching the click
- **THEN** no tick may Share again or fall back. The job reads the account's Stories for the expected number of new frames since the attempt, even if approval changes or the flag turns off. If it cannot confirm the full count by the deadline, it holds the draft and alerts Hermes to check the account's Stories.

#### Scenario: A link sticker doesn't fit its free band
- **WHEN** a placed link sticker's measured rectangle is not wholly inside its frame's free band, which holds no text and ends at or above y 1670
- **THEN** the job discards the composer before Share and uses the Graph API route, and never shares a sticker over text or the reply bar

#### Scenario: A mention sticker doesn't fit its reserved area
- **WHEN** a placed mention sticker's measured rectangle, including its width, is not wholly inside the area reserved over the printed handle, which excludes the printed "Vía", the site address, the barrio row, and the link sticker's band
- **THEN** the job places it once more, and if it still doesn't fit, discards the composer before Share and uses the Graph API route

#### Scenario: A draft rendered with an earlier layout
- **WHEN** a draft has no saved layout version
- **THEN** its sticker preview, its Business Suite stickers and mention, and its Graph tags use the positions its frames were rendered for
- **AND** its approved frames are not rendered again

#### Scenario: Preview without publishing
- **WHEN** the operator runs `stickers-dry-run` for a saved Hoy draft
- **THEN** the job captures each frame's Instagram preview and confirms the composer was discarded without sharing, scheduling, or writing draft state.

#### Scenario: A composer step fails
- **WHEN** a Business Suite composer step fails in a dry run or a live attempt
- **THEN** the job records the failing step and last known page URL without query parameters in the run's evidence directory, captures a screenshot if the owned tab is reachable, and includes the evidence path in the error and any composer alert
- **AND** on a DevTools command timeout, it may try one fresh composer within the same flow deadline, only before entering the final Share checks.

### Requirement: Graph API publishing is idempotent
The job MUST save each container and media id before the next step, check `content_publishing_limit` before `media_publish`, and check that container's status after an unclear `media_publish` result before any retry.

#### Scenario: media_publish times out after Instagram posted
- **WHEN** the response to `media_publish` is lost
- **THEN** the next attempt reads that container's status and records the post instead of publishing again
- **AND** it never adopts an unrelated story or post by its timestamp

#### Scenario: Slack fails after a publish
- **WHEN** the post went out but the "Posted:" reply fails
- **THEN** the draft stays published, the reply is retried on later ticks, and only after three consecutive failed ticks does the alert say the post went out but the Slack reply did not

#### Scenario: The post is published
- **WHEN** publishing finishes
- **THEN** the preview's thread gets "Posted: {permalink}"

### Requirement: Alerts report persistent failures and missed deadlines

The job MUST log every failed attempt, persist failure streaks across ticks, and use plain language, Buenos Aires times, and a final diagnostic line for technical details.

#### Scenario: Drafting, previewing, or advancing a draft fails

- **WHEN** the same run fails for three consecutive ticks, even in different steps, or a failing run has no preview at least 60 minutes after its draft time
- **THEN** the alert names the affected run and the next retry. The shared tick alert only updates its thread when the qualifying runs or their causes change.

#### Scenario: Publishing has failed

- **WHEN** publishing fails three consecutive ticks, fails with less than 60 minutes until the deadline, or reaches its retry limit
- **THEN** the draft alert says whether the job will retry, check an unclear publish, or stop

#### Scenario: The job can't retry

- **WHEN** a draft is held, publishing stops part-way, a rebuild doesn't finish, or a preview misses its cutoff
- **THEN** the job alerts immediately with the outcome and does not retry the stopped step automatically

#### Scenario: A retry succeeds

- **WHEN** an open tick, publishing, or Slack reply alert is no longer failing because the job succeeded
- **THEN** the job closes the alert with a one-line recovery message that names the outcome

### Requirement: Eligible Instagram drafts share their Slack preview and approval with Threads

With Threads enabled, a Hoy, Este finde, or Gratis esta semana preview MUST append the exact Threads text in a quote block unless an earlier revision already dispatched Threads. The preview MUST distinguish manual approval from auto mode. Publishing without ✅ requires both the saved Threads preview mode and the current config to allow auto mode. The Reel MUST NOT preview or publish to Threads. The same Slack message and only Hanif's reactions govern both posts; ❌ skips both, including in auto mode. Threads auto mode is separate per format.

#### Scenario: Publishing window
- **WHEN** the job considers a new Threads write
- **THEN** it may start it at its slot or later, but strictly before its cutoff. All times are Buenos Aires: Hoy 11:30 to 17:00; Este finde Thursday 12:00 to Friday 12:00; Gratis Monday 12:00 to Tuesday 12:00.

#### Scenario: Approval arrives after the slot
- **WHEN** Hanif's ✅ is first read after the Threads slot but before its cutoff
- **THEN** the job may publish to Threads on that tick, regardless of whether Instagram has published

#### Scenario: Instagram needs a new revision after a Threads send
- **WHEN** a confirmed or unclear Threads send already exists and the Instagram draft has not started publishing or passed its cutoff
- **THEN** the operator can regenerate Instagram independently. The job retains the original Threads attempt, text, and reply thread. The new preview offers no second Threads post and notes a confirmed one.

#### Scenario: Instagram is regenerated after the Threads cutoff or after a skipped or failed Threads draft
- **WHEN** the operator regenerates an Instagram draft still eligible for rebuilding
- **THEN** the new preview does not offer a Threads post in those cases, and the job keeps any previous Threads state and original reply thread

#### Scenario: The picks change or approval is withdrawn
- **WHEN** a Threads write would begin
- **THEN** the job re-reads reactions and the cutoff, and before the first write of each attempt checks every saved pick using Instagram's current catalog check. An event that would hold Instagram also holds Threads. With auto off, removing ✅ pauses further writes. A confirmed or unclear publish still gets reconciled without new writes.

#### Scenario: Threads is disabled
- **WHEN** Threads is disabled or absent from config
- **THEN** the job adds no Threads preview or outcome text, makes no Threads API calls, and does not backfill a preview sent without Threads text. The job re-reads the enabled flag just before creating or publishing a container. If disabled during the tick, it pauses new writes and keeps any saved container. An explicit `dry-run --threads` can still write the text locally.

### Requirement: Threads uses plain text from the saved picks

The text MUST use the copy in `copy.md`, the cards' cleaned titles and price labels, venue names in title case when all-caps, Buenos Aires start times (`HH:MM`), and no emoji or hashtags. A leading `@` on a word in the title, venue, or barrio MUST be removed so it does not tag an account. An unknown price adds neither a label nor a separator. The post MUST be no more than 500 Unicode code points including its link line.

#### Scenario: A title repeats its venue
- **WHEN** a title ends in a dash followed by its own venue name, ignoring case, accents, and punctuation
- **THEN** the Threads text omits the suffix without changing the Instagram frames

#### Scenario: The full list exceeds 500 code points
- **WHEN** the full draft cannot fit
- **THEN** remove the latest pick on the day with the most picks until the text fits, the list reaches its minimum, or every remaining day has only one pick. If it still does not fit, shorten titles to at most 40 code points including the ellipsis before dropping any more picks. Then drop the latest pick overall as needed. Keep chronological order and at least two picks for Hoy or three for each carousel. If the minimum still cannot fit, do not post Threads or block Instagram.

### Requirement: Threads publishes independently and reconciles unclear sends without duplicates

Threads MUST save its own state, retries, container ID, media ID, permalink, and pending Slack outcome in the draft. The job MUST verify the Threads username is `baeventos.app`, create a `TEXT` container with topic `Buenos Aires` and link `https://baeventos.com`, wait for `FINISHED`, and check the account publishing limit before creating a container and before publishing. A container that is still processing after the tick's polling budget MUST be saved for the next tick without counting a failure.

#### Scenario: `threads_publish` returns an unclear result
- **WHEN** the publish sends without a confirmed answer
- **THEN** the job only reconciles it by a unique exact text match at or after the saved attempt's second, excluding media IDs seen before dispatch. A recovered publication timestamp MUST be stored as canonical ISO. The job never matches by time alone and only retries a publish write after a known rejection that rules out dispatch.

#### Scenario: One channel fails
- **WHEN** Instagram or Threads fails, or Slack cannot deliver an outcome reply
- **THEN** the other channel keeps its own outcome and retry schedule, and pending Threads replies are retried in the original preview thread without republishing. A final Threads failure also raises `ba-events/instagram/draft/<id>/threads`. If the alert command fails, the alert remains pending for another tick.

#### Scenario: Slack approval cannot be read
- **WHEN** a Slack reaction read fails at or after the Threads slot
- **THEN** Threads waits for a successful read until the cutoff without counting a Threads API failure

#### Scenario: The Threads token needs attention
- **WHEN** a live tick uses Threads and the long-lived token is over seven days old and not yet expired
- **THEN** the job attempts a refresh and writes a successful refresh atomically in mode 600. It raises `ba-events/instagram/threads-token` on refresh failure or when the token has at most ten days left.

#### Scenario: An operator requests the Threads report
- **WHEN** the operator runs `threads-report` with a day count (default 28)
- **THEN** the job reads saved Threads publications and the verified account's insights to report the date, format, views, likes, replies, reposts, quotes, link clicks if returned, permalink, and account follower count without writing anything.

### Requirement: The job never writes the catalog and never exposes secrets
The job MUST read D1 only through read-only SELECT statements, MUST NOT print the Instagram, Threads, Slack, or Cloudflare tokens or pass them in any process's arguments, and MUST NOT publish to Instagram when the Instagram token file is missing.

#### Scenario: Token file missing
- **WHEN** `~/.config/ba-events/instagram-token.json` does not exist
- **THEN** drafts and previews still happen, and Instagram publishing is logged and skipped
