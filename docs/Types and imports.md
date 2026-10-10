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
