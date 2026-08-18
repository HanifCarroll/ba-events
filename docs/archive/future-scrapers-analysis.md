# Future Scrapers Analysis

Analysis of potential event sources for future implementation. These were explored via browser automation on 2024-12-29.

---

## Meetup.com

**URL**: `https://www.meetup.com/find/?location=ar--Buenos%20Aires&source=EVENTS`

### Data Available

| Field | Available | Source | Notes |
|-------|-----------|--------|-------|
| Event name | ✅ | DOM/GraphQL | Full title |
| Date/time | ✅ | DOM/GraphQL | With timezone (ART) |
| Venue | ✅ | DOM/GraphQL | Name + address |
| Description | ✅ | Event page | Full description |
| Price | ⚠️ | Event page | Often free, some paid |
| Image | ✅ | DOM/GraphQL | Event cover image |
| Categories | ✅ | DOM/GraphQL | Social Activities, Tech, etc. |
| Attendee count | ✅ | DOM/GraphQL | "26 attendees" |
| Group info | ✅ | DOM/GraphQL | Organizer group + rating |
| Online indicator | ✅ | DOM/GraphQL | "Online" badge |

### Technical Details

- **Architecture**: Next.js with client-side data loading
- **API**: GraphQL (queries fired client-side)
- **Auth**: Not required for public events
- **Rate limiting**: Unknown, likely moderate

### Data Structure (from browser inspection)

```
Events show:
- "Mon, Jan 5, 2026 · 7:00 PM ART"
- "Every Wed • Jan 7, 2026 · 8:30 PM BRT • Online"
- "Sat, Jan 10, 2026 · 3:00 PM ART"

Recurring patterns observed:
- "Every Tue", "Every Wed", "Every Sat"
```

### Categories Observed

- All events
- New Groups
- Social Activities
- Hobbies & Passions
- Sports & Fitness
- Travel & Outdoor
- Career & Business
- Technology
- Community & Environment
- Identity & Language
- Games

### Sample Events Found

1. **Salon Evening: Salt, Meaning, and the Shape of Human Life**
   - Mon, Jan 5, 2026 · 7:00 PM ART
   - Buenos Aires Salon Society
   - 18 attendees

2. **Sketching/Dibujando @ Jardín Botánico**
   - Sat, Jan 10, 2026 · 3:00 PM ART
   - BA Art Outings · 4.7★
   - 42 attendees

3. **Become a confident speaker**
   - Every Wed • Jan 7, 2026 · 8:30 PM BRT • Online
   - The Public Speaking Club (English Edition)
   - 11 attendees

4. **NETWORKING en PALERMO - Compartí y Conectá**
   - Sun, Jan 4, 2026 · 7:00 PM ART
   - Buenos Aires Connect · 4.6★
   - 12 attendees

### Scraping Approach

**Option A: GraphQL API (Recommended)**
- Reverse-engineer the GraphQL queries from network tab
- More stable than DOM scraping
- Returns structured JSON data

**Option B: DOM Scraping**
- Parse rendered HTML
- More fragile, breaks with UI changes
- Simpler to implement initially

### Challenges

1. **GraphQL complexity**: Need to discover query structure
2. **Recurring events**: Need to handle "Every Wed" patterns
3. **Timezone handling**: Events show in ART/BRT
4. **Online filtering**: May want to exclude online-only events

### Unique Value

- Community/social events not on ticketing platforms
- Workshops and classes
- Networking events
- Tech meetups
- Language exchange events
- Free events (many Meetup events are free)

### Priority: MEDIUM

Good source for community events, but GraphQL reverse-engineering adds complexity.

---

## Buenos Aires Tourism (turismo.buenosaires.gob.ar)

**URL**: `https://turismo.buenosaires.gob.ar/es/article/que-hacer-esta-semana`

### Data Available

| Field | Available | Source | Notes |
|-------|-----------|--------|-------|
| Event name | ✅ | HTML | Full title |
| Date/time | ✅ | HTML | Spanish text format |
| Venue | ✅ | HTML | Name + address with links |
| Description | ✅ | HTML | Full description |
| Price | ⚠️ | HTML | Sometimes mentioned, often free |
| Image | ✅ | HTML | Event images |
| Categories | ✅ | HTML | [Danza], [Teatro], [Música], etc. |

### Technical Details

- **Architecture**: Traditional server-rendered (Drupal-based)
- **API**: None discovered
- **JSON-LD**: None
- **Data loading**: Server-side rendered HTML

### Data Structure (from browser inspection)

Events are displayed as cards with:

```html
<div class="event-card">
  <h2>El Cascanueces</h2>
  <span class="category">[Danza]</span>

  <div class="when">
    <strong>¿Cuándo?</strong>
    Martes 23, 20 h. Viernes 26, sábado 27 y domingo 28, 20 h.
  </div>

  <div class="where">
    <strong>¿Dónde?</strong>
    Teatro Colón <a href="...">Cerrito 618</a>, San Nicolás
  </div>

  <p class="description">
    El Ballet Estable del Teatro Colón cierra la Temporada 2025...
  </p>

  <a href="...">Más información</a>
</div>
```

### Categories Observed

- [Danza] - Dance
- [Teatro] - Theatre
- [Música] - Music
- [Evento] - General event
- [Visita guiada] - Guided tour

### Sample Events Found

1. **El Cascanueces** [Danza]
   - Teatro Colón, Cerrito 618, San Nicolás
   - Martes 23, 20 h. Viernes 26, sábado 27 y domingo 28, 20 h.
   - Ballet performance

2. **Mirador Obelisco** [Evento]
   - Obelisco de Buenos Aires, Av. 9 de Julio y Av. Corrientes
   - Todos los días, de 9 a 21 h.
   - 360° experience at the Obelisk

3. **Kiyome y Toque de Campana** [Evento]
   - Jardín Japonés, Av. Berro esquina Av. Casares, Palermo
   - Sábado 27 y domingo 28, de 11 a 18 h.
   - Japanese ceremony for New Year

4. **Una mágica navidad** [Teatro]
   - Teatro Ópera, Av. Corrientes 860, San Nicolás
   - Jueves 25 y viernes 26, 20 h. Sábado 27 y domingo 28, 17 y 20 h.

5. **Candlelight** [Música]
   - Distintos puntos, Ciudad de Buenos Aires, CABA
   - Diciembre
   - Candlelight concerts at various locations

6. **Navegación por el Riachuelo** [Visita guiada]
   - Sturla, Av. Pedro de Mendoza 1630, La Boca
   - Todos los días del año, 10:30, 13, 15 y 17:30 h.

### Date Format Challenges

Spanish text dates require parsing:
- "Martes 23, 20 h." → Tuesday 23rd at 20:00
- "Viernes 26, sábado 27 y domingo 28, 20 h." → Multiple dates
- "Todos los días, de 9 a 21 h." → Daily, 9am-9pm
- "Diciembre" → All of December (vague)

### Scraping Approach

**HTML Scraping with Cheerio**
```typescript
// Pseudo-code
const $ = cheerio.load(html)
$('.event-card').each((i, el) => {
  const name = $(el).find('h2').text()
  const category = $(el).find('.category').text() // [Danza]
  const when = $(el).find('.when').text()
  const where = $(el).find('.where').text()
  const description = $(el).find('.description').text()
})
```

### Challenges

1. **Date parsing**: Complex Spanish text → ISO dates
   - Need NLP or extensive regex patterns
   - "Todos los días" = every day
   - "Sábado 27 y domingo 28" = multiple dates

2. **No stable selectors**: Classes may change

3. **Multi-date events**: Single event with multiple show times

4. **Vague dates**: "Diciembre" without specific times

### Unique Value

- Official city government events
- Cultural events (ballet, theatre, museums)
- Free public events
- Guided tours
- Seasonal/holiday events
- Events at major landmarks (Obelisco, Teatro Colón)

### Priority: LOW-MEDIUM

Valuable for cultural/official events but date parsing complexity is significant.

---

## Comparison Summary

| Aspect | Meetup | BA Tourism |
|--------|--------|------------|
| Data format | GraphQL/JSON | HTML only |
| Date format | ISO-like | Spanish text |
| API available | Yes (GraphQL) | No |
| Scraping difficulty | Medium | Medium-High |
| Unique events | Community/social | Cultural/official |
| Update frequency | Real-time | Weekly |
| Event volume | High | Low-Medium |

## Recommended Implementation Order

1. **Eventbrite** (in progress) - JSON-LD, easy
2. **Meetup** - GraphQL, moderate effort, high value
3. **BA Tourism** - HTML scraping, date parsing complexity

## Notes for Future Implementation

### Meetup GraphQL Discovery

To reverse-engineer Meetup's GraphQL:
1. Open Network tab in DevTools
2. Filter by "graphql" or "gql"
3. Scroll/interact to trigger queries
4. Copy query structure and variables
5. Test in Postman/Insomnia

### BA Tourism Date Parser

Would need a Spanish date parser that handles:
```typescript
parseSpanishDate("Martes 23, 20 h.")
// → { day: 23, time: "20:00" }

parseSpanishDate("Viernes 26, sábado 27 y domingo 28, 20 h.")
// → [{ day: 26 }, { day: 27 }, { day: 28 }], time: "20:00"

parseSpanishDate("Todos los días, de 9 a 21 h.")
// → { recurring: "daily", startTime: "09:00", endTime: "21:00" }
```

Consider using a library like `chrono-node` with Spanish locale, or build custom parser.
