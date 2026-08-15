# Agent-Native Architecture for BA Events

This document synthesizes principles from the "Agent-native Architectures" article and applies them to the BA Events AI agent to identify improvements that would enhance the product experience.

## Core Principles (from the Article)

### 1. Parity
Whatever the user can do through the UI, the agent should be able to achieve through tools.

### 2. Granularity
Tools should be atomic primitives. Features are outcomes achieved by an agent operating in a loop.

### 3. Composability
With atomic tools and parity, you can create new features just by writing new prompts.

### 4. Emergent Capability
The agent can accomplish things you didn't explicitly design for.

### 5. Improvement Over Time
Agent-native applications get better through accumulated context and prompt refinement.

---

## Current Agent State

The AI agent (the "concierge") now has **8 tools** (consolidated 2026-08-08):

### Core Tools
1. `search_events` - Semantic + filtered event search. The single retrieval surface: "tonight" and "right now" asks map to `timeFilter: "tonight"` / `timeFilter: "now"` (previously dedicated tools, removed to eliminate tool-choice drift)
2. `get_venue_details` - Venue information lookup
3. `get_event_details` - Full event details by ID

### User Action Tools (require auth)
4. `save_event` - Save event to user's list
5. `unsave_event` - Remove event from user's list
6. `list_saved_events` - Show user's saved events (upcoming/past/all)
7. `check_event_saved` - Check if event is already saved

### Directions Tools
8. `get_directions` - Generate Google Maps directions to venue

Removed in the 2026-08-08 consolidation: `get_tonights_events`, `get_happening_now`
(folded into `search_events` timeFilter), `get_event_stats`,
`list_neighborhoods_with_events`, `list_categories_with_events` (analytics, not
recommendations), `share_event` (UI share button owns this; the tool generated
broken links), and `get_user_context` (auth state is now injected into the
system prompt by the chat route).

It uses a **single-search model** (max 2 Claude calls), not a true agent loop.

### Constrained Semantic Retrieval

`search_events` uses **constrained semantic retrieval** behind the tool
interface. Raw natural-language input is canonicalized into a structured
intent (`must` = non-negotiable SQL filters such as free / neighborhood /
venue / named day, `prefer` / `avoid`, and a leftover `semanticQuery`) by
`src/features/chat/api/tools/search-intent.ts`. The must constraints are
enforced as hard SQL filters; the leftover semantic text drives retrieval.

- **must → hybrid**: the constrained filter set narrows candidates in SQL,
  then retrieval is dense + lexical fusion (RRF → fusion to ~50 candidates),
  presented in vector/fused order.
    - **optional LLM rerank** (planned, Phase 8): a later stage for subjective
  fit / composition / negation over the top 20–30 candidates.
- **quality / diversity** (planned, Phase 9): final-stage priors only — they
  never leak into relevance.

The roadmap (`docs/constrained-semantic-retrieval-plan.md`,
[decision](decisions.md)) describes the phases. The former phrase-table
scorer (`vibe-search.ts`) was removed; constrained semantic retrieval is the
only search path (2026-08-14). String matching is limited to alias
canonicalization (free → `isFree`, "Palermo Soho" → `Palermo`, a venue name →
venue ids, a named weekday → a date window); it never ranks.

Every search emits `search:executed` server telemetry with query, filters,
mode, counts, and duration, and `agent:tool_used` reports the REAL tool
success (no longer a
hardcoded `true`).

---

## Parity Gap Analysis

The article's #1 principle: **"Whatever the user can do through the UI, the agent should be able to achieve through tools."**

| User Action (UI) | Agent Can Do? | Tool |
|------------------|---------------|------|
| Search events | ✅ | `search_events` |
| Get venue details | ✅ | `get_venue_details` |
| Save event | ✅ | `save_event` |
| Unsave event | ✅ | `unsave_event` |
| View saved events | ✅ | `list_saved_events` |
| Get full event details | ✅ | `get_event_details` |
| See what's happening now | ✅ | `search_events` (timeFilter: "now") |
| Explore neighborhoods | ✅ | `search_events` (neighborhood filter) |
| Explore categories | ✅ | `search_events` (categories filter) |
| Share event | ✅ | UI share button on event cards (no tool) |
| Get directions | ✅ | `get_directions` |
| Get tickets | Partial | (returns URL in event) |

### CRUD Completeness for User Entities

| Entity | Create | Read | Update | Delete |
|--------|--------|------|--------|--------|
| Saved Events | ✅ `save_event` | ✅ `list_saved_events` | N/A | ✅ `unsave_event` |
| User Preferences | ❌ | ✅ (system prompt injection) | ❌ | ❌ |

---

## Tool Recommendations

### Tier 1: Parity Tools (High Priority)

These close the gap between what users can do and what the agent can do.

#### 1. `save_event`
```typescript
{
  name: 'save_event',
  description: 'Save an event to the user\'s saved events list. Use when user expresses interest ("I want to go", "save that", "bookmark it").',
  input_schema: {
    type: 'object',
    properties: {
      event_id: { type: 'string', description: 'ID of the event to save' }
    },
    required: ['event_id']
  }
}
```
**Compound Benefit:** Enables the agent to act on user intent, not just inform. Users can say "save that" instead of clicking buttons.

#### 2. `unsave_event`
```typescript
{
  name: 'unsave_event',
  description: 'Remove an event from the user\'s saved events list.',
  input_schema: {
    type: 'object',
    properties: {
      event_id: { type: 'string', description: 'ID of the event to remove' }
    },
    required: ['event_id']
  }
}
```

#### 3. `list_saved_events`
```typescript
{
  name: 'list_saved_events',
  description: 'Get the user\'s saved events. Can filter by upcoming vs past. Use when user asks "what did I save?", "my events", "my list".',
  input_schema: {
    type: 'object',
    properties: {
      filter: {
        type: 'string',
        enum: ['upcoming', 'past', 'all'],
        description: 'Filter saved events by time'
      }
    }
  }
}
```
**Compound Benefit:** Enables cross-referencing. "Do I have anything saved for this weekend?" becomes possible.

#### 4. `get_event_details`
```typescript
{
  name: 'get_event_details',
  description: 'Get complete details about a specific event including full description, images, ticket info. Use when user wants more info about a specific event.',
  input_schema: {
    type: 'object',
    properties: {
      event_id: { type: 'string', description: 'ID of the event' }
    },
    required: ['event_id']
  }
}
```
**Why needed:** Currently the agent can only get event info via search results. If a user says "tell me more about that event" after seeing a card, the agent has to re-search.

---

### Tier 2: Context Tools (High Value)

These let the agent understand state and make better recommendations.

#### 5. `get_user_context`
```typescript
{
  name: 'get_user_context',
  description: 'Get context about the current user: saved events count, preferences, recent activity. Call at start of conversation to personalize recommendations.',
  input_schema: {
    type: 'object',
    properties: {}
  }
}
```
**Returns:**
```json
{
  "is_authenticated": true,
  "saved_events_count": 5,
  "upcoming_saved_count": 3,
  "recent_searches": ["techno palermo", "tango san telmo"],
  "preferred_neighborhoods": ["Palermo", "Villa Crespo"],
  "preferred_categories": ["music", "nightlife"]
}
```
**Compound Benefit:** Enables personalization. "Something like what I usually go to" becomes answerable.

#### 6. `get_happening_now`
```typescript
{
  name: 'get_happening_now',
  description: 'Get events currently in progress right now. Perfect for "what can I do right now?" questions.',
  input_schema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Max events to return' }
    }
  }
}
```
**Why needed:** The DB has `getEventsHappeningNow()` but the agent can't use it. This is high-value for spontaneous users.

#### 7. `get_tonights_events`
```typescript
{
  name: 'get_tonights_events',
  description: 'Get all events happening tonight (6pm-6am). Quick access to the most common query.',
  input_schema: {
    type: 'object',
    properties: {
      category: { type: 'string', description: 'Optional category filter' },
      neighborhood: { type: 'string', description: 'Optional neighborhood filter' }
    }
  }
}
```

---

### Tier 3: Discovery Tools (Emergent Capability)

These enable the agent to answer questions you didn't anticipate.

#### 8. `list_neighborhoods_with_events`
```typescript
{
  name: 'list_neighborhoods_with_events',
  description: 'Get neighborhoods that have events, with event counts. Use when user asks "where\'s the action?" or needs help choosing an area.',
  input_schema: {
    type: 'object',
    properties: {
      time_filter: {
        type: 'string',
        enum: ['tonight', 'tomorrow', 'weekend', 'week'],
        description: 'Time period to check'
      }
    }
  }
}
```
**Compound Benefit:** Enables dynamic discovery. "Where should I go tonight?" can be answered with data, not assumptions.

#### 9. `list_categories_with_events`
```typescript
{
  name: 'list_categories_with_events',
  description: 'Get event categories that have events, with counts. Use when user is undecided or exploring options.',
  input_schema: {
    type: 'object',
    properties: {
      time_filter: { type: 'string' },
      neighborhood: { type: 'string' }
    }
  }
}
```

#### 10. `get_event_stats`
```typescript
{
  name: 'get_event_stats',
  description: 'Get statistics about available events. Useful for giving users a sense of what\'s available.',
  input_schema: {
    type: 'object',
    properties: {}
  }
}
```
**Returns:**
```json
{
  "total_upcoming": 234,
  "tonight": 45,
  "this_weekend": 78,
  "free_events": 34,
  "by_category": { "music": 89, "arts": 45 },
  "by_neighborhood": { "Palermo": 67, "San Telmo": 34 }
}
```

---

### Tier 4: Action Tools (User Agency)

These let the agent take actions on behalf of the user.

#### 11. `share_event`
```typescript
{
  name: 'share_event',
  description: 'Generate a shareable link for an event. Returns a URL the user can send to friends.',
  input_schema: {
    type: 'object',
    properties: {
      event_id: { type: 'string' }
    },
    required: ['event_id']
  }
}
```

#### 12. `get_directions`
```typescript
{
  name: 'get_directions',
  description: 'Generate a Google Maps directions link to the event venue.',
  input_schema: {
    type: 'object',
    properties: {
      event_id: { type: 'string' },
      venue_id: { type: 'string' }
    }
  }
}
```

---

## Implementation Priority Matrix

| Tool | Parity Impact | User Value | Implementation Effort | Priority | Status |
|------|--------------|------------|----------------------|----------|--------|
| `save_event` | High | High | Low | **P0** | ✅ Done |
| `list_saved_events` | High | High | Low | **P0** | ✅ Done |
| `unsave_event` | High | Medium | Low | **P1** | ✅ Done |
| `get_event_details` | High | High | Low | **P0** | ✅ Done |
| `get_user_context` | Medium | High | Medium | **P1** | ✅ Done |
| `get_happening_now` | Medium | High | Low | **P1** | ✅ Done |
| `get_tonights_events` | Low | High | Low | **P2** | ✅ Done |
| `list_neighborhoods_with_events` | Low | Medium | Medium | **P2** | ✅ Done |
| `list_categories_with_events` | Low | Medium | Medium | **P2** | ✅ Done |
| `get_event_stats` | Low | Medium | Low | **P2** | ✅ Done |
| `share_event` | Medium | Medium | Low | **P2** | ✅ Done |
| `get_directions` | Medium | Medium | Low | **P2** | ✅ Done |

**All recommended tools have been implemented! (12/12 = 100%)**

---

## Architecture Recommendations

### 1. Move to True Agent Loop

The current "single search" model (max 2 Claude calls) limits emergent capability. Consider:

```typescript
// Current: Fixed 2-call maximum
// Proposed: Loop until completion signal

while (!done && iterations < maxIterations) {
  const response = await claude.messages.create({ ... });

  if (response.stop_reason === 'end_turn') {
    done = true;
  } else if (response.stop_reason === 'tool_use') {
    const results = await executeTools(response.tool_uses);
    messages.push({ role: 'user', content: results });
  }

  iterations++;
}
```

**Why:** Enables multi-step reasoning. "Find me a techno party tonight, and if I've already saved something similar, show me that instead" requires multiple tool calls.

### 2. Context Injection Pattern

Add context to the system prompt dynamically:

```typescript
const context = await getAgentContext(userId);

const systemPrompt = `
${BASE_PROMPT}

## User Context
- Saved events: ${context.savedCount} (${context.upcomingSavedCount} upcoming)
- Favorite neighborhoods: ${context.preferredNeighborhoods.join(', ')}
- Favorite categories: ${context.preferredCategories.join(', ')}
- Recent searches: ${context.recentSearches.join(', ')}

## Available Events
- Tonight: ${context.stats.tonight} events
- This weekend: ${context.stats.weekend} events
- Most active areas: ${context.topNeighborhoods.join(', ')}
`;
```

### 3. Explicit Completion Signal

Add a `complete` tool for explicit task completion:

```typescript
{
  name: 'complete',
  description: 'Signal that the task is complete. Use when you\'ve fully answered the user\'s question.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'Brief summary of what was accomplished' }
    }
  }
}
```

---

## Example User Journeys (After Implementation)

### Journey 1: "What did I save for this weekend?"
```
User: What did I save for this weekend?
Agent: [calls list_saved_events with filter='upcoming']
Agent: You have 3 events saved for this weekend:
       1. Techno Night at Club X (Saturday 11pm)
       2. Jazz in the Park (Sunday 4pm)
       3. Art Exhibition Opening (Saturday 7pm)
       Want me to help you decide which to prioritize?
```

### Journey 2: "Save that last one"
```
User: Yeah that jazz one sounds good, save it
Agent: [calls save_event with event_id from previous search]
Agent: Done! I saved "Jazz Trio at La Boheme" to your list.
       You now have 4 events saved. Sound good?
```

### Journey 3: "What's happening right now?"
```
User: I'm bored, what can I do right now?
Agent: [calls get_happening_now]
Agent: There are 12 events happening right now! Here's one that matches your
       usual vibe - there's a DJ set at Niceto Club that started 30 minutes ago.
       Want me to show you others?
```

### Journey 4: "Help me plan my weekend"
```
User: Help me plan my weekend
Agent: [calls get_user_context]
Agent: [calls list_saved_events filter='upcoming']
Agent: [calls search_events for weekend]
Agent: I see you already have 2 things saved for this weekend. Let me suggest
       how to fit them together with some new discoveries...
```

---

## Compound Engineering Opportunities

### 1. Create a `context.md` file pattern for the agent
- **Compound Benefit:** The agent accumulates knowledge about user preferences over time, making recommendations better with each interaction. This turns one-time interactions into compounding learning.
- **Implementation:** Medium effort - create user preference storage, inject into system prompt
- **Confidence:** High - this is a proven pattern from the article (Reader app)

### 2. Add explicit completion signaling to the agent loop
- **Compound Benefit:** Enables multi-step reasoning and prevents heuristic completion detection. The agent can handle complex requests like "find events, check my saved list, and suggest what to prioritize."
- **Implementation:** Low effort - add `complete` tool and modify loop logic
- **Confidence:** High - this is explicitly recommended in the article as a best practice

### 3. Implement dynamic capability discovery for categories/neighborhoods
- **Compound Benefit:** The agent can answer questions about what's available without hardcoding knowledge. When you add new categories or expand to new neighborhoods, the agent automatically knows.
- **Implementation:** Low effort - simple aggregation queries exposed as tools
- **Confidence:** Medium - the pattern is from the article but needs validation in this specific context

### 4. Track agent interactions as analytics events to discover latent demand
- **Compound Benefit:** You'll learn what users are asking the agent to do, revealing features you didn't anticipate. This turns user requests into a product roadmap.
- **Implementation:** Low effort - add tracking to tool executions
- **Confidence:** High - this is standard practice and the article emphasizes "discovering, not guessing"

### 5. Create an audit checklist for CRUD completeness on user-facing entities
- **Compound Benefit:** Ensures parity as you add new features. Every new entity automatically gets evaluated for agent tool coverage.
- **Implementation:** Document-only - create checklist in `docs/decisions.md`
- **Confidence:** High - systematic approach that prevents future gaps

---

## References

- Article: "Agent-native Architectures" by Dan Shipper and Claude (Every)
- Key concepts: Parity, Granularity, Composability, Emergent Capability, Improvement Over Time
- Related decision: See `docs/decisions.md` for implementation decisions
