/**
 * Obsidian's preset exactly as shipped — what the community directory's automated review runs.
 *
 * `eslint.config.mjs` is this project's own configuration: it relaxes some rules, raises others
 * and records the reasons. That is fine for day-to-day work, but it means a clean local run is
 * no proof the review will pass. This file takes the preset whole, with nothing turned off, so
 * the reviewer's result can be reproduced before submitting rather than discovered afterwards.
 *
 *   cd plugin && npm run lint:review
 *
 * Run from the repository root — the script changes directory for you — because
 * `validate-manifest` and `no-unsupported-api` read `manifest.json` from the working directory
 * and the manifest lives in the root. Run from `plugin/` they find nothing and stay silent.
 *
 * What matters in the output is anything under `eslint-comments/` — the review reports those as
 * **Risks**, because the preset forbids silencing its own rules. The wall of
 * `@typescript-eslint/*` findings below them is the bundled `recommended-type-checked` preset,
 * which the review does not treat as a blocker; see docs/Obsidian compliance.md.
 */
import obsidianmd from 'eslint-plugin-obsidianmd'

export default [
  {
    ignores: ['**/node_modules/**', 'plugin/build/**', 'plugin/main.js'],
  },
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['plugin/*.mjs', 'plugin/*.mts'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
]
