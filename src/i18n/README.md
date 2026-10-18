# Translations

UI text and AI instructions live together in language-specific JSON files:

```
i18n/
  index.ts
  react.tsx
  locales/
    ja/translation.json
    en/translation.json
```

Japanese (`ja`) is the default, regardless of browser language. Settings → Language
changes the interface immediately and automatically saves `language` in the existing
synced settings. Reader, reading history, and Writer load that preference before
rendering and follow subsequent sync-storage changes without reloading the page.
Existing articles, manuscripts, dictionary definitions, and saved AI reviews retain
their original content. New AI feedback and voice transcription use the selected
language. English pronunciation remains English because it reads the source words.

## JSON sections

- `settings`: the language selector and help text.
- `legacy`: existing dictionary settings messages, preserving their keys.
- `ui`: settings, reading, history, writing, and error messages.
- `dictionary`: dictionary popup actions and PDF/reading launcher messages.
- `prompts`: reading review, writing critique, editing passes, and revision comparison.

Use `t("ui.home")` to read a message and
`t("ui.message_downloading_whisper_model", { p0: percent })` for interpolation.
Placeholders use `{{name}}`; legacy `{{{name}}}` placeholders are also supported.
JSX escapes rendered text. When constructing HTML, escape dynamic values before
passing them to `t`; translation catalogs are trusted application assets.
Do not translate dictionary lookup data, quoted source text, JSON schema field names,
category IDs, storage keys, or model IDs.

Read translated text at render/request time. Components using the locale outside
an already subscribed root can call `useLocale()` from `react.tsx`. Metadata should
use getters rather than evaluating translations at module import time. AI request
functions resolve instructions for every request; review-cache keys include the
locale, so feedback in another language is never reused as a new review.
The legacy AI field `naturalJapanese` keeps its name for history compatibility;
its newly generated content follows the selected language.

## Add a language

1. Copy `locales/en/translation.json` to `locales/<code>/translation.json` and
   translate all string values, including prompts. Preserve keys and placeholders.
2. Import the catalog and register it in `catalogs` in `index.ts`.
3. Add a `locales` entry with its code, native name, text direction (`ltr`/`rtl`),
   and Whisper language name. `Locale` is derived from this list.
4. Extend the `language` settings type in `src/options/types.ts`.
5. Include the new catalog in the key/placeholder parity test and run `npm test`,
   `npx tsc --noEmit`, and `npm run build-chrome`.
6. Check long labels and narrow layouts visually. The language control uses the
   existing Material 3 surface/outline/primary tokens, a visible label and focus
   ring, flexible wrapping, and a minimum 48px interaction target. Adding an RTL
   locale also requires checking directional layouts in all screens.

Unsupported or malformed saved language values fall back to Japanese. Missing
translation keys fall back to the Japanese catalog, then the key itself.

Structure reference: [Karakeep i18n](https://github.com/karakeep-app/karakeep/tree/main/apps/web/lib/i18n).
Design reference: [Material 3 menus](https://m3.material.io/components/menus/guidelines).
