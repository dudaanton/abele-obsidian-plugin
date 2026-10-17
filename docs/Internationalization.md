# UI translations

The UI language follows Obsidian's public `getLanguage()` API at plugin load. Supported
languages are English, Russian, Latvian, Spanish and German; supported regional variants
use the base dictionary and retain their canonical region for formatting. Unsupported or
malformed host values use English. Obsidian's language reload is the update boundary.

The initial pilot covers Settings navigation and shared control defaults. Feature-specific
labels in other screens remain English until their area is migrated. User documentation is
English; the translated Settings frame says so. Stored text, IDs, protocols, prompts, tool
descriptions and agent reference documentation do not depend on the UI language.

## Translating a surface

Use `t('semantic.key')` from `src/i18n` in plain TypeScript, or `useI18n()` in Vue setup.
Keys and required named parameters derive from the English catalog. Cardinal messages use
a form object with `other`, plus the categories of each language's `Intl.PluralRules`.
`count` is numeric. Translate whole messages rather than joining translated fragments.
Bindings remain text; never render a translation as HTML.

Keep English wording and punctuation unchanged during extraction. Put all four translations
beside English in the same area change. Catalog tests check keys, placeholders and cardinal
forms. `english-ledger.json` records source hashes and semantic context: update it only after
reviewing the corresponding translations when English changes. `glossary.json` records short
terminology references, their upstream revision and source keys. Product terms are separate.

Do not translate eagerly at module scope. Vue hoists `withDefaults` arguments: a translated
string default must be a factory such as `label: () => t('kit.details')`. Label maps belong in
setup or a factory; stable IDs must remain independent of their displayed labels. Caller
props and saved user content are never automatically translated by shared controls.

Missing messages fall back as a whole to English, including English plural selection.
Development reports a missing locale/key once without substitution values; an unknown
English key produces a visible key marker. Completeness tests make fallback a resilience
measure rather than a substitute for translation.

Formatting helpers cache `Intl` instances by canonical locale and sorted options. Pass
`currentLocale().format` and the existing currency, precision and timezone explicitly.
`formatDate` represents an invalid date with an em dash; `formatNumber` avoids rounded
negative zero. Existing feature formatting has not been changed by the foundation.

## Extraction and regression checks

From `plugin/`, `node scripts/i18n-manifest.mjs` emits JSON candidates with area, file, line,
surface context, literal and hash. The TypeScript and Vue AST scanners cover template prose,
UI attributes and bound literal branches, known label maps/defaults, and imperative
Notice/Menu/Setting/command/DOM sinks. This is a review inventory: indirect messages,
arbitrary helper return values and third-party widgets still need human classification.

`tests/unit/i18nGuard.test.ts` enforces zero presentation literals in the explicit migrated
file list, apart from narrow documented exceptions. A full-source hash/count baseline
ratchets remaining candidates: a changed string, additional occurrence or moved file fails.
Do not blanket-exempt a touched file or regenerate the baseline to accept new UI prose.
Add a file to `migrated.json` when all of its default presentation strings have been extracted.

Development builds initialize the plugin in English so existing behavior tests stay
deterministic. Their test API can set a supported locale or the generated accented `en-XA`
pseudo-locale, then reopen the surface. Restore English in teardown. This does not change
Obsidian's language or persist settings. The pseudo-locale and fixture module are excluded
from production. The localized Settings live test captures desktop and phone emulation
screenshots of the actual viewport, including the top and bottom of the phone navigation.
