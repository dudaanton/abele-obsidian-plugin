// @vitest-environment node
import '../helpers/desktopRequire'
import { promises as disk } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import {
  MemoryStateStore,
  SyncEngine,
  selectiveDefaults,
  sha256,
  type EngineClient,
} from '@abele/sync-sdk/core'
import { VaultSettingsSchema } from '@abele/sync-sdk/protocol'
import { expect, it } from 'vitest'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'

function nativeApp(root: string, files: { path: string; content: string; mtime?: number }[] = []) {
  const app = buildFakeVault(files)
  Object.assign(app.vault.adapter, {
    getFullPath: (path: string) => join(root, path),
    fsPromises: disk,
    list: async (path: string) => {
      const rows = await disk.readdir(join(root, path), { withFileTypes: true })
      return {
        files: rows
          .filter((row) => row.isFile())
          .map((row) => [path, row.name].filter(Boolean).join('/')),
        folders: rows
          .filter((row) => row.isDirectory())
          .map((row) => [path, row.name].filter(Boolean).join('/')),
      }
    },
  })
  Object.assign(app.metadataCache, { initialized: false, isCacheClean: () => false })
  return app
}

it.each(['.obsidian/app.json', '.abele-sync-ignore'])(
  'polls external same-size/same-mtime replacements of %s using normal fingerprint identity',
  async (path) => {
    const root = await disk.realpath(await disk.mkdtemp(join(tmpdir(), 'sample-proof-')))
    const app = nativeApp(root)
    const fs = new ObsidianFileSystem(app as never)
    const snapshot = Reflect.get(fs, 'configSnapshot').bind(fs)
    try {
      await disk.mkdir(join(root, dirname(path)), { recursive: true })
      await disk.writeFile(join(root, path), 'first')
      await disk.utimes(join(root, path), 1, 1)
      const before = await snapshot()
      expect(before.has(path)).toBe(true)
      await disk.writeFile(join(root, 'sample-replacement'), 'other')
      await disk.utimes(join(root, 'sample-replacement'), 1, 1)
      await disk.rename(join(root, 'sample-replacement'), join(root, path))
      const after = await snapshot()
      expect(after.get(path)).not.toBe(before.get(path))
      const replaced = after.get(path)
      await disk.writeFile(join(root, path), 'third')
      await disk.utimes(join(root, path), 1, 1)
      expect((await snapshot()).get(path)).not.toBe(replaced)
    } finally {
      await disk.rm(root, { recursive: true, force: true })
    }
  }
)

it('refuses a config snapshot whose object identity changes across its awaited reads', async () => {
  const root = await disk.realpath(await disk.mkdtemp(join(tmpdir(), 'sample-poll-race-')))
  const fs = new ObsidianFileSystem(nativeApp(root) as never)
  let reads = 0
  Object.assign(fs, { fileIdentity: async () => (++reads === 1 ? 'first' : 'replacement') })
  try {
    await disk.mkdir(join(root, '.obsidian'))
    await disk.writeFile(join(root, '.obsidian/app.json'), 'sample')
    await expect(Reflect.get(fs, 'configSnapshot').call(fs)).rejects.toThrow(
      'File changed while polling metadata'
    )
  } finally {
    await disk.rm(root, { recursive: true, force: true })
  }
})

it.each(['.obsidian/app.json', 'Notes/sample.md'])(
  'uploads an external identity-only replacement of %s after settling',
  async (path) => {
    const root = await disk.realpath(await disk.mkdtemp(join(tmpdir(), 'sample-settled-')))
    const timers = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] as const
    const previous = timers.map((key) => Object.getOwnPropertyDescriptor(window, key))
    for (const key of timers)
      Object.defineProperty(window, key, { configurable: true, value: globalThis[key] })
    const state = new MemoryStateStore()
    const app = nativeApp(
      root,
      path.startsWith('Notes/') ? [{ path, content: 'first', mtime: 1000 }] : []
    )
    if (path.startsWith('Notes/'))
      Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => true })
    const fs = new ObsidianFileSystem(app as never, { ledger: state })
    const snapshots: Promise<unknown>[] = []
    const snapshot = Reflect.get(fs, 'configSnapshot').bind(fs)
    Object.assign(fs, {
      configSnapshot: () => {
        const next = snapshot()
        snapshots.push(next)
        return next
      },
    })
    let now = 1000,
      head = 1,
      commits = 0
    const firstSha = await sha256(new TextEncoder().encode('first'))
    const nextSha = await sha256(new TextEncoder().encode('other'))
    const client = {
      state: async () => ({ head_seq: head, settings: VaultSettingsSchema.parse({}), usage: {} }),
      changes: async () => ({ items: [], head_seq: head, next_since: head }),
      subscribe: () => () => {},
      hasBlob: async () => false,
      putBlob: async () => {},
      commitRaw: async () => {
        commits++
        head = 2
        return {
          replayed: false,
          body: {
            head_seq: head,
            results: [
              {
                status: 'applied',
                file_id: 'sample',
                version_id: 'changed',
                path,
                sha: nextSha,
                size: 5,
                mtime: 1000,
                kind: path.endsWith('.md') ? 'note' : 'attachment',
              },
            ],
          },
        }
      },
    } as unknown as EngineClient
    const engine = new SyncEngine({
      fs,
      state,
      client,
      selective: selectiveDefaults(),
      now: () => now,
    })
    try {
      await disk.mkdir(join(root, dirname(path)), { recursive: true })
      await disk.writeFile(join(root, path), 'first')
      await disk.utimes(join(root, path), 1, 1)
      await state.put({
        path,
        wirePath: path,
        fileId: 'sample',
        versionId: 'initial',
        sha: firstSha,
        size: 5,
        mtime: 1000,
      })
      await state.setCursor(1)
      engine.start()
      await Reflect.get(engine, 'running')
      await Promise.all(snapshots)
      await engine.sync()
      expect(commits).toBe(0)
      await disk.writeFile(join(root, 'sample-replacement'), 'other')
      await disk.utimes(join(root, 'sample-replacement'), 1, 1)
      await disk.rename(join(root, 'sample-replacement'), join(root, path))
      if (path.startsWith('.obsidian/')) {
        fs.kick()
        await Promise.all(snapshots)
      } else now += 60000
      await engine.sync()
      expect(commits).toBe(1)
      expect((await state.get(path))?.sha).toBe(nextSha)
    } finally {
      await engine.stop()
      await disk.rm(root, { recursive: true, force: true })
      timers.forEach((key, i) => {
        if (previous[i]) Object.defineProperty(window, key, previous[i]!)
        else Reflect.deleteProperty(window, key)
      })
    }
  }
)
