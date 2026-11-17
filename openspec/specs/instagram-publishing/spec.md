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
- **WHEN** fewer events qualify than the format's minimum (Hoy 2, Este finde 4, Gratis 5)
- **THEN** the run is skipped and a new top-level message in #ba-eventos says "Skipped: only {n} events qualified"

#### Scenario: A free event qualifies for Hoy or Este finde
- **WHEN** at least one free event qualifies
- **THEN** the post includes at least one free event

### Requirement: Every draft is approved in Slack before it is published
Each draft MUST go to #ba-eventos as a new top-level message with every frame attached. Only Hanif's ✅ and ❌ reactions count; thread replies do not.

#### Scenario: Hanif reacts ❌
- **WHEN** Hanif's ❌ is on the preview before the post goes out
- **THEN** the draft is skipped, even in auto mode, and the thread gets "Skipped: you reacted ❌"

#### Scenario: No ✅ by the cutoff
- **WHEN** there is no ✅ by 17:00 for Hoy, Friday 18:00 for Este finde, or Tuesday 20:00 for Gratis, and auto mode is off
- **THEN** the draft is skipped and the thread gets "Skipped: no ✅ by {HH:MM}"

#### Scenario: Approval changes after publishing has started
- **WHEN** a draft is publishing and Hanif reacts ❌, or removes his ✅ with auto mode off
- **THEN** no further Instagram write is made: ❌ skips the draft, a removed ✅ pauses it

#### Scenario: Past the deadline
- **WHEN** the deadline has passed (Hoy 19:00, a carousel's cutoff)
- **THEN** the job creates and publishes no new media and only reconciles requests it already sent

#### Scenario: A selected event is cancelled before publishing
- **WHEN** any selected event is no longer scheduled at the first publishing write
- **THEN** the draft is held and the thread gets "Held: {title} was cancelled. Ask Hermes to regenerate it."

#### Scenario: Late ✅ on a carousel
- **WHEN** a carousel's ✅ arrives after its slot but before its cutoff
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
- **THEN** the draft stays published, the reply is retried on later ticks, and the alert says the post went out

#### Scenario: The post is published
- **WHEN** publishing finishes
- **THEN** the preview's thread gets "Posted: {permalink}"

### Requirement: The job never writes the catalog and never exposes secrets
The job MUST read D1 only through read-only SELECT statements, MUST NOT print the Instagram, Slack, or Cloudflare tokens or pass them in any process's arguments, and MUST NOT publish when the Instagram token file is missing.

#### Scenario: Token file missing
- **WHEN** `~/.config/ba-events/instagram-token.json` does not exist
- **THEN** drafts and previews still happen, and publishing is logged and skipped
