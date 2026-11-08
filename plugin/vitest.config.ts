import { configDefaults, defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import { verifySyncFixture } from './scripts/sync-server-fixture.mjs'
import { missingServerTests } from './scripts/server-test-fixtures.mjs'
import FastSequencer from './scripts/fast-sequencer.mjs'
import { syncPlacementPlugin } from './scripts/sync-placement.mjs'
import { hyperFormulaCataloguePlugin } from './scripts/hyperformula-catalogue.mjs'

const skippedServerTests = missingServerTests()
if (skippedServerTests.length)
  console.log(
    `Skipping ${skippedServerTests.length} server-backed test files: fixture variables absent; run npm run test:server (see docs/Testing.md).`
  )

const fixture = process.env.ABELE_SYNC_DIR ? verifySyncFixture(process.env.ABELE_SYNC_DIR) : null
const missingFixture = path.resolve(__dirname, 'tests/helpers/missingSyncFixture.ts')

// These fixtures keep large vaults, native transfers or IndexedDB histories alive.
// Use Vitest's later, serial project group so a shard never runs several of them
// alongside its ordinary tests. The other shard retains its ordinary worker pool.
const nativeLane = [
  'tests/integration/native*.test.ts',
  'tests/integration/*Scale.test.ts',
  'tests/integration/inspectionCacheQuota.test.ts',
  'tests/integration/syncInventoryTasks.test.ts',
]

/**
 * Fast tier: unit + integration. No running Obsidian required, so this is what CI and the
 * pre-commit hook run. End-to-end tests live in `vitest.e2e.config.ts` and are opt-in.
 */
export default defineConfig({
  plugins: [syncPlacementPlugin(), hyperFormulaCataloguePlugin(), vue()],
  resolve: {
    // An array rather than a map because one entry is a regular expression; the order is the
    // order they are tried in, so the specific names come before the one-character `@`.
    alias: [
      // Server fixtures are explicit clean-archive inputs, never an implicit sibling.
      // Production and pure tests resolve protocol/core from the pinned npm payloads.
      {
        find: '@abele/sync-test-seed',
        replacement: fixture ? `${fixture}/packages/core/tests/helpers/seed.ts` : missingFixture,
      },
      {
        find: '@abele/sync-test-harness',
        replacement: fixture ? `${fixture}/packages/core/tests/helpers/harness.ts` : missingFixture,
      },
      {
        find: '@abele/sync-test-socket',
        replacement: fixture
          ? `${fixture}/packages/core/tests/helpers/serverFetch.ts`
          : missingFixture,
      },
      {
        find: /^@abele\/sync-server\/(.*)\.js$/,
        replacement: fixture ? `${fixture}/packages/server/$1.ts` : missingFixture,
      },
      { find: '@', replacement: path.resolve(__dirname, 'src') },
      {
        find: 'virtual:abele-i18n',
        replacement: path.resolve(__dirname, 'tests/mocks/i18nAssets.ts'),
      },
      // Production code imports the real plugin API; tests get the stand-in so that
      // `instanceof TFile` works against fixtures built by tests/helpers/fakeVault.ts.
      { find: 'obsidian', replacement: path.resolve(__dirname, 'tests/mocks/obsidian.ts') },
      // Production embeds these ESM assets. Unit tests inject module/URL hosts instead of WebGL.
      {
        find: 'virtual:maplibre-assets',
        replacement: path.resolve(__dirname, 'tests/mocks/maplibreAssets.ts'),
      },
      {
        find: 'virtual:abele-changelog',
        replacement: path.resolve(__dirname, 'tests/mocks/changelog.ts'),
      },
    ],
  },
  test: {
    // Inlined so the build's transforms apply: tests run the same sync core and the same
    // HyperFormula, without its function catalogue, that the plugin ships.
    server: { deps: { inline: [/@abele\/sync-sdk/, /hyperformula/] } },
    globals: true,
    // Standalone and paired shard pools have different scheduling pressure. The CLI can
    // override these bounded defaults for a different measured runner quota.
    maxWorkers: process.env.ABELE_FAST_SHARD_PLAN ? 4 : 3,
    ...(process.env.ABELE_FAST_SHARD_PLAN ? { sequence: { sequencer: FastSequencer } } : {}),
    projects: [
      {
        extends: true,
        test: {
          name: 'ordinary',
          // Keep includes on each project: Vite concatenates inherited arrays.
          include: [
            'tests/unit/**/*.test.ts',
            'tests/harness/**/*.test.ts',
            'tests/integration/**/*.test.ts',
            'tests/component/**/*.test.ts',
          ],
          exclude: [...configDefaults.exclude, ...skippedServerTests, ...nativeLane],
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'native',
          include: nativeLane,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
    // Vitest 4 keeps a re-used spy's call history. Each case still starts with fresh calls.
    clearMocks: true,
    environment: 'happy-dom',
    // Skip before collection: these files import server modules unavailable without a fixture.
    exclude: [...configDefaults.exclude, ...skippedServerTests],
    // Fails the test that leaves a delayed settings or chat write behind — see the file.
    setupFiles: ['tests/setup/pendingWrites.ts'],
    reporters: 'default',
    // A stylesheet imported as text (`?raw`) — the PDF page's layers — is text here too, not
    // emptied the way vitest empties stylesheets by default.
    css: { include: [/pdfjs-css/] },
  },
})
