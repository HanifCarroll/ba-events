# SEO Strategy for BA Eventos

## Overview

BA Eventos is a conversational application for discovering events in Buenos Aires. The homepage centers on chat-based discovery, with public pages for sharing individual events.

### Key Architectural Considerations

- **Public discovery page**: The main `/` route presents broad event discovery
- **Shareable event URLs**: `/events/:id` pages provide event-specific metadata
- **Auth-gated content**: `/saved`, `/profile` require login
- **Bilingual**: English and Spanish support via Paraglide

---

## Recommendations by Priority

### Critical Priority

#### 1. Landing Page Optimization
**Why**: The homepage IS the product - it needs to clearly communicate value to both users and search engines.

**Implementation**:
- Add compelling H1 headline describing the service
- Include static content explaining what users can do
- Add example queries/use cases as visible text
- Ensure the chat interface has proper ARIA labels

#### 2. Open Graph & Social Meta Tags
**Why**: When users share "I found this cool event app", the preview needs to be compelling.

**Implementation**:
- og:title, og:description, og:image
- Twitter Card meta tags
- Locale-specific OG tags for EN/ES

#### 3. Core Meta Tags
**Why**: Basic SEO hygiene for the pages that exist.

**Implementation**:
- Unique title tags per route
- Meta descriptions
- Viewport and charset (likely already present)

---

### High Priority

#### 4. robots.txt Improvements
**Why**: Prevent crawling of auth pages, API routes, and admin section.

**Implementation**:
```
User-agent: *
Allow: /
Disallow: /admin/
Disallow: /saved
Disallow: /profile
Disallow: /api/
Disallow: /login
Disallow: /register
```

#### 5. Hreflang Tags
**Why**: You have EN/ES - tell Google which version to show to which users.

**Implementation**:
- Add `<link rel="alternate" hreflang="en" href="...">` tags
- Add `<link rel="alternate" hreflang="es" href="...">` tags
- Add x-default pointing to English or a language selector

#### 6. PWA Manifest & Favicons
**Why**: Improves perceived legitimacy and enables "Add to Home Screen".

**Implementation**:
- Create proper manifest.json
- Add various icon sizes
- Theme color matching your design

---

### Medium Priority

#### 7. Performance & Core Web Vitals
**Why**: Google uses these as ranking signals.

**Implementation**:
- Measure LCP, FID, CLS
- Optimize initial chat interface load
- Consider skeleton loading states

#### 8. Organization Schema (JSON-LD)
**Why**: Helps establish brand identity in search results.

**Implementation**:
```json
{
  "@context": "https://schema.org",
  "@type": "WebApplication",
  "name": "BA Eventos",
  "description": "AI-powered event discovery for Buenos Aires",
  "applicationCategory": "EventApplication",
  "operatingSystem": "Web",
  "availableLanguage": ["en", "es"]
}
```

#### 9. Canonical URLs
**Why**: Prevents duplicate content issues between language versions.

**Implementation**:
- Add `<link rel="canonical">` to each page
- Ensure consistency across EN/ES versions

---

### Lower Priority (Future Considerations)

#### 10. Content Marketing Pages
**Why**: Create indexable content that can rank for event-related queries.

**Ideas**:
- `/about` - About the service
- `/guide/nightlife` - Static guide content
- `/neighborhoods/palermo` - Neighborhood event guides

#### 11. Blog or Event Highlights
**Why**: Fresh content signals and long-tail keyword opportunities.

**Ideas**:
- Weekly "What's On" summaries
- Neighborhood spotlights
- Seasonal event roundups

#### 12. Shareable Event Links
Implemented at `/events/:id` with event-specific Open Graph metadata.

---

## Technical Implementation Notes

### Current Route Structure
```
/                 - Chat interface (indexable)
/events/:id       - Public event detail (indexable)
/saved            - Saved events (noindex)
/profile          - User settings (noindex)
/login            - Auth (noindex)
/register         - Auth (noindex)
/admin/*          - Admin section (noindex)
/auth/callback    - OAuth (noindex)
```

### Meta Tag Implementation Location
Default metadata lives in `src/routes/+layout.svelte`; event-specific metadata lives in `src/routes/events/[id]/+page.svelte`.

### Language Detection
Current implementation uses Paraglide's `getLocale()`. Ensure URL structure or headers communicate language to crawlers.

---

## Progress Tracker

### Critical Priority
- [x] Landing page static content and H1
- [x] Open Graph meta tags
- [x] Twitter Card meta tags
- [x] Core meta tags (title, description)

### High Priority
- [x] robots.txt configuration
- [ ] Hreflang implementation (deferred)
- [x] PWA manifest
- [ ] Favicon set (uses existing)

### Medium Priority
- [ ] Core Web Vitals audit
- [ ] Performance optimizations
- [ ] Organization schema (JSON-LD)
- [x] Canonical URLs

### Lower Priority
- [ ] About page
- [ ] Static guide content
- [ ] Blog/highlights section
- [x] Shareable event links feature

---

## Implementation Notes

### Date: 2024-12-30
**Item**: Core SEO Implementation (Phase 1)
**Changes Made**:
- Added Open Graph tags (og:type, og:site_name, og:title, og:description, og:image, og:url, og:locale) to `__root.tsx`
- Added Twitter Card tags (summary_large_image) to `__root.tsx`
- Added canonical URL link tag
- Created 1200x630px OG image (`public/og-image.png`) with Buenos Aires nightlife theme (superseded in 2026)
- Updated `public/robots.txt` to block /admin/, /saved, /profile, /api/, /login, /register, /auth/
- Updated `public/manifest.json` with BA Eventos branding; theme colors aligned to the light UI (#fafaf8, matching the `theme-color` meta)
- Added SEO info section to `SuggestedPrompts.tsx` with H2 heading and descriptive text
- Added i18n keys for EN/ES (home_about_title, home_about_text)
- SEO section styled to be subtle (muted-foreground/50) so it doesn't compete with main UI

**Notes**:
- OG image generated using Playwright to render HTML template to PNG
- Hreflang deferred as it requires URL-based language routing (current setup uses cookies/headers)

### Date: 2026-08-20
**Item**: Open Graph Image and Positioning Refresh

**Changes Made**:
- Replaced the nightlife-focused image with `static/og-image-2026.jpg`, covering markets, performance, and live music
- Broadened the description from nightlife examples to culture, music, food, markets, and more
- Added image dimensions, type, alt text, and locale-specific Open Graph metadata
- Prevented the default site metadata from competing with event-page metadata
