---
name: BA Eventos
description: A quiet conversation-first event concierge for Buenos Aires.
colors:
  canvas: "oklch(0.995 0.002 260)"
  ink: "oklch(0.22 0.025 265)"
  muted-ink: "oklch(0.5 0.025 265)"
  line: "oklch(0.91 0.012 265)"
  soft-surface: "oklch(0.975 0.008 265)"
  action-indigo: "oklch(0.48 0.16 275)"
  assistant-coral: "oklch(0.63 0.22 30)"
typography:
  title:
    fontFamily: "DM Sans, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  body:
    fontFamily: "DM Sans, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.action-indigo}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.sm}"
    padding: "12px 18px"
  composer:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "64px"
---

# Design System: BA Eventos

## Overview

**Creative North Star: “The Quiet Concierge”**

BA Eventos feels like a capable local guide in conversation: calm, specific, and ready to turn an uncertain evening into one clear plan. The interface recedes so the recommendation and its practical facts remain easy to scan. Buenos Aires character appears through the content and the small coral assistant mark, not theatrical decoration.

**Key Characteristics:** generous white space, narrow reading rails, quiet navigation, compact event imagery, and one restrained indigo action.

## Colors

The palette is almost neutral. Indigo marks actions, coral identifies the concierge, and neither becomes a large background field.

**The Two-Accent Rule.** Indigo is interactive; coral is conversational. Do not swap their roles or use either as decoration.

## Typography

DM Sans is the sole interface family. Hierarchy comes from size, weight, and spacing rather than a display-font change.

- **Title** (650, 24px, 1.25): event names and major task headings.
- **Body** (400, 15px, 1.6): conversation and descriptive copy, capped near 68 characters.
- **Label** (500, 13px): metadata, navigation, and secondary actions.

## Layout

Desktop uses a 238px sidebar and a centered conversation rail no wider than 860px. The composer aligns to that rail. Mobile replaces the sidebar with a 64px header and drawer, stacks event imagery above its facts, and keeps all actions at least 44px tall.

## Elevation & Depth

The system is flat by default. Separation comes from whitespace, pale tonal surfaces, and one-pixel rules. Shadows are reserved for temporary overlays.

## Shapes

Message bubbles and the composer use 16px corners. Buttons and navigation states use 8–12px corners. Lists and event details remain unboxed.

## Components

### Buttons

Primary buttons use muted indigo with white text and no shadow. Secondary actions are text or quiet outlines. Focus uses a visible indigo ring.

### Cards / Containers

Recommendations are inline content sections, not floating cards. Event images use 10–12px corners. Alternatives are divided rows.

### Inputs / Fields

The composer is a white 1px outlined surface. Focus changes the stroke and adds a narrow ring, never a glow.

### Navigation

The sidebar is white with a single right divider. The active route uses a pale indigo tint and indigo text. Other items stay plain until hover or focus.

## Do's and Don'ts

### Do:

- **Do** keep the conversation rail narrow enough to read comfortably.
- **Do** show time, place, price, and freshness within the first scan.
- **Do** let real event imagery support the recommendation at modest scale.

### Don't:

- **Don't** use gradients, glow, grain, decorative texture, or theatrical shadows.
- **Don't** turn each piece of metadata into a badge or card.
- **Don't** make event imagery or headings dominate the viewport.
