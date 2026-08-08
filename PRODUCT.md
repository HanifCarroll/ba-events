# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary users are people in Buenos Aires deciding what to do soon: tonight, this weekend, or around a particular neighborhood, music style, price, or social mood. Visitors who need an easy way to understand the city's event options are a secondary audience. The locals-first priority is inferred from the Spanish-first interface, neighborhood-level search, and the project's focus on fragmented local event information.

## Product Purpose

BA Eventos helps a person turn a loose intent into a confident plan. It consolidates events that are otherwise scattered across ticketing sites, venue pages, social channels, and word of mouth, then lets people ask naturally for recommendations, inspect the result, explicitly make it their plan, and save it for later.

Success means the user can move from “I want to do something” to a specific, relevant event without manually searching many sources.

## Positioning

BA Eventos combines a current, consolidated Buenos Aires event database with conversational search across dates, neighborhoods, categories, prices, and vibes. Its value is not a generic event directory or an open-ended chatbot; it is a city-aware concierge that narrows fragmented choices into a plan.

## Operating Context

People often use the product close to the moment of action, on desktop or mobile, with partial intent such as “something romantic,” “free this weekend,” or “underground techno tonight.” The product supports Spanish and English, anonymous ephemeral chat, authenticated saved events, and explicit plan confirmation.

## Capabilities and Constraints

- Conversational event discovery with streaming responses.
- Semantic and structured search by date, category, neighborhood, price, and vibe.
- Event and venue detail retrieval.
- Explicit “Make this my plan” confirmation; plans are never inferred automatically.
- Saved events and durable plans for authenticated users.
- Spanish-first bilingual experience.
- Current event coverage depends on imported and curated source data; the interface must not imply complete coverage.

## Brand Commitments

- Product name: BA Eventos.
- Buenos Aires is the cultural subject, not generic nightlife.
- The current product describes itself as an AI guide to hidden gems and memorable experiences, but the useful promise is finding a relevant real-world plan.
- The incumbent “Noche Porteña” implementation uses warm noir, amber or red accents, display typography, grain, and subtle glow. These are existing visual traits, not a confirmed requirement for a redesign.

## Evidence on Hand

- Product requirements: `docs/prd.md`.
- Current concierge rules: `docs/concierge-ux-implementation.md`.
- Public home and chat surface: `src/routes/index.tsx` and `src/routes/-components/chat/ChatContainer.tsx`.
- Event recommendation and plan components under `src/routes/-components/events/` and `src/routes/-components/chat/`.
- Spanish and English product copy under `messages/`.
- The live public screen was reviewed at `https://baeventos.com/` on 2026-08-08.
- No customer testimonials, coverage guarantees, usage benchmarks, or commercial claims are available and none should be invented.

## Product Principles

- Start from intent, not taxonomy.
- Reduce choice to a confident next step.
- Make time, place, price, and source confidence visible.
- Keep the city specific and culturally credible.
- Let users explicitly choose and save a plan.

## Accessibility & Inclusion

The interface must remain usable in Spanish and English, support keyboard navigation, preserve readable contrast and type sizes, and work responsively on mobile and desktop.
