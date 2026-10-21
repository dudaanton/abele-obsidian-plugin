import { expect, it, vi } from 'vitest'
import { applyStaged, ExpectedWrites, MemoryStateStore, scan, sha256 } from '@abele/sync-sdk/core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { ignoreFor } from '@/sync/scope'
import { buildFakeVault } from '../helpers/fakeVault'

const root = '.obsidian/plugins/abele/'
const local = [
  'rewind/sample-chat/b123:3.bin',
  'rewind/sample-chat/log.json',
  'chat-backups/sample.abchat',
  'chat-index.json',
  'chat-index.broken.json',
  'calendars-cache.json',
  'exchange-rates.json',
  'github-users.json',
  'book-places.json',
  'book-places.backup.json',
  'book-bookmarks.backup.json',
  'i18n/fr-1.0.0.json',
  'sync-staging/sample.bin',
  'sync-recovery/sample.bin',
  'future-cache/sample.json',
].map((name) => root + name)
const shared = ['data.json', 'manifest.json', 'main.js', 'styles.css'].map((name) => root + name)

it.each([false, true])(
  'never offers device-local plugin state to the scanner (startup inventory: %s)',
  async (startup) => {
    const app = buildFakeVault([...local, ...shared].map((path) => ({ path, content: 'sample' })))
    const fs = new ObsidianFileSystem(app as never, {
      ...(startup
        ? {
            startupInventory: () =>
              new Map([...local, ...shared].map((path) => [path, { path, size: 6, mtime: 1 }])),
          }
        : {}),
    })
    const listed = []
    for await (const info of fs.list()) listed.push(info.path)
    expect(listed.sort()).toEqual([...shared].sort())
  }
)

it('ignores local state even with negated user rules, preserving the four portable plugin files', () => {
  const ignore = ignoreFor('.obsidian', '!**')
  for (const path of local) {
    expect(ignore.ignores(path), path).toBe(true)
    expect(ignore.ignores(path.toUpperCase()), path).toBe(true)
  }
  expect(ignore.ignores(root + 'rewind/')).toBe(true)
  expect(ignore.ignores(root)).toBe(false)
  for (const path of [...shared, 'Notes/sample.md']) expect(ignore.ignores(path), path).toBe(false)
})

it.each(['delete', 'modify'] as const)(
  'leaves existing local history alone when a server sends %s',
  async (op) => {
    const path = root + 'rewind/sample-chat/log.json'
    const app = buildFakeVault([{ path, content: 'local history' }])
    const fs = new ObsidianFileSystem(app as never)
    const state = new MemoryStateStore()
    const entry = {
      path,
      wirePath: path,
      fileId: 'sample-file',
      versionId: 'sample-version',
      sha: await sha256(new TextEncoder().encode('local history')),
      size: 13,
      mtime: 1,
    }
    await state.put(entry)
    const remote = new TextEncoder().encode('remote history')
    const getBlob = vi.fn().mockResolvedValue(remote)
    const ignore = ignoreFor('.obsidian', null)
    const report = await applyStaged(
      { getBlob } as never,
      fs,
      state,
      [
        {
          seq: 1,
          op,
          path,
          file_id: entry.fileId,
          version_id: 'sample-next',
          sha: op === 'delete' ? null : await sha256(remote),
          size: op === 'delete' ? null : remote.length,
          mtime: 2,
          prev_path: null,
          kind: 'settings',
          at: '2024-01-01T00:00:00Z',
          actor: { kind: 'system', id: 'sample-system', name: 'Sample system' },
        },
      ],
      {
        filter: { excluded: (path) => ignore.ignores(path) },
        dirty: new Set(),
        expected: new ExpectedWrites(),
      }
    )
    expect(report.applied).toBe(0)
    expect(report.skipped).toBe(1)
    expect(getBlob).not.toHaveBeenCalled()
    expect(await app.vault.adapter.read(path)).toBe('local history')
    expect(await state.get(path)).toEqual(entry)
  }
)

it('does not turn previously tracked local state missing from disk into server deletes', async () => {
  const fs = new ObsidianFileSystem(buildFakeVault([]) as never)
  const state = new MemoryStateStore()
  const path = root + 'rewind/sample-chat/log.json'
  await state.put({
    path,
    wirePath: path,
    fileId: 'sample-file',
    versionId: 'sample-version',
    sha: 'a'.repeat(64),
    size: 6,
    mtime: 1,
  })
  const ignore = ignoreFor('.obsidian', null)
  const result = await scan(fs, state, { excluded: (path) => ignore.ignores(path) })
  expect(result.ops).toEqual([])
  expect(await state.get(path)).not.toBeNull()
})
