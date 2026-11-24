# Web Entry Experience Specification

## Purpose
Define the homepage agenda and consistent navigation to the web chat and Telegram bot.

## Requirements

### Requirement: Event details preserve cross-day end dates
Event detail time ranges SHALL show the end date when it differs from the start date in Buenos Aires time. Same-day ranges SHALL retain a time-only end, regardless of a UTC date boundary.

#### Scenario: Event ends the next local day
- **WHEN** a saved event starts on October 17 at midnight and ends on October 18 at 06:00 in Buenos Aires
- **THEN** its detail range includes both October 17 and October 18 rather than implying a six-hour same-day event

#### Scenario: UTC midnight is not local midnight
- **WHEN** start and end timestamps fall on different UTC dates but the same Buenos Aires date
- **THEN** the end remains time-only in the active locale

### Requirement: Web event views omit unknown prices
The homepage agenda, chat event cards, and event details SHALL omit the price field when the listing has no amount and does not confirm free admission. The homepage SHALL still show its pay-what-you-can label when supported by evidence.

#### Scenario: A listing does not state a price
- **WHEN** an event with an unknown price appears on the homepage, a web chat card, or an event detail page
- **THEN** the web view renders no placeholder, price separator, or empty price slot
- **AND** the chat model facts and event structured data remain unchanged by this display rule

### Requirement: The homepage introduces independent culture
The homepage SHALL use the active locale for the independent-culture title, description, headline, and a single short subtitle. It SHALL keep Instagram and Telegram links in the follow section and SHALL NOT present an invented example conversation.

#### Scenario: Visitor opens the homepage
- **WHEN** the homepage renders at 320 CSS pixels or wider in English or Spanish
- **THEN** the wordmark sits on the left and only the language toggle and text sign-in or account control sit on the right, on a single row without overflow
- **AND** each target is at least 44 pixels tall and wide, and the toggle shows only the other language's code with a localized accessible name describing the switch

#### Scenario: A signed-in visitor switches languages on a filtered view
- **WHEN** their saved language differs from the browser preference or its old locale cookie
- **THEN** server rendering and hydration agree on the saved language, the preference cookie is readable by the browser, and the toggle offers the other language
- **AND** switching languages persists the account preference and keeps the current filter URL

### Requirement: The homepage offers installation to returning phone visitors
The homepage SHALL count one visit per browser tab session in local browser storage. It SHALL offer installation only from the second eligible session, below 768 CSS pixels with a coarse primary pointer and no hover and only when the browser offers a native prompt or can show the iOS instructions. Returning from an event, reloading, switching languages, and changing filters or paging SHALL NOT start a new visit in the same tab session.

#### Scenario: A returning visitor is offered installation
- **WHEN** a visitor opens the homepage in a second eligible tab session in the same browser and installation is available
- **THEN** a localized hint with install and dismiss actions appears after the agenda's chat composer without covering the agenda or moving its first card
- **AND** the install action uses the browser prompt when available, or the existing iOS instructions otherwise

#### Scenario: Installation is dismissed or complete
- **WHEN** the visitor dismisses the hint, dismisses a native prompt or opens the manual iOS instructions from any install control, or receives browser confirmation of installation
- **THEN** the homepage does not offer the hint again in that browser's local storage
- **AND** the hint is never shown when already running standalone or when local storage is unavailable

### Requirement: The app header places the menu trigger on the right
Below the large breakpoint, the app layout’s mobile header on non-homepage routes SHALL place the home wordmark at the left and the menu trigger at the right. The menu SHALL open below the full header without pushing the page content down.

#### Scenario: A visitor toggles the mobile menu from the keyboard
- **WHEN** the visitor focuses and activates the menu trigger
- **THEN** the trigger retains focus and its accessible name and expanded state reflect whether the menu is open
- **AND** while the menu is open, Tab from the trigger enters the menu
- **AND** the mobile menu and desktop sidebar use the same single language toggle as the homepage and show a text sign-in link to signed-out visitors

### Requirement: Web branding uses the BA Eventos ticket mark
The homepage and app navigation SHALL show the ticket wordmark as a home link with the accessible name “BA Eventos”. Browser tab, Apple touch, and installable app icons SHALL use the matching ticket mark.

#### Scenario: A visitor opens or installs the website
- **WHEN** the website renders at mobile or desktop widths
- **THEN** the wordmark links home and its name is available without relying on the image loading
- **AND** the browser tab and installed app use the ticket mark

### Requirement: The homepage leads with the current agenda
The homepage SHALL lead with the current agenda and render exactly one centered chat composer within it, before the follow links. Filter and paging URLs SHALL render the same view on a direct request. The server SHALL select each view from the shared cached agenda without sending undisplayed cards to the browser.

#### Scenario: A visitor reaches the homepage composer
- **WHEN** the homepage renders the default or a filtered agenda
- **THEN** the composer follows the first six phone rows or the first two desktop grid rows, or the last visible card if there are fewer, even before hydration or without JavaScript
- **AND** it follows the agenda status when no cards are visible, and contains a short heading, an input, and at most two suggestion chips

#### Scenario: A visitor focuses the homepage composer
- **WHEN** the textarea receives focus by touch or keyboard
- **THEN** a visible outline follows the rounded form instead of outlining the textarea
- **AND** the enabled microphone, send, and suggestion buttons retain distinct keyboard focus indicators

#### Scenario: A visitor browses more of the agenda
- **WHEN** the homepage renders without a valid paging parameter
- **THEN** it shows at most 24 grouped cards and the localized shown and total counts when there are matches
- **AND** if more cards are available, a real link increases `n` by 24, preserving `f`; the count is bounded by the selected view's total
- **AND** with JavaScript, the link adds cards without a document reload or a scroll jump, including when the link is near the top of the viewport; choosing a filter starts its view over at 24 cards
- **AND** the server groups time slots before applying the card limit, and retains the localized empty-date message and its fallback cards

#### Scenario: A visitor opens the first page or scrolls deep into it
- **WHEN** the agenda shows flyer cards
- **THEN** the first four images load eagerly, the first has high fetch priority, and the remaining images load lazily in reserved 4:5 frames
- **WHEN** the visitor scrolls more than approximately two viewport heights
- **THEN** a localized back-to-top button with a target at least 44 pixels square appears clear of page controls and safe-area insets, and hides when its measured footprint is within 8 CSS pixels of the composer form or the install hint, including when the hint arrives without a scroll
- **AND** the button is available at the bottom of any scrollable agenda, even when the visitor has not scrolled two viewport heights
- **AND** activating it returns the visitor to the top without smooth scrolling when reduced motion is requested

#### Scenario: A visitor filters the agenda
- **WHEN** the visitor selects Today, This weekend, Free, or Music
- **THEN** the filter strip stays on one row, scrolls horizontally when needed, and visibly fills the selected filter
- **AND** the agenda shows respectively the current local date, the current or next Friday–Sunday intersected with the weekly window, confirmed free admission, or a concert or live-music facet
- **AND** date filters include any remaining occurrence whose interval overlaps the selected dates, even if it starts before them and has not started yet
- **AND** pay-what-you-can evidence in an intake price note, or “a la gorra” in the title or Spanish description, takes precedence over a free flag or zero price; the card says “A la gorra” and does not appear in Gratis

#### Scenario: An occurrence ends while the agenda is open
- **WHEN** the homepage renders on the server or the clock advances in the browser
- **THEN** the agenda omits timed occurrences at their explicit end, or three hours after their start if no end is known
- **AND** all-day and time-TBA events remain through their Buenos Aires start day, and ongoing multi-day events with a later explicit end remain eligible

#### Scenario: A venue offers several time slots on the same day
- **WHEN** remaining timed occurrences share a normalized title, a known venue, and a Buenos Aires start date
- **THEN** they appear on one card listing distinct remaining times in order and linking to the next upcoming occurrence, or the first remaining one if no later slot remains
- **AND** time-TBA and all-day occurrences stay on separate cards, as do occurrences at a different venue or on a different local date

#### Scenario: A filter has no matches
- **WHEN** the selected filter has no matches
- **THEN** the agenda shows its localized empty message
- **AND** only the date filters may show up to four later cards, after the selected date range, beneath that message
- **AND** a failed feed or empty unfiltered agenda shows the localized agenda error rather than a blank section

#### Scenario: A visitor uses an agenda card
- **WHEN** an event appears in the agenda
- **THEN** its title, local date and time state, venue and neighborhood when known, and any displayed price appear as real text
- **AND** below 768 CSS pixels, events form a one-column list with a flyer thumbnail on the left and details on the right. Non-sticky headings mark changes of Buenos Aires start date, including when paging extends a date already on screen. Rows under a heading show the time state without repeating the date
- **AND** from 768 CSS pixels, the grid has three columns, four from 1024, and five from 1440; each card shows its own date
- **AND** the card links to event details and can prefill the composer with the existing event prompt
- **AND** glossary triggers appear on the matched words in the title or metadata, without adding another line, and work by pointer, touch, and keyboard; terms that appear only in the description do not add a trigger, and Escape dismisses an open definition even while hovered
- **AND** titles underline only on hover or keyboard focus and clamp to two lines until a glossary trigger needs keyboard focus or opens its definition; metadata uses the body font and wraps without clipping
- **AND** the source link, when available, shows “Ver post” / “View post” for Instagram posts and reels, or “Ver evento” / “View event” for another event page; the composer action shows “Preguntar” / “Ask”
- **AND** both actions have visible text and event-specific accessible names on all layouts, with targets at least 44 pixels tall and wide and both actions fitting on one line at 320 CSS pixels; either action underlines only on hover or keyboard focus

#### Scenario: A visitor starts a chat from the agenda
- **WHEN** the visitor sends a first message from the homepage
- **THEN** the chat receives the first four event IDs in the displayed view, or fewer if fewer cards are shown, including displayed date fallbacks and no IDs for an empty view
- **AND** an unchanged Ask prompt still identifies its specific event

### Requirement: The homepage header surfaces agenda flyers
The homepage SHALL show three or four linked flyers in the desktop header photo slot when enough events qualify, and SHALL give the headline the full header width when the collage is unavailable or hidden below the medium breakpoint. The collage SHALL NOT change when a visitor switches agenda filters.

#### Scenario: Selecting current flyers
- **WHEN** the homepage has enough eligible events after the first five cards of the default agenda
- **THEN** the collage uses only remaining, in-scope events with non-empty artwork, with at most one flyer per known venue
- **AND** it prefers the This Weekend window and, within each date tier, known portrait artwork with a width-to-height ratio at most 0.9, with deterministic ordering for a given Buenos Aires day and eligible set
- **AND** it fills from the rest of the default agenda only if fewer than three weekend flyers qualify, and omits the collage entirely if fewer than three total qualify

#### Scenario: A visitor uses the desktop collage
- **WHEN** the desktop collage is visible
- **THEN** its overlapping 4:5 flyers crop artwork to fill the frame, and link to event details with the event titles as accessible names
- **AND** hovering or keyboard-focusing a flyer straightens it and raises it above overlapping flyers, with a visible keyboard focus outline and no animation for reduced motion

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
- **AND** the homepage agenda uses a 4:5 frame for portrait, square, and landscape flyers and fills any bars with a darkened blur of the same responsive image, without an additional image URL

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
- Browser checks: render the real components in English and Spanish at desktop and mobile widths; verify homepage alignment at 320, 390, and 1440 CSS pixels, both session states, the second-visit install hint, and its dismissal. Verify app header alignment, menu keyboard access, navigation icon geometry, wrapped labels, Telegram link attributes, and Claude and ChatGPT setup instructions. Verify the phone list, desktop grid, centered composer, and pagination.
- Install hint persistence: `src/shared/lib/pwa/install-hint.test.ts`.
- Static check: `bun run paraglide:compile && bun run check`
- Specification validation: `bunx @fission-ai/openspec validate --specs --json`
