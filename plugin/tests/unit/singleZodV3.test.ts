// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nestedZodCopies, singleZodV3Plugin } from '../../scripts/single-zod-v3.mjs'

let root: string
afterEach(() => rmSync(root, { recursive: true, force: true }))

function fakeRoot(copies: Record<string, string>) {
  root = mkdtempSync(join(tmpdir(), 'abele-zod-'))
  for (const [pkg, version] of Object.entries(copies)) {
    const dir = join(root, 'node_modules/@abele', pkg, 'node_modules/zod')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'zod', version }))
  }
  return root
}

type Resolve = (s: string, i: string | undefined, o: object) => Promise<unknown>
function resolveWith(plugin: { resolveId: unknown }, source: string, importer?: string) {
  const calls: Array<[string, string]> = []
  const ctx = {
    resolve: (s: string, i: string) => {
      calls.push([s, i])
      return Promise.resolve({ id: `${i}::${s}` })
    },
  }
  const result = (plugin.resolveId as Resolve).call(ctx, source, importer, {})
  return { result, calls }
}

describe('single zod 3 for SDK and node packages', () => {
  it('finds every nested copy', () => {
    fakeRoot({ 'sync-sdk': '3.25.76', 'node-protocol': '3.25.76' })
    expect(nestedZodCopies(root)).toEqual([
      join(root, 'node_modules/@abele/node-protocol/node_modules/zod'),
      join(root, 'node_modules/@abele/sync-sdk/node_modules/zod'),
    ])
  })

  it('refuses copies of different versions instead of merging them', () => {
    fakeRoot({ 'sync-sdk': '3.25.76', 'node-protocol': '3.24.0' })
    expect(() => singleZodV3Plugin(root)).toThrow(/differ/)
  })

  it('sends every shared package import of zod, subpaths included, to the first copy', async () => {
    fakeRoot({ 'sync-sdk': '3.25.76', 'node-protocol': '3.25.76' })
    const plugin = singleZodV3Plugin(root)
    const canonical = join(root, 'node_modules/@abele/node-protocol/node_modules/zod/package.json')
    for (const source of ['zod', 'zod/v3']) {
      const { result, calls } = resolveWith(
        plugin,
        source,
        join(root, 'node_modules/@abele/sync-sdk/dist/internal/core/index.js')
      )
      await result
      expect(calls).toEqual([[source, canonical]])
    }
  })

  it('leaves the plugin’s own zod 4 and unrelated imports alone', async () => {
    fakeRoot({ 'sync-sdk': '3.25.76' })
    const plugin = singleZodV3Plugin(root)
    for (const [source, importer] of [
      ['zod', join(root, 'src/comments/model.ts')],
      ['zod', join(root, 'node_modules/@abele/node-protocol/dist/index.js')],
      ['zod-extra', join(root, 'node_modules/@abele/sync-sdk/dist/internal/core/index.js')],
      ['yaml', join(root, 'node_modules/@abele/sync-sdk/dist/internal/core/index.js')],
      ['zod', undefined],
    ] as const) {
      const { result, calls } = resolveWith(plugin, source, importer)
      expect(await result).toBeNull()
      expect(calls).toEqual([])
    }
  })
})
