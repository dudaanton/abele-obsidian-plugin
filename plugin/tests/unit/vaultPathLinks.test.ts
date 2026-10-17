import { expect, it, vi } from 'vitest'
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import {
  guardedVaultAdapter,
  nativePathMethods,
  ensureVaultDirectory,
  adapterConfigRevision,
} from '@/sync/vaultPathLinks'
import { buildFakeVault } from '../helpers/fakeVault'

it('keeps mobile method identity stable across scans and observes replaced methods', async () => {
  const app = buildFakeVault([])
  const disk = guardedVaultAdapter(app.vault.adapter)
  const stat = disk.stat
  for (let n = 0; n < 100; n++) expect(disk.stat).toBe(stat)
  const replacement = vi.fn(async () => null)
  app.vault.adapter.stat = replacement
  expect(disk.stat).not.toBe(stat)
  await disk.stat('Shared/sample.md')
  expect(replacement).toHaveBeenCalledWith('Shared/sample.md')
})

it('tracks mobile config writes on the underlying adapter without nesting path guards', async () => {
  const app = buildFakeVault([{ path: '.obsidian/seed.json', content: '{}' }])
  const native = vi.fn(() => undefined)
  Object.defineProperty(app.vault.adapter, 'fsPromises', { get: native })
  const disk = guardedVaultAdapter(app.vault.adapter)
  const revision = adapterConfigRevision(disk, '.obsidian')
  native.mockClear()
  await disk.writeBinary('.obsidian/sample.json', new ArrayBuffer(0))
  const guardedProbes = native.mock.calls.length
  native.mockClear()
  await app.vault.adapter.writeBinary('.obsidian/other.json', new ArrayBuffer(0))
  expect(native).not.toHaveBeenCalled()
  expect(guardedProbes).toBeGreaterThan(0)
  expect(revision()).toBe(4)
})

it.each(Object.entries(nativePathMethods))(
  'guards every native path argument to %s',
  async (method, count) => {
    const app = buildFakeVault([])
    const effect = vi.fn(async () => {})
    Object.assign(app.vault.adapter, {
      getFullPath: (p: string) => '/vault/' + p,
      fsPromises: {
        [method]: effect,
        lstat: async (p: string) => ({ isSymbolicLink: () => p === '/vault/Alias' }),
      },
    })
    const raw = Reflect.get(guardedVaultAdapter(app.vault.adapter), 'fsPromises')
    for (let at = 0; at < count; at++) {
      const args = Array.from({ length: count }, (_, n) =>
        n === at ? '/vault/Alias/sample' : '/vault/safe'
      )
      await expect(raw[method](...args)).rejects.toThrow(/symbolic link/i)
    }
    expect(effect).not.toHaveBeenCalled()
  }
)

it('enumerates native filesystem entry points used by sync', () => {
  const found = new Set<string>()
  for (const path of [
    'vaultPathLinks.ts',
    'nativeVaultFs.ts',
    'boundedVaultIo.ts',
    'ObsidianFileSystem.ts',
    'external/pluginSafety.ts',
  ]) {
    const ast = ts.createSourceFile(
      path,
      readFileSync('src/sync/' + path, 'utf8'),
      ts.ScriptTarget.Latest
    )
    const walk = (node: ts.Node) => {
      if (
        ts.isPropertyAccessExpression(node) &&
        (node.expression.getText(ast).endsWith('.fsPromises') ||
          ['fsp', 'fs', 'archiveFs'].includes(node.expression.getText(ast)))
      )
        found.add(node.name.text)
      ts.forEachChild(node, walk)
    }
    walk(ast)
  }
  expect([...found].filter((name) => name !== 'lstat').sort()).toEqual(
    Object.keys(nativePathMethods).sort()
  )
})

it('creates missing staging components nonrecursively and checks them after creation', async () => {
  const app = buildFakeVault([])
  const dirs = new Set(['/vault/.obsidian'])
  const mkdir = vi.fn(async (path: string) => {
    dirs.add(path)
  })
  const lstat = vi.fn(async (path: string) => {
    if (!dirs.has(path)) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    return { isSymbolicLink: () => false, isDirectory: () => true }
  })
  Object.assign(app.vault.adapter, {
    getFullPath: (p: string) => '/vault/' + p,
    fsPromises: { mkdir, lstat },
  })
  await ensureVaultDirectory(app.vault.adapter, '.obsidian/sync-staging/child')
  expect(mkdir.mock.calls).toEqual([
    ['/vault/.obsidian/sync-staging'],
    ['/vault/.obsidian/sync-staging/child'],
  ])
  expect(lstat).toHaveBeenLastCalledWith('/vault/.obsidian/sync-staging/child')
})

it('refuses a link substituted while a missing staging directory is created', async () => {
  const app = buildFakeVault([])
  let created = false
  Object.assign(app.vault.adapter, {
    getFullPath: (p: string) => '/vault/' + p,
    fsPromises: {
      mkdir: async () => {
        created = true
        throw Object.assign(new Error('occupied'), { code: 'EEXIST' })
      },
      lstat: async () => {
        if (!created) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        return { isSymbolicLink: () => true, isDirectory: () => false }
      },
    },
  })
  await expect(ensureVaultDirectory(app.vault.adapter, 'sync-staging')).rejects.toThrow(
    /real directory/
  )
})
