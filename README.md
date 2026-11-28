# BA Eventos date agenda proof

PR #142 application head: `cf2ed6f13554ce96eec9ee599183945c0716197a`.

Playwright captured the real local app with synthetic events and artwork in Miniflare D1. On both routes the exhibition started on the previous Buenos Aires day and remains under **Hoy** on mobile. Its card reads **En curso · jue, 26 nov · 14:00** at 390 and 1440 CSS pixels.

- [Free agenda desktop](pr142/agenda-gratis-desktop.png)
- [Free agenda mobile](pr142/agenda-gratis-mobile.png)
- [Homepage desktop](pr142/home-desktop.png)
- [Homepage mobile](pr142/home-mobile.png)
- [Free agenda mobile recording](pr142/agenda-gratis-mobile.webm)
- [Homepage mobile recording](pr142/home-mobile.webm)

## Full pages and empty states

The following captures use the same synthetic fixture catalog with dates relative to the new run. Desktop and mobile full-page screenshots include the Spanish introduction, event cards, FAQs, and footer. Each mobile empty-state screenshot shows that route with no events.

| Route | Desktop | Mobile | Mobile empty state |
| --- | --- | --- | --- |
| `/agenda/hoy` | [Desktop](pr142/agenda-hoy-full-desktop.png) | [Mobile](pr142/agenda-hoy-full-mobile.png) | [Empty](pr142/agenda-hoy-empty-mobile.png) |
| `/agenda/fin-de-semana` | [Desktop](pr142/agenda-fin-de-semana-full-desktop.png) | [Mobile](pr142/agenda-fin-de-semana-full-mobile.png) | [Empty](pr142/agenda-fin-de-semana-empty-mobile.png) |
| `/agenda/esta-semana` | [Desktop](pr142/agenda-esta-semana-full-desktop.png) | [Mobile](pr142/agenda-esta-semana-full-mobile.png) | [Empty](pr142/agenda-esta-semana-empty-mobile.png) |
| `/agenda/gratis` | [Desktop](pr142/agenda-gratis-full-desktop.png) | [Mobile](pr142/agenda-gratis-full-mobile.png) | [Empty](pr142/agenda-gratis-empty-mobile.png) |

Privacy: visually inspected all 16 screenshots and grouped every native-resolution video frame by grayscale pixel difference. Reviewed every representative and inspected the scrolled states at full resolution. agenda-gratis-mobile.webm: 195 decoded frames, 6 visually reviewed states; home-mobile.webm: 202 decoded frames, 7 visually reviewed states. No real personal data, secrets, or dev URLs appeared. Both clips played through at 1×. These recordings are silent because the sandbox cannot reach Edge narration.
