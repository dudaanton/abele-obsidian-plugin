import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import path from 'path'

/**
 * Fast tier: unit + integration. No running Obsidian required, so this is what CI and the
 * pre-commit hook run. End-to-end tests live in `vitest.e2e.config.ts` and are opt-in.
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    // An array rather than a map because one entry is a regular expression; the order is the
    // order they are tried in, so the specific names come before the one-character `@`.
    alias: [
      // `tests/helpers/syncServer.ts` runs the real sync server from the sibling repo's
      // sources rather than its build, so the two aliases the core's own vitest config
      // declares have to hold here too: the protocol package, and whatever of the server a
      // test helper imports (written with `.js`, as its ESM sources spell it).
      {
        find: '@abele/sync-protocol',
        replacement: path.resolve(__dirname, '../../abele-sync/packages/protocol/src/index.ts'),
      },
      {
        find: /^@abele\/sync-server\/(.*)\.js$/,
        replacement: `${path.resolve(__dirname, '../../abele-sync/packages/server')}/$1.ts`,
      },
      { find: '@', replacement: path.resolve(__dirname, 'src') },
      // Production code imports the real plugin API; tests get the stand-in so that
      // `instanceof TFile` works against fixtures built by tests/helpers/fakeVault.ts.
      { find: 'obsidian', replacement: path.resolve(__dirname, 'tests/mocks/obsidian.ts') },
      // Production embeds these ESM assets. Unit tests inject module/URL hosts instead of WebGL.
      { find: 'virtual:maplibre-assets', replacement: path.resolve(__dirname, 'tests/mocks/maplibreAssets.ts') },
      { find: 'virtual:abele-changelog', replacement: path.resolve(__dirname, 'tests/mocks/changelog.ts') },
    ],
  },
  test: {
    globals: true,
    // Vitest 4 keeps a re-used spy's call history. Each case still starts with fresh calls.
    clearMocks: true,
    environment: 'happy-dom',
    // Includes the complexity tier: those assertions describe how much work an algorithm may
    // do, they run against the in-memory fake vault in milliseconds, and they are the guard
    // that stops group resolution from silently going quadratic again.
    include: [
      'tests/unit/**/*.test.ts',
      // Test infrastructure has its own home, but remains part of the fast gate.
      'tests/harness/**/*.test.ts',
      'tests/integration/**/*.test.ts',
      // Component tier: Vue components mounted against happy-dom. It computes no layout, so
      // these assert what reaches the DOM and in what order, never how it looks.
      'tests/component/**/*.test.ts',
    ],
    // Fails the test that leaves a delayed settings or chat write behind — see the file.
    setupFiles: ['tests/setup/pendingWrites.ts'],
    reporters: 'default',
    // A stylesheet imported as text (`?raw`) — the PDF page's layers — is text here too, not
    // emptied the way vitest empties stylesheets by default.
    css: { include: [/pdfjs-css/] },
  },
})
