# Web Entry Experience Specification

## Purpose
Define homepage reassurance and consistent navigation to the web chat and Telegram bot.

## Requirements

### Requirement: Event details preserve cross-day end dates
Event detail time ranges SHALL show the end date when it differs from the start date in Buenos Aires time. Same-day ranges SHALL retain a time-only end, regardless of a UTC date boundary.

#### Scenario: Event ends the next local day
- **WHEN** a saved event starts on October 17 at midnight and ends on October 18 at 06:00 in Buenos Aires
- **THEN** its detail range includes both October 17 and October 18 rather than implying a six-hour same-day event

#### Scenario: UTC midnight is not local midnight
- **WHEN** start and end timestamps fall on different UTC dates but the same Buenos Aires date
- **THEN** the end remains time-only in the active locale

### Requirement: The homepage introduces independent culture
The homepage SHALL use the active locale for the independent-culture title, description, headline, and subtitles. It SHALL link to BA Eventos on Instagram in both desktop and mobile navigation and SHALL NOT present an invented example conversation.

#### Scenario: Visitor opens the homepage on a phone
- **WHEN** the homepage renders in English or Spanish
- **THEN** the Instagram link and language switch are available in the navigation

### Requirement: Web branding uses the BA Eventos ticket mark
The homepage and app navigation SHALL show the ticket wordmark as a home link with the accessible name “BA Eventos”. Browser tab, Apple touch, and installable app icons SHALL use the matching ticket mark.

#### Scenario: A visitor opens or installs the website
- **WHEN** the website renders at mobile or desktop widths
- **THEN** the wordmark links home and its name is available without relying on the image loading
- **AND** the browser tab and installed app use the ticket mark

### Requirement: The homepage leads with the current agenda
The homepage SHALL render the event grid before the chat composer and follow links. Filters SHALL use linkable `?f=` URLs that render the same view on a direct request; client-side filter changes SHALL reuse the loaded agenda.

#### Scenario: A visitor filters the agenda
- **WHEN** the visitor selects Today, This weekend, Free, or Music
- **THEN** the grid shows respectively the current local date, the current or next Friday–Sunday intersected with the weekly window, confirmed free admission, or a concert or live-music facet
- **AND** pay-what-you-can evidence in an intake price note, or “a la gorra” in the title or Spanish description, takes precedence over a free flag or zero price; the card says “A la gorra” and does not appear in Gratis

#### Scenario: An occurrence ends while the agenda is open
- **WHEN** the homepage renders on the server or the clock advances in the browser
- **THEN** the agenda omits timed occurrences at their explicit end, or three hours after their start if no end is known
- **AND** all-day and time-TBA events remain through their Buenos Aires start day, and ongoing multi-day events with a later explicit end remain eligible

#### Scenario: A venue offers several time slots on the same day
- **WHEN** remaining occurrences share a normalized title, a known venue, and a Buenos Aires start date
- **THEN** they appear on one card listing distinct remaining times in order and linking to the next upcoming occurrence, or the first remaining one if no later slot remains
- **AND** neither a different venue nor a different local date gets folded into that card

#### Scenario: A filter has no matches
- **WHEN** the selected filter has no matches
- **THEN** the grid shows its localized empty message
- **AND** only the date filters may show up to four later cards, after the selected date range, beneath that message
- **AND** a failed feed or empty unfiltered agenda shows the localized agenda error rather than a blank section

#### Scenario: A visitor uses an agenda card
- **WHEN** an event appears on the grid
- **THEN** its title, local date and time state, venue and neighborhood when known, and price state appear as real text
- **AND** the card links to event details and can prefill the composer with the existing event prompt
- **AND** glossary triggers appear on the matched words in the title or metadata, without adding another line, and work by pointer, touch, and keyboard; terms that appear only in the description do not add a trigger, and Escape dismisses an open definition even while hovered
- **AND** the grid has two columns below 640 CSS pixels, three from 640, four from 1024, and five from 1440; titles are clamped to three lines on mobile and two from 640 pixels until a clipped glossary trigger needs keyboard focus; the date, venue, neighborhood, and price can wrap without being clipped
- **AND** when an original post is available, its link and the composer action can stack when space runs out; desktop action labels do not wrap within an action

#### Scenario: A visitor starts a chat from the agenda
- **WHEN** the visitor sends a first message from the homepage
- **THEN** the chat receives the first four event IDs in the displayed view, or fewer if fewer cards are shown, including displayed date fallbacks and no IDs for an empty view
- **AND** an unchanged Ask prompt still identifies its specific event

### Requirement: Homepage reassurance focuses on guest access
The homepage SHALL state that the service is free to use and no sign-up is needed in the active locale. Its reassurance line SHALL NOT include the English-or-Spanish language claim.

#### Scenario: Visitor opens the homepage
- **WHEN** the homepage renders in English or Spanish
- **THEN** the reassurance line states that the service is free and registration is unnecessary without listing chat languages

### Requirement: The homepage feed shows only in-scope events
The D1 homepage feed SHALL omit out-of-scope and unjudged events before applying its result limit. It SHALL NOT change direct event detail URL behavior.

#### Scenario: The next events are a party and an unjudged show
- **WHEN** both are otherwise eligible for the homepage feed
- **THEN** neither consumes a slot in the feed

### Requirement: Card artwork preserves complete posters with a subtle background
Event artwork SHALL preserve the full image without cropping inside a softly tinted container. The container SHALL remain visually quieter than the card content when artwork dimensions leave unused space.

#### Scenario: Poster has a different aspect ratio from the card
- **WHEN** a portrait or landscape poster appears in a card
- **THEN** the full poster remains visible and unused image space uses a subtle background
- **AND** the homepage agenda uses a 4:5 frame for portrait, square, and landscape flyers

### Requirement: Telegram navigation preserves icon alignment
The desktop sidebar and mobile menu SHALL align the Telegram icon with the other primary navigation icons using the same horizontal padding and icon size. The Telegram icon SHALL retain its size when its label wraps.

#### Scenario: Telegram label wraps
- **WHEN** the Telegram link label occupies multiple lines
- **THEN** its icon remains 20 pixels wide and aligned with the New Chat and Feedback icons
- **AND** the full translated label remains visible

### Requirement: Chat navigation exposes the Privacy link
The desktop chat sidebar and mobile menu SHALL display a localized Privacy link to `/privacy` alongside the language controls. Activating the mobile link SHALL close the menu.

#### Scenario: Visitor opens chat navigation
- **WHEN** the chat sidebar or mobile menu renders in any supported locale
- **THEN** it contains a localized Privacy link with a target at least 44 pixels tall
- **AND** activating the mobile link closes the menu and opens the privacy policy

### Requirement: The MCP entry addresses AI assistant users
The homepage link to MCP setup SHALL address people using AI assistants without implying that building software is required, and SHALL NOT include a beta label.

#### Scenario: Visitor reads the MCP setup link
- **WHEN** the homepage renders in English or Spanish
- **THEN** the link invites AI assistant users to connect BA Eventos without a beta label

### Requirement: MCP setup includes Claude and ChatGPT instructions
The MCP setup page SHALL provide localized Claude web and desktop connector instructions followed by ChatGPT web plugin instructions. Both SHALL use the public endpoint without BA Eventos sign-in and link to their official setup guides. The page SHALL NOT claim verification in a client unless the project has verified it.

#### Scenario: Visitor connects from Claude
- **WHEN** a visitor opens MCP setup in English or Spanish
- **THEN** the page explains adding a custom connector, naming it BA Eventos, entering the displayed endpoint, selecting No sign in, and enabling it in a chat
- **AND** explains that a Team or Enterprise owner may need to add the connector first

#### Scenario: Visitor connects from ChatGPT
- **WHEN** a visitor opens MCP setup in English or Spanish
- **THEN** the page explains adding a custom MCP server from Plugins, naming it BA Eventos, entering the displayed endpoint, selecting No authentication, creating and installing the plugin, and invoking it with @ in a Work chat
- **AND** explains that workspace permissions must allow custom MCP servers
- **AND** the ChatGPT section contains no Codex terminal command

### Requirement: Browser interactions have one active lifecycle
The PWA installation prompt and pull-to-refresh gesture SHALL each have explicit states that determine whether a new interaction is accepted. A consumed installation prompt SHALL NOT be displayed or invoked again while its choice is pending. Acceptance SHALL remain distinct from confirmed installation.

#### Scenario: A visitor activates installation twice
- **WHEN** a browser installation prompt is already awaiting a choice
- **THEN** another activation does not invoke that prompt again
- **AND** confirmation through `appinstalled` cannot be overwritten by a late prompt result

#### Scenario: A pull gesture is cancelled or refresh fails
- **WHEN** the browser cancels an armed pull gesture
- **THEN** the indicator resets without refreshing
- **WHEN** refresh fails after release
- **THEN** the indicator resets and a subsequent gesture may retry
- **AND** repeated releases during refresh do not start concurrent refreshes

## Verification
- Implementation: `messages/en.json`, `messages/es.json`, `src/features/chat/components/SuggestedPrompts.svelte`, `src/shared/ui/MainLayout.svelte`, `src/features/events/components/EventArtwork.svelte`, `src/routes/mcp/+page.svelte`, `src/shared/lib/utils/formatting.ts`
- Browser checks: render the real components in English and Spanish at desktop and mobile widths; verify the reassurance line, navigation icon geometry, wrapped labels, Telegram link attributes, and Claude and ChatGPT setup instructions.
- Static check: `bun run paraglide:compile && bun run check`
- Specification validation: `bunx @fission-ai/openspec validate --specs --json`
