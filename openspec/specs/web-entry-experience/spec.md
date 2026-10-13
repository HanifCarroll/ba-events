# Web Entry Experience Specification

## Purpose
Define homepage reassurance and consistent navigation to the web chat and Telegram bot.

## Requirements

### Requirement: Homepage reassurance focuses on guest access
The homepage SHALL state that the service is free to use and no sign-up is needed in the active locale. Its reassurance line SHALL NOT include the English-or-Spanish language claim.

#### Scenario: Visitor opens the homepage
- **WHEN** the homepage renders in English or Spanish
- **THEN** the hero and closing reassurance lines state that the service is free and registration is unnecessary without listing chat languages

### Requirement: Card artwork preserves complete posters with a subtle background
Event artwork SHALL preserve the full image without cropping inside a softly tinted container. The container SHALL remain visually quieter than the card content when artwork dimensions leave unused space.

#### Scenario: Poster has a different aspect ratio from the card
- **WHEN** a portrait or landscape poster appears in a card
- **THEN** the full poster remains visible and unused image space uses a subtle background

### Requirement: Telegram navigation preserves icon alignment
The desktop sidebar and mobile menu SHALL align the Telegram icon with the other primary navigation icons using the same horizontal padding and icon size. The Telegram icon SHALL retain its size when its label wraps.

#### Scenario: Telegram label wraps
- **WHEN** the Telegram link label occupies multiple lines
- **THEN** its icon remains 20 pixels wide and aligned with the New Chat and Feedback icons
- **AND** the full translated label remains visible

### Requirement: Chat navigation omits the Privacy link
The desktop chat sidebar and mobile menu SHALL NOT display a Privacy navigation link.

#### Scenario: Visitor opens chat navigation
- **WHEN** the chat sidebar or mobile menu renders in any supported locale
- **THEN** it contains no Privacy navigation link

### Requirement: The MCP entry addresses AI assistant users
The homepage link to MCP setup SHALL address people using AI assistants without implying that building software is required, and SHALL retain the public beta label.

#### Scenario: Visitor reads the MCP setup link
- **WHEN** the homepage renders in English or Spanish
- **THEN** the link invites AI assistant users to connect BA Eventos and identifies the integration as public beta

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

## Verification
- Implementation: `messages/en.json`, `messages/es.json`, `src/features/chat/components/SuggestedPrompts.svelte`, `src/shared/ui/MainLayout.svelte`, `src/features/events/components/EventArtwork.svelte`, `src/routes/mcp/+page.svelte`
- Browser checks: render the real components in English and Spanish at desktop and mobile widths; verify both reassurance lines, navigation icon geometry, wrapped labels, Telegram link attributes, and Claude and ChatGPT setup instructions.
- Static check: `bun run paraglide:compile && bun run check`
- Specification validation: `bunx @fission-ai/openspec validate --specs --json`
