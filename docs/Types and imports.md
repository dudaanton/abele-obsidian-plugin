# Types and imports

## Incremental strict null checks

`npm run types` in `plugin/` runs the existing whole-project TypeScript check and
`scripts/check-strict-null.mjs`. Both production and sharing-test builds run that
same gate. The second pass compiles the **complete** TypeScript program with
`strictNullChecks: true`, but enforces diagnostics only in the folders listed in
`plugin/strict-null-folders.json`. Configuration/global errors are always enforced.
There is no per-error baseline, diagnostic-code whitelist, or source suppression.
Add one folder to that list at a time and fix all of its diagnostics. A nonexistent,
empty, duplicate, or overlapping entry fails the gate.

This is a migration gate, not whole-project strict mode: dependencies outside the
list are still unchecked, and their signatures can still conceal nullability bugs.
Vue templates and scripts are not checked by `tsc`; extending the component check
is a separate migration. `npm run types:strict-null` runs just the migration pass.

## Import graph

`npm run check:cycles` reports strongly connected components of synchronous local
runtime imports in TypeScript and Vue scripts, including re-exports. It uses the
already installed TypeScript and Vue compilers: no additional dependency is needed.
Type-only imports (including ones elided by TypeScript) and dynamic imports are
excluded. Vue script setup is compiled so components used only by templates are
not missed. A component in this report is a cyclic group, not a count of all
possible paths through that group; a function-only cycle does not by itself prove
an initialization bug. Recursive Vue renderers can intentionally be cyclic.

The settings modules explicitly import the plugin entry point with `import type`.
Previously these imports were written as value imports, although the current
compiler already elided them. The test keeps this boundary explicit independently
of compiler import-elision settings.

## Migration status

The checked list currently covers 107 TypeScript files in nine folders:
`constants`, `calendars`, `word`, `views`, `analytics`, `services`, `archive`,
`linter`, and `repository`. Persisted settings remain optional for older files;
the defaults have a complete required shape. Legacy image/permission migration
payloads are typed separately from current AI settings. Settings startup rechecks
its nullable plugin after an awaited file-stamp read, so unloading during that
read does not dereference a missing host.

Five runtime cyclic groups were removed by moving shared data/functions into
leaf modules, preserving existing public re-exports:

- Word edit dispatcher, paragraph operations, image operations: `word/textEdits.ts`.
- Finance source and balance reader: `analytics/sources/financeNames.ts`.
- Canvas model, ink and visibility: `canvas/core/inkData.ts`.
- Script view and its host service: `scripting/view/constants.ts`.
- Design catalogue component and mount host: `testing/catalogueShape.ts`.

The whole-source report decreased from ten to five cyclic groups. Remaining:

- **24 modules** around chat/session/storage/comment/delegation, agent and node
  services, tool construction and script execution.
- **37 modules** around `GlobalStore`, entity lists, note helpers, templates,
  script trust, secret storage and settings. In particular, the runtime
  `AbeleConfig` ↔ `GlobalStore` coupling remains; explicit type-only imports of
  `main` do not remove this larger group. `sync/ids.ts` participates as well.
- Recursive run renderers: `AiRunBranch.vue` → `AiRunMessage.vue` →
  `AiSubAgentRun.vue` → `AiRunBranch.vue`.
- Recursive navigation renderers: `ChatNavigationFork.vue` ↔ `ChatNavigationRows.vue`.
- Recursive script UI renderers: `ScriptHtml.vue` ↔ `ScriptNode.vue`.

The three renderer groups express recursive trees; they are not module-level
initialization defects. The two service/store groups need a separate interface
and lifecycle migration rather than cosmetic dynamic imports that change their
synchronous startup contracts. This report does not establish that every entry
point or module evaluation order is safe. Run the graph command for full edges.
Other folders and Vue component type checking remain outside the strict-null gate.
