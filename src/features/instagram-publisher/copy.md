# Copy for the BA Eventos Instagram formats

Hermes wrote this text and Hanif's rules apply to it. Commit it word for word. Change a line only when the code shows it's untrue, and say which line in the PR. Placeholders are in `{braces}`.

## Shared pieces

- **Weekday and month names** are Spanish. A weekday is capitalized at the start of a kicker or a caption line ("Viernes 20"). Month names are always lowercase ("20 al 22 de noviembre").
- **Number words** for counts at the start of a sentence: Dos, Tres, Cuatro, Cinco, Seis, Siete, Ocho. In English: Two, Three, Four, Five, Six, Seven, Eight.
- **Date range:**
  - Same month: "{d1} al {d2} de {mes}" ("20 al 22 de noviembre").
  - Across two months: "{d1} de {mes1} al {d2} de {mes2}" ("28 de noviembre al 4 de diciembre").
- **Time:**
  - 24-hour "HH:MM" ("21:00").
  - When the catalog has an end time on the same day: "{HH:MM} a {HH:MM}" ("11:00 a 16:30").
- **Price pill:**
  - "Gratis" when the event is free.
  - The price as the catalog states it, formatted "$15.000" (dot thousands, no decimals), when there's one price.
  - "A la gorra" when the catalog says pay what you want.
  - No pill when the price is unknown.
  - Never print a price range or a guess.
- **Card description:** the first sentence of the catalog's Spanish summary when that sentence is 90 characters or fewer. Otherwise there's no description line.
- **Tag line on a card:** "@{handle}" in the footer, plus a real Instagram tag on the image, using the same handle.
- **When the handle is the posting account, not the venue's own:** don't present it as the venue.
  - Caption line: "{Weekday} {d}, {time}. {Title} en {Venue}, {Barrio}. {Price}. Vía @{handle}." For Gratis, drop the price part: "{Weekday} {d}, {time}. {Title} en {Venue}, {Barrio}. Vía @{handle}."
  - Card and frame footer: "Vía @{handle}" instead of "@{handle}".
- **Closing slide** (carousels):
  - Headline: "Encontrá más planes"
  - Body: "Buscá por día, barrio o presupuesto. Gratis y sin registrarte."
  - Button: "baeventos.com"
  - Footer: "Link en la bio"

## 1. Hoy (a story every day, 1080 × 1920 frames)

**Cover frame**
- Kicker: "{Weekday} {d} de {mes}"
- Headline: "Hoy en Buenos Aires"
- Body: "{N} planes para esta noche."
- Small English line: "Tonight in Buenos Aires: {N_en} independent events."
- Footer: "baeventos.com"

**One frame per event**
- Counter: "{i}/{N}"
- Kicker: "Hoy · {time}"
- Title
- Description line
- Venue name
- Barrio
- Price pill
- Footer: "@{handle}" on the left and "baeventos.com" on the right

**Closing frame**
- Headline: "Más planes para hoy"
- Body: "Buscá por día, barrio o presupuesto en baeventos.com. Gratis y sin registrarte."
- Footer: "baeventos.com"

Stories have no caption.

## 2. Este finde (a carousel every Thursday, 1080 × 1350)

This matches the live post `instagram.com/p/Df2OC_UkRZu/` (`templates/ba-p2/`).

**Cover**
- Kicker: "{date range Friday to Sunday}"
- Headline, on two lines: "Este finde" and "en Buenos Aires"
- Body: "{N} planes independientes para elegir."
- Footer: "baeventos.com" and "Deslizá →"

**Event cards**
- Counter: "{i}/{N}"
- Kicker: "{Weekday} {d} · {time}"
- Title, description line, venue, barrio, and price pill
- Footer: "@{handle}" and "baeventos.com"

**Closing slide:** the shared closing slide above.

**Caption**

```
{N} planes independientes para este finde en Buenos Aires:

{one line per event}

Más planes en baeventos.com (link en la bio).

{N_en} independent events this weekend in Buenos Aires. More at baeventos.com.
```

Each event line reads "{Weekday} {d}, {time}. {Title} en @{handle}, {Barrio}. {Price}." End it at the barrio when there's no price pill. When there's no handle, write the venue name instead of "@{handle}". Prices in the caption read like the pill ("Gratis.", "$15.000.", "A la gorra.").

## 3. Gratis esta semana (a carousel every Monday, 1080 × 1350)

**Cover**
- Kicker: "{date range Monday to Sunday}"
- Headline, on two lines: "Gratis" and "esta semana"
- Body: "{N} planes gratis en Buenos Aires para elegir."
- Footer: "baeventos.com" and "Deslizá →"

**Event cards:** the same as Este finde, and the price pill always reads "Gratis".

**Closing slide:** the shared closing slide above.

**Caption**

```
{N} planes gratis esta semana en Buenos Aires:

{one line per event}

Más planes en baeventos.com (link en la bio).

{N_en} free events this week in Buenos Aires. More at baeventos.com.
```

Each event line reads "{Weekday} {d}, {time}. {Title} en @{handle}, {Barrio}." The price is left out, because every event in the post is free.

## Slack preview message (in English, for Hanif)

The message goes to #ba-eventos as a new top-level message, with every frame or slide attached in order:

```
Instagram draft: {Format name} for {dates}. It goes out {Weekday} at {HH:MM} once you react ✅. React ❌ to skip it.

{caption, or "Stories have no caption." for Hoy}
```

Use these format names in the message: "Hoy story", "Este finde carousel", and "Gratis esta semana carousel".

Once the post is published, reply in that message's thread with "Posted: {permalink}". If a draft is skipped, reply with "Skipped: {reason}". Use one of these reasons:
- "you reacted ❌"
- "no ✅ by {HH:MM}"
- "only {n} events qualified"
