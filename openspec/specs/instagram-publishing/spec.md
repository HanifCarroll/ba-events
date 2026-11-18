# Instagram Publishing Specification

## Purpose
Define how the VPS job drafts the recurring @baeventos.app posts from the catalog, gets Hanif's approval in Slack, and publishes through the Instagram API without ever posting twice. The words come from `src/features/instagram-publisher/copy.md`.

## Requirements

### Requirement: Posts show only qualifying intake events
A post MUST show only events from the Instagram intake that are scheduled, have a real start time (not time-TBA, not all-day), a venue, and a barrio, and fall in the format's days. Hoy MUST show only events starting at 18:00 or later Buenos Aires time; Gratis MUST show only free events. A post MUST NOT show two events at the same venue.

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

### Requirement: The Este finde Reel shows the weekend's carousel picks as a video with rotating music
The Reel MUST be one 1080 × 1920 H.264/AAC MP4 at 30 fps, drafted Thursday 18:00 and published Friday 12:00, with Friday 18:00 as its cutoff and deadline. It MUST show 4 to 6 events picked by Este finde's rules, without the Este finde draft's exclusions and without any event that would be over by its Friday 18:00 deadline, hold each card still for max(3.0 s, 0.35 s a word, characters / 17), and cut on the track's beats.

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

#### Scenario: A selected event is over by the time the post would go out
- **WHEN** at the first write of a publishing attempt a selected event has ended, or has started and has no end time
- **THEN** the draft is held and the thread gets "Held: {title} has already happened. Ask Hermes to regenerate it."

#### Scenario: Late ✅ on a carousel or the Reel
- **WHEN** a carousel's or the Reel's ✅ arrives after its slot but before its cutoff
- **THEN** it publishes at once

#### Scenario: Auto mode
- **WHEN** a format's auto mode is on
- **THEN** the preview is still posted and the post goes out at its slot unless Hanif reacted ❌

### Requirement: Publishing is idempotent
The job MUST save each container and media id before the next step, check `content_publishing_limit` before `media_publish`, and after an unclear `media_publish` result list the account's recent media before any retry.

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

- **WHEN** the same run fails for three consecutive ticks, or a failing run has no preview at least 60 minutes after its draft time
- **THEN** the shared tick alert names the affected run and the next retry; repeats only update its thread when the qualifying runs or their causes change

#### Scenario: Publishing has failed

- **WHEN** publishing fails three consecutive ticks, fails with less than 60 minutes until the deadline, or reaches its retry limit
- **THEN** the draft alert says whether the job will retry, check an unclear publish, or stop

#### Scenario: The job can't retry

- **WHEN** a draft is held, publishing stops part-way, a rebuild doesn't finish, or a preview misses its cutoff
- **THEN** the job alerts immediately with the outcome and does not retry the stopped step automatically

#### Scenario: A retry succeeds

- **WHEN** an open tick, publishing, or Slack reply alert is no longer failing because the job succeeded
- **THEN** the job closes the alert with a one-line recovery message that names the outcome

### Requirement: The job never writes the catalog and never exposes secrets
The job MUST read D1 only through read-only SELECT statements, MUST NOT print the Instagram, Slack, or Cloudflare tokens or pass them in any process's arguments, and MUST NOT publish when the Instagram token file is missing.

#### Scenario: Token file missing
- **WHEN** `~/.config/ba-events/instagram-token.json` does not exist
- **THEN** drafts and previews still happen, and publishing is logged and skipped
