# Component stories

Storybook covers `EventCard`, `EventArtwork`, `ChatMessage`, and `ChatInput` using the real Svelte components and app CSS. Story files live beside their components. Shared, synthetic fixtures live in `.storybook/fixtures.ts`; the three poster images are local SVGs in `.storybook/public/`.

```sh
bun run storybook        # component gallery on port 6006
bun run build:storybook  # static gallery in storybook-static/
bun run test:storybook   # Chromium component tests in Spanish and English
```

All three commands generate Paraglide first. The gallery does not run the application dev server. For browser tests, install Chromium once if it is not already available:

```sh
bunx playwright install chromium
```

Use the globe toolbar to select **Español** or **English**, and the viewport toolbar to review narrow and desktop layouts. The language control uses the generated Paraglide runtime and remounts the story so components that capture locale during initialization update correctly. Known fixture prose is translated too; arbitrary text edited in Controls is preserved.

## Isolation

`.storybook/main.ts` aliases auth, saved-event requests, analytics, and speech recognition to Storybook-only mocks. Navigation and page state use Storybook's SvelteKit mocks. No Supabase credentials or AI requests are needed. Dictation is deliberately unsupported in the fixture browser environment. Mocks reset before each story; signed-in stories explicitly opt into a synthetic user. The mocks apply only to Storybook.

Historical operation-receipt stories exercise compatibility rendering for old saved messages. They do not imply that the current concierge exposes save/unsave tools.

## Tests

`vitest.storybook.config.ts` runs every story twice, with the locale pinned separately to `es` and `en`. Rendering, interaction, and accessibility assertions run in Chromium. This configuration stays separate from the existing Node Vitest and Bun suites. Run all three suites when changing shared component behavior.

Interactions assert visible behavior: input submission, whitespace rejection, multiline and IME handling, Stop, suggestion callbacks, saved-state toggles, and sanitization of assistant Markdown. Artwork stories check local-image loading, intrinsic proportions, and uncropped fitting in a differently shaped container. Event-card stories check links and localized fallback labels.

Accessibility violations fail the browser suite. Stories provide repeatable visual review states; they do not automatically compare screenshot baselines or test complete chat delivery and authentication flows.

## Adding a story

Use typed CSF stories with `satisfies Meta<typeof Component>` and `StoryObj<typeof meta>`. Prefer editable `args` and the shared fixture factories over copied records. Keep dates, images, and service responses deterministic. Use `fn()` for callbacks and assert against accessible roles and names in a `play` function. Assertions should describe user-visible behavior instead of repeating implementation details.

Keep Storybook packages on the same version. The gallery and browser tests share `.storybook/vite.config.ts`, with the same runes and async compiler settings as the app. This separate Vite configuration is required by the current SvelteKit 3 RC: inheriting the full application configuration builds a preview that expects Kit's `__SVELTEKIT_PAYLOAD__` boot global. The isolated gallery has no application boot payload or Cloudflare runtime. The `@storybook/sveltekit` framework still supplies navigation and page-state mocks.

Run builds and checks sequentially. Paraglide generation can replace generated declarations while the Effect diagnostics tool is scanning them; concurrent regeneration can cause a TypeScript project-graph assertion failure.
