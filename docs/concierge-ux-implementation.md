# Concierge UX Implementation Plan

**Date:** 2026-01-11
**Status:** Planned
**Related:** `docs/decisions.md`

---

## Executive Summary

Transform BA Events from a "search results with AI commentary" experience into a true **conversational concierge** that makes decisions for users, not just presents options.

### The Core Shift

| Current State | Target State |
|---------------|--------------|
| "Here are 5 events matching your query" | "Go here tonight. Trust me." |
| Text response + separate event cards | Unified recommendation cards with integrated commentary |
| User browses and decides | Claude decides, user approves or refines |
| Generic filter chips | Contextual refinement based on current recommendation |
| Conversation ends with a list | Conversation ends with a plan |

---

## Current Architecture Overview

For implementers unfamiliar with the codebase:

- **Framework:** TanStack Start (React 19 + Vite + Nitro)
- **Chat Agent:** `src/features/chat/api/agent.ts` - Claude-powered with streaming SSE responses
- **Chat UI:** `src/routes/-components/chat/` - MessageList, ChatInput, event cards
- **Event Cards:** `src/routes/-components/events/EventCard.tsx` - Current card component
- **Styling:** Tailwind CSS v4 with "Noche Porteña" dark theme (warm amber/gold accents)
- **i18n:** Paraglide JS with English and Spanish locales

The chat flow:
1. User sends message → `ChatContainer.tsx`
2. Server function streams response → `agent.ts`
3. Stream includes `text`, `events`, `suggestions`, `done` events
4. UI renders text + event cards separately

---

## Implementation Phases

### Phase 1: Single Recommendation Mode (Prompt + Minor UI)

**Goal:** Claude recommends ONE event with confidence, not a list.

#### 1.1 System Prompt Changes

Update `src/features/chat/api/agent.ts` `getSystemPrompt()`:

- Default behavior becomes single recommendation
- Only show multiple (2-3 max) when user explicitly asks for "options" or "alternatives"
- Response structure: Lead with the pick, explain why it fits, add practical tips
- Never hedge ("you could also...", "another option...") unless asked
- End with a soft confirmation: "Sound good?" or "Want me to find something else?"

#### 1.2 Reduce Default Limit

In `agent.ts`, change default limit from 5 to 1 for standard queries. Only increase when:
- User asks for "options", "alternatives", "a few choices"
- User is in explicit browsing mode ("what's happening this weekend" without vibe context)

#### 1.3 UI: Highlight Primary Recommendation

When only 1 event is returned, render it differently:
- Larger card (hero-sized)
- Claude's commentary integrated INTO the card, not above it
- More prominent CTA buttons

**Files to modify:**
- `src/features/chat/api/agent.ts` - System prompt, default limit
- `src/routes/-components/events/EventCard.tsx` - Add "hero" variant
- `src/routes/-components/chat/MessageList.tsx` - Detect single event, render hero card

---

### Phase 2: Unified Recommendation Card Component

**Goal:** Replace separate "AI text + card below" with a single integrated unit.

#### 2.1 New Component: `RecommendationCard`

A new component that combines:
- Event details (name, venue, time, price)
- Claude's personalized commentary (why this fits)
- Practical tips (when to arrive, what to expect)
- Action buttons (Save, Get Tickets, Share)
- Contextual refinement options

```
┌─────────────────────────────────────────────────────────┐
│  [🎯 Top Pick]                              [♡] [Share] │
│                                                         │
│  EVENT NAME                                             │
│  Venue Name · Neighborhood · Tonight 9PM                │
│                                                         │
│  "Claude's one-liner about why this fits your vibe     │
│   and what makes it special."                          │
│                                                         │
│  💡 Get there around 10 when it fills up               │
│                                                         │
│  [Free]                          [Get Tickets →]        │
│                                                         │
│  ───────────────────────────────────────────────────── │
│  Not quite right?                                       │
│  [More upscale] [Higher energy] [Different area]        │
└─────────────────────────────────────────────────────────┘
```

#### 2.2 Stream Format Changes

Modify the stream event format to include Claude's commentary per-event:

Current `events` stream event:
```typescript
{ type: 'events', data: EventWithVenue[] }
```

New format option - add commentary to each event:
```typescript
{
  type: 'recommendations',
  data: {
    primary: {
      event: EventWithVenue,
      commentary: string,      // "Perfect for a chill night..."
      tips: string[],          // ["Get there around 10", "Cash only"]
      refinements: string[]    // ["More upscale", "Higher energy"]
    },
    alternatives?: {...}[]     // Only if user asked for options
  }
}
```

This requires Claude to output structured data. Options:
- Use tool output format with structured fields
- Post-process Claude's text to extract commentary
- Add a second lightweight Claude call to structure the response

**Recommendation:** Modify the `search_events` tool response handling to have Claude return structured recommendations, not just describe events in prose.

#### 2.3 Deprecate Separate Text + Cards

Once `RecommendationCard` is working:
- Remove the pattern of "text block above, cards below"
- All event information flows through the unified card
- Claude's conversational text becomes minimal intro/outro only

**Files to create:**
- `src/routes/-components/chat/RecommendationCard.tsx`
- `src/routes/-components/chat/RecommendationList.tsx` (handles 1 vs multiple)

**Files to modify:**
- `src/features/chat/api/agent.ts` - Structured output format
- `src/shared/lib/types.ts` - New recommendation types
- `src/routes/-components/chat/MessageList.tsx` - Render new components

---

### Phase 3: Contextual Refinement System

**Goal:** Replace generic suggestion chips with context-aware refinements based on the current recommendation.

#### 3.1 Dynamic Refinement Generation

Current suggestions are generated in `agent.ts` `generateSuggestions()` based on search parameters. New approach:

Generate refinements based on:
- The specific event recommended (if it's a club, offer "something more chill")
- What the user originally asked for (if they wanted "chill", don't suggest "more chill")
- The event's attributes (neighborhood → "different area", price → "something free")

Refinements should feel like natural follow-ups:
- "Something more upscale"
- "I want to dance"
- "Closer to Palermo"
- "What else is at this venue?"

#### 3.2 Refinement Click Handling

When user clicks a refinement:
- Don't start a new search from scratch
- Send the refinement as a follow-up message in conversation context
- Claude understands "more upscale" means "more upscale than the karaoke bar I just recommended"

#### 3.3 UI: Integrated Refinement Buttons

Refinements appear as part of the `RecommendationCard`, not as a separate row below the conversation:
- Styled as subtle buttons below the card
- 3-4 max, contextually generated
- Include "Tell me more" option that expands card details

**Files to modify:**
- `src/features/chat/api/agent.ts` - New refinement generation logic
- `src/routes/-components/chat/RecommendationCard.tsx` - Render refinement buttons
- `src/routes/-components/chat/ChatContainer.tsx` - Handle refinement clicks as messages

---

### Phase 4: "Your Plan" Decision Endpoint

**Goal:** Conversations should end with a clear decision and actionable plan, not an open-ended list.

#### 4.1 Decision Detection

Detect when user has made a decision:
- Explicit: "I'll go to that one", "Sounds good", "Perfect"
- Implicit: User saves an event, clicks "Get Tickets"
- Time-based: After 2-3 refinements, prompt for decision

#### 4.2 "Your Plan" Card Component

When decision is detected, transform the recommendation into a "plan" view:

```
┌─────────────────────────────────────────────────────────┐
│  ✓ YOUR PLAN FOR TONIGHT                                │
│                                                         │
│  NOCHES DE DESPECHO KARAOKE                            │
│  Bar de Despecho                                        │
│  Palermo · 9:00 PM                                      │
│                                                         │
│  📍 Address with map link                              │
│  💡 Get there around 10 when it fills up               │
│                                                         │
│  [Add to Calendar]  [Share Plan]  [Get Directions]     │
└─────────────────────────────────────────────────────────┘
```

#### 4.3 Share Functionality

The "Share Plan" feature is the viral loop:
- Generates a shareable link/card
- Include event + Claude's recommendation
- Recipients can open in BA Events to discover more

**Files to create:**
- `src/routes/-components/chat/YourPlanCard.tsx`
- Share link generation (may use existing event share pages)

**Files to modify:**
- `src/routes/-components/chat/ChatContainer.tsx` - Decision state management
- `src/features/chat/api/agent.ts` - Decision detection in conversation

---

### Phase 5: Conversational Flow Improvements

**Goal:** The conversation should feel like talking to a knowledgeable friend, not querying a database.

#### 5.1 Opening Interaction

For new users or new conversations, don't show a blank chat with prompts. Instead:

**Option A: Proactive Greeting**
Claude initiates: "Hey! Looking for something to do tonight, or planning ahead for the weekend?"

**Option B: Quick Context Buttons**
Before chat input, show:
```
What are you looking for?
[Tonight] [This Weekend] [Surprise Me]

Who's coming?
[Solo] [Date Night] [Friends] [Group]
```

These pre-populate context without requiring the user to type.

#### 5.2 Memory Within Session

Track within conversation:
- Neighborhoods mentioned/rejected
- Vibes they liked/disliked
- Price sensitivity signals
- Time constraints

Use this context for better refinements. Example:
- User rejected a Palermo spot → don't recommend Palermo again without acknowledging it
- User mentioned "cheap" → weight toward free events

#### 5.3 Conversation Closure

After a decision, Claude should offer natural next steps:
- "Want me to find a place for dinner beforehand?"
- "Need a backup option in case this doesn't work out?"
- "I'll be here if your plans change!"

This keeps the conversation going without being pushy.

**Files to modify:**
- `src/features/chat/api/agent.ts` - System prompt for conversation flow
- `src/routes/-components/chat/SuggestedPrompts.tsx` - Pre-chat context gathering
- `src/routes/-components/chat/ChatContainer.tsx` - Session context tracking

---

## UI/UX Design Specifications

### Visual Hierarchy

1. **Primary Recommendation** - Hero card, prominent, integrated commentary
2. **Alternatives** (if requested) - Smaller cards, less detail visible by default
3. **Refinements** - Subtle buttons, part of recommendation card
4. **Conversation Text** - Minimal, just transitions between recommendations

### Card States

- **Default:** Collapsed view with essential info + Claude's one-liner
- **Expanded:** Full details, description, all tips
- **Selected/Decided:** "Your Plan" treatment with action buttons
- **Saved:** Heart filled, subtle confirmation

### Animation & Feedback

- Cards should animate in smoothly (not just appear)
- Refinement clicks should feel responsive (optimistic UI)
- Transition from recommendation → your plan should feel like a celebration

### Mobile Considerations

- Hero card should be full-width on mobile
- Refinement buttons should be thumb-reachable
- "Your Plan" card should be easy to screenshot/share

---

## Data Model Changes

### New Types

```typescript
interface Recommendation {
  event: EventWithVenue
  commentary: string           // Claude's personalized take
  tips: string[]               // Practical advice
  matchScore?: number          // How well it matches the query
  refinements: RefinementOption[]
}

interface RefinementOption {
  id: string
  label: string                // "More upscale"
  prompt: string               // Full prompt to send
  icon?: string
}

interface ConversationContext {
  mentionedNeighborhoods: string[]
  rejectedNeighborhoods: string[]
  vibePreferences: string[]
  priceSignals: 'budget' | 'moderate' | 'splurge' | null
  groupType: 'solo' | 'date' | 'friends' | 'group' | null
  decisionMade: boolean
  selectedEvent?: EventWithVenue
}
```

### Stream Event Changes

Add new event types:
- `recommendation` - Single recommendation with structured data
- `decision_prompt` - Prompt user to confirm their choice
- `plan_confirmed` - User has decided, show "Your Plan"

---

## Success Metrics

Track via PostHog:

### Engagement
- **Decisions per session:** How often do users reach "Your Plan" state
- **Refinements used:** Are contextual refinements helpful
- **Messages to decision:** How many exchanges before deciding

### Quality
- **First recommendation acceptance:** % who accept first suggestion
- **Refinement patterns:** What refinements are most common (indicates gaps)
- **Bounce after recommendation:** Do users leave without deciding

### Virality
- **Share rate:** % of "Your Plan" cards shared
- **Share → new user:** Conversion from shared links

---

## Implementation Order

Recommended sequence:

1. **Phase 1** (1-2 days) - Prompt changes for single recommendation mode. Immediate impact, no UI changes.

2. **Phase 2** (3-4 days) - RecommendationCard component. The core UX improvement.

3. **Phase 3** (2-3 days) - Contextual refinements. Makes the conversation feel smarter.

4. **Phase 4** (2-3 days) - "Your Plan" decision endpoint. Completes the user journey.

5. **Phase 5** (2-3 days) - Conversation flow polish. Nice-to-have improvements.

**Total estimate:** 2-3 weeks for full implementation

---

## Open Questions

1. **Structured output approach:** How to get Claude to output structured recommendations? Tool output format vs. post-processing vs. second call?

2. **Fallback for multiple results:** When user explicitly wants options, how many? 3? And should they be ranked or presented equally?

3. **Share implementation:** Use existing event pages or create dedicated share cards?

4. **Calendar integration:** Build native "Add to Calendar" or link to Google Calendar?

5. **Decision persistence:** Store decisions in database for future personalization? Or session-only?

---

## Appendix: Current File Structure

Key files that will be modified:

```
src/
├── features/chat/
│   ├── api/
│   │   └── agent.ts              # System prompt, streaming logic
│   └── lib/
│       └── generate-id.ts
├── routes/-components/
│   ├── chat/
│   │   ├── ChatContainer.tsx     # Main chat state management
│   │   ├── ChatInput.tsx         # Input component
│   │   ├── MessageList.tsx       # Renders messages + events
│   │   └── SuggestedPrompts.tsx  # Initial prompt cards
│   └── events/
│       ├── EventCard.tsx         # Current event card
│       └── EventCardList.tsx     # List of cards
├── shared/lib/
│   └── types.ts                  # TypeScript types
└── paraglide/                    # i18n (auto-generated)

messages/
├── en.json                       # English translations
└── es.json                       # Spanish translations
```
