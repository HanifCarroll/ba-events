# Copy for the BA Eventos Instagram formats

Hermes wrote this text and Hanif's rules apply to it. Commit it word for word. Change a line only when the code shows it's untrue, and say which line in the PR. Placeholders are in `{braces}`.

## Shared pieces

- **Weekday and month names** are Spanish. A weekday is capitalized at the start of a kicker or a caption line ("Viernes 20"). Month names are always lowercase ("20 al 22 de noviembre").
- **Number words** for counts at the start of a sentence: Dos, Tres, Cuatro, Cinco, Seis, Siete, Ocho. In English: Two, Three, Four, Five, Six, Seven, Eight. For headlines that begin with a count, use the digit ("6 planes independientes para este finde"), since a digit reads faster on a cover.
- **Kicker on event cards and frames:** "{Weekday} {d} · {time}" (carousels and the Reel) and "Hoy · {time}" (Hoy). Kickers are set in caps by CSS, not typed in caps.
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
  - Headline: "¿Cuál te falta?"
  - Body (Este finde): "Contanos en los comentarios y guardá el post para el finde."
  - Body (Gratis): "Contanos en los comentarios y guardá el post para la semana."
  - Line above the button: "Todos los planes, gratis y sin registrarte:"
  - Button: "baeventos.com"
  - Footer: "Link en la bio"
- **The English caption line is removed** from every format. Instagram is Spanish only.

## 1. Hoy (a story every day, 1080 × 1920 frames)

**Cover frame**
- Kicker: "Hoy · {Weekday} {d} de {mes}"
- Headline: "{N} planes para esta noche"
- Footer: "baeventos.com"

**One frame per event**
- Counter: "{i}/{N}"
- Kicker: "Hoy · {time}"
- Title
- Description line (the shared rule; none when the first sentence is over 90 characters)
- Venue name
- Barrio
- Price pill
- Footer: "@{handle}" (or "Vía @{handle}") on the left and "baeventos.com" on the right

**Closing frame**
- Headline: "Más planes para hoy"
- Body: "Buscá por día, barrio o presupuesto en baeventos.com. Gratis y sin registrarte."
- Footer: "baeventos.com"

Stories have no caption.

## 2. Este finde (a carousel every Thursday, 1080 × 1350)

**Cover**
- Kicker: "{date range Friday to Sunday}"
- Headline: "{N} planes independientes para este finde"
- Footer: "Deslizá →"

**Event cards:** counter, kicker, title, description line, venue, barrio, price pill, footer "@{handle}" (or "Vía @{handle}").

**Closing slide:** the shared closing slide, Este finde body.

**Caption**

```
Qué hacer este finde en Buenos Aires: {N} planes de cultura independiente, {date range}.

{one line per event, with a blank line between events}

Guardá este post para el finde y mandáselo a quien te acompañe.

Más planes en baeventos.com (link en la bio).

#BuenosAires #CulturaIndependiente #AgendaCultural
```

Event lines keep today's form: "{Weekday} {d}, {time}. {Title} en @{handle}, {Barrio}. {Price}." End it at the barrio when there's no price pill. When there's no handle, write the venue name instead of "@{handle}". Prices in the caption read like the pill ("Gratis.", "$15.000.", "A la gorra.").

## 3. Gratis esta semana (a carousel every Monday, 1080 × 1350)

**Cover**
- Kicker: "{date range Monday to Sunday}"
- Headline, on two lines, the first much larger: "Gratis" and "{N} planes esta semana"
- Footer: "Deslizá →"

**Event cards:** the same as Este finde; the pill always reads "Gratis".

**Closing slide:** the shared closing slide, Gratis body.

**Caption**

```
Qué hacer gratis en Buenos Aires esta semana: {N} planes de cultura independiente, {date range}.

{one line per event, with a blank line between events}

Guardá este post para la semana y mandáselo a quien te acompañe.

Más planes en baeventos.com (link en la bio).

#BuenosAires #CulturaIndependiente #EntradaGratis
```

Each event line reads "{Weekday} {d}, {time}. {Title} en @{handle}, {Barrio}." The price is left out, because every event in the post is free.

## 4. Este finde Reel (a Reel every Friday, 1080 × 1920 video)

The Reel shows the same events as that weekend's Este finde carousel.

**Cover card**
- Kicker: "{date range Friday to Sunday}"
- Headline: "{N} planes para este finde en Buenos Aires"

**One card per event**
- Kicker: "{Weekday} {d} · {time}"
- Title
- Venue name
- Barrio and price pill on one line

**Closing card**
- Headline: "Encontrá más planes"
- Button: "baeventos.com"
- Footer: "Link en la bio"

The event cards have no description line, no handle, and no "baeventos.com" footer. The caption carries the handles.

**Caption:** the Este finde caption, word for word, with the track's credit line (when it has one) on its own line after "Más planes en baeventos.com (link en la bio).", before the hashtags, with a blank line on each side. Of the current tracks, only "Intención" by Sapajou (CC BY 3.0) needs a credit.

## Slack preview message (in English, for Hanif)

The message goes to #ba-eventos as a new top-level message, with every frame or slide attached in order:

```
Instagram draft: {Format name} for {dates}. It goes out {Weekday} at {HH:MM} once you react ✅. React ❌ to skip it.

{caption, or "Stories have no caption." for Hoy}
```

Use these format names in the message: "Hoy story", "Este finde carousel", "Gratis esta semana carousel", and "Este finde Reel".

A Reel's preview attaches the video instead of frames, and its message ends with a line naming the track:

```
Music: "{title}" by {artist}.
```

Once the post is published, reply in that message's thread with "Posted: {permalink}". If a draft is skipped, reply with "Skipped: {reason}". Use one of these reasons:
- "you reacted ❌"
- "no ✅ by {HH:MM}"
- "only {n} events qualified"
- "not published by {HH:MM}" (approved, but nothing could go out before the deadline: 19:00 for Hoy, the cutoff for a carousel)

If an event in an approved draft is cancelled before the post goes out, the draft is held, not published, and the thread gets "Held: {title} was cancelled. Ask Hermes to regenerate it."

If an event in the draft is no longer marked in scope, the thread gets "Held: {title} is no longer marked in scope. Ask Hermes to regenerate it."

If an event in the draft has already happened by the time the post would go out (it has ended, or it has started and has no end time), the draft is held the same way, and the thread gets "Held: {title} has already happened. Ask Hermes to regenerate it."

## Threads

Hoy:
```
Hoy en Buenos Aires, {n} planes de cultura independiente:

{HH:MM} · {título} · {venue}, {barrio} · {precio}

Toda la agenda de hoy: baeventos.com
```

Este finde (`{día}` is Vie, Sáb, or Dom):
```
Este finde en Buenos Aires: {n} planes de cultura independiente.

{día} {HH:MM} · {título} · {venue}, {barrio} · {precio}

Horarios, precios y direcciones: baeventos.com
```

Gratis esta semana (`{día}` is Lun, Mar, Mié, Jue, Vie, Sáb, or Dom; no price column):
```
Gratis esta semana en Buenos Aires: {n} planes.

{día} {HH:MM} · {título} · {venue}, {barrio}

Lista completa: baeventos.com
```

Slack preview, appended after the existing preview text:
```
Threads (se publica con el mismo ✅, {HH:MM}):
{the exact Threads text, as a quote block}
```

With auto mode on, use this heading instead: `Threads (se publica solo a las {HH:MM} salvo que reacciones ❌):`.

On an Instagram rebuild after Threads has published, use `Threads ya se publicó con la versión anterior.` instead of the quote. If the send is still unclear, omit the Threads section.

Outcome replies in the original preview's thread:
- `Threads: publicado {permalink}`
- `Threads: omitido, no se publicó antes de las {HH:MM}.`
- `Threads: omitido, reaccionaste ❌.`
- `Threads: retenido, {title} cambió (se canceló, ya pasó o salió de la agenda).`
- `Threads: falló ({short reason}). Hermes lo revisa.`
