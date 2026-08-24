import obsidianmd from 'eslint-plugin-obsidianmd'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'
import prettierRecommended from 'eslint-plugin-prettier/recommended'

/**
 * Obsidian ships its own ESLint plugin encoding the rules a plugin must follow to be accepted
 * into the community directory (https://github.com/obsidianmd/eslint-plugin). Its `recommended`
 * preset is the authority here, so it is taken whole rather than cherry-picked.
 *
 * The preset also bundles `typescript-eslint`'s `recommended-type-checked`. Those rules are
 * general TypeScript hygiene, not Obsidian requirements, and this codebase predates them by
 * tens of thousands of lines. The ones that would fire in the hundreds are relaxed at the
 * bottom of this file, each with the reason it was relaxed. Everything under `obsidianmd/`
 * keeps the severity Obsidian gave it.
 */

/** Obsidian's own rules, lifted out of the preset so `.vue` files can be held to them too. */
const obsidianRules = Object.fromEntries(
  obsidianmd.configs.recommended
    .flatMap((entry) => Object.entries(entry.rules ?? {}))
    .filter(([rule]) => rule.startsWith('obsidianmd/'))
)

/**
 * Rules from the bundled `recommended-type-checked` preset that this codebase does not follow.
 * They are switched off rather than left failing so that a real Obsidian violation is never
 * buried under hundreds of pre-existing findings.
 */
const relaxedTypeCheckedRules = {
  // The project deliberately allows `any` at the API and script boundaries.
  '@typescript-eslint/no-explicit-any': 'off',
  '@typescript-eslint/no-unsafe-assignment': 'off',
  '@typescript-eslint/no-unsafe-member-access': 'off',
  '@typescript-eslint/no-unsafe-argument': 'off',
  '@typescript-eslint/no-unsafe-call': 'off',
  '@typescript-eslint/no-unsafe-return': 'off',
  // Fire-and-forget is intentional in event handlers and command callbacks; kept visible.
  '@typescript-eslint/no-floating-promises': 'warn',
  '@typescript-eslint/no-misused-promises': 'warn',
  '@typescript-eslint/unbound-method': 'warn',
  '@typescript-eslint/no-base-to-string': 'warn',
  '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
  '@typescript-eslint/restrict-template-expressions': 'warn',
  '@typescript-eslint/no-empty-object-type': 'warn',
  '@typescript-eslint/no-empty-function': 'off',
  '@typescript-eslint/no-non-null-assertion': 'off',
  '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  // Vite resolves everything into one bundle; devDependencies at build time are expected.
  'import/no-extraneous-dependencies': 'off',
}

export default [
  {
    ignores: [
      'node_modules/**',
      'build/**',
      'dist/**',
      'coverage/**',
      'scripts/**',
      'main.js',
    ],
  },

  ...obsidianmd.configs.recommended,

  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.mjs', '*.mts', '*.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  /**
   * Obsidian's preset only looks at `.ts`. Most of this plugin's UI is Vue, and the rules that
   * matter most there — no hardcoded styles, popout-safe timers and documents, sentence case —
   * apply just as much inside a component. Vue files are parsed with `vue-eslint-parser` and
   * held to the same Obsidian rules.
   */
  // eslint-plugin-vue's flat presets leave their rule blocks unscoped, which would apply Vue
  // rules to `package.json` and crash the JSON parser. Pin every block to `.vue`.
  ...pluginVue.configs['flat/recommended'].map((entry) => ({ ...entry, files: ['**/*.vue'] })),
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: 'latest',
        sourceType: 'module',
        extraFileExtensions: ['.vue'],
      },
    },
    plugins: { obsidianmd: obsidianmd.plugin ?? obsidianmd },
    rules: {
      ...obsidianRules,
      // Needs type information, which is not available for `.vue` single-file components here.
      'obsidianmd/no-unsupported-api': 'off',
      'obsidianmd/no-tfile-tfolder-cast': 'off',
      'obsidianmd/settings-tab/prefer-setting-definitions': 'off',
      'obsidianmd/settings-tab/require-display': 'off',
      'obsidianmd/settings-tab/prefer-update-over-display': 'off',
      'obsidianmd/settings-tab/no-deprecated-display': 'off',
      'obsidianmd/validate-manifest': 'off',
      'obsidianmd/validate-license': 'off',
      'obsidianmd/sample-names': 'off',
      'obsidianmd/no-sample-code': 'off',
      'vue/multi-word-component-names': 'off',
      'vue/no-v-html': 'error',
      // typescript-eslint switches these off for `.ts` because TypeScript already reports
      // them; the same applies inside a component's `<script setup lang="ts">`.
      'no-unused-vars': 'off',
      'no-undef': 'off',
    },
  },

  prettierRecommended,

  {
    files: ['**/*.{ts,tsx,mts,cts,js,mjs,cjs,vue}'],
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      ...relaxedTypeCheckedRules,
      'prettier/prettier': 'warn',
      'vue/multi-word-component-names': 'off',
      // `console.debug` is the plugin's diagnostic channel and is kept deliberately.
      'no-console': ['warn', { allow: ['debug', 'warn', 'error'] }],
    },
  },

  /**
   * Tests drive the plugin from the outside: they build fixtures, reach for `globalThis`, and
   * write UI strings that are assertions rather than user-facing text. Obsidian's UI and
   * runtime rules do not apply to them. This block is last so that it also switches off the
   * type-aware rules re-enabled above — `tsconfig.json` covers `src` only, so those rules have
   * no TypeScript program here and would crash rather than report.
   */
  {
    files: ['tests/**', '*.config.*', 'version-bump.mjs'],
    languageOptions: { parserOptions: { projectService: false, project: false } },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      ...Object.fromEntries(Object.keys(obsidianRules).map((rule) => [rule, 'off'])),
      'no-console': 'off',
    },
  },
]
