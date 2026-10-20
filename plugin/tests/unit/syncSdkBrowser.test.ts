// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { assertSdkSourceImports, assertSdkBrowserBundle } from '../../scripts/sync-sdk-browser.mjs'

it.each([
  'import sdk from "@abele/sync-sdk"',
  'export * from "@abele/sync-sdk"',
  'const sdk = import("@abele/sync-sdk")',
  'const sdk = require("@abele/sync-sdk")',
  'type SDK = import("@abele/sync-sdk").Client',
  '<script setup lang="ts">import sdk from "@abele/sync-sdk"</script>',
  'import sdk from "@abele/sync-sdk/node"',
  'import sdk from "@abele/sync-core"',
  'import sdk from "@abele/sync-core/dist/index.js"',
])('rejects a non-browser SDK source import: %s', (source) => {
  expect(() => assertSdkSourceImports(source, 'Sample.vue')).toThrow(/sync SDK import/)
})

it('allows only public browser entry points and ignores ordinary text', () => {
  expect(() =>
    assertSdkSourceImports(
      `
    import { SyncEngine } from '@abele/sync-sdk/core'
    export { encodeAccessToken } from '@abele/sync-sdk/protocol'
    type DateValue = import('@abele/sync-sdk/notes').Dayjs
    const text = '@abele/sync-sdk'
    // import sdk from '@abele/sync-sdk'
  `,
      'Sample.ts'
    )
  ).not.toThrow()
})

it('keeps every plugin source on the public browser-safe SDK subpaths', () => {
  for (const file of readdirSync('src', { recursive: true })
    .map(String)
    .filter((file) => /\.(ts|vue)$/.test(file))) {
    assertSdkSourceImports(readFileSync(resolve('src', file), 'utf8'), file)
  }
})

const sdk = '/sample/node_modules/@abele/sync-sdk/dist/'
const bundle = (id: string) => ({
  main: { type: 'chunk', code: '', modules: { [id]: { renderedLength: 10 } } },
})
it('refuses Node SDK entry points and native SQLite in the emitted graph', () => {
  for (const id of [
    sdk + 'index.js',
    sdk + 'internal/node/index.js',
    '/sample/node_modules/better-sqlite3/lib/index.js',
  ]) {
    expect(() => assertSdkBrowserBundle(bundle(id), () => ({ importedIds: [] }))).toThrow(
      /SDK browser bundle/
    )
  }
})
it.each(['node:fs', 'fs', 'node:sqlite'])('refuses SDK imports of %s', (dependency) => {
  expect(() =>
    assertSdkBrowserBundle(bundle(sdk + 'internal/core/index.js'), () => ({
      importedIds: [dependency],
    }))
  ).toThrow(/SDK browser bundle/)
})
it('allows SDK browser modules and unrelated desktop host imports', () => {
  expect(() =>
    assertSdkBrowserBundle(bundle(sdk + 'notes/index.js'), () => ({ importedIds: ['dayjs'] }))
  ).not.toThrow()
  expect(() =>
    assertSdkBrowserBundle(bundle('/sample/src/sync/desktopTransport.ts'), () => ({
      importedIds: ['node:fs'],
    }))
  ).not.toThrow()
})

it('distinguishes browser dependencies nested under the SDK from SDK entry points', () => {
  expect(() =>
    assertSdkBrowserBundle(
      bundle('/sample/node_modules/@abele/sync-sdk/node_modules/yaml/browser/dist/index.js'),
      () => ({ importedIds: [] })
    )
  ).not.toThrow()
})

it('refuses dynamic Node imports in the SDK dependency graph', () => {
  expect(() =>
    assertSdkBrowserBundle(bundle(sdk + 'internal/core/index.js'), () => ({
      importedIds: [],
      dynamicallyImportedIds: ['node:fs'],
    }))
  ).toThrow(/SDK browser bundle/)
})

it('refuses transitive Node imports reached through an SDK dependency', () => {
  expect(() =>
    assertSdkBrowserBundle(bundle(sdk + 'internal/core/index.js'), (id) => ({
      importedIds: id.startsWith(sdk) ? ['/sample/node_modules/sample/index.js'] : ['node:fs'],
    }))
  ).toThrow(/SDK browser bundle/)
})
