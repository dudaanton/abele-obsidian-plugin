// @vitest-environment node
import { promises as disk } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { IDBFactory } from 'fake-indexeddb'
import { expect, it, vi } from 'vitest'
import type { App } from 'obsidian'
import { AccessClient, V2EngineClient } from '@abele/sync-sdk/core'
import { V2SyncClient } from '@abele/sync-server/tests/helpers/v2SyncClient.js'
import { v2Server } from '@abele/sync-server/tests/helpers/v2Server.js'
import { createUser } from '@abele/sync-server/src/access/tokens.js'
import { desktopFsPort } from '../helpers/desktopRequire'
import { countedDisk, nativeVault } from '../helpers/nativeRestartVault'
import { nativeTokenFixture } from '../helpers/nativeTokenFixture'
import { TokenEngines } from '@/sync/tokenEngines'

const extraFiles = Number(process.env.STOPPED_SCOPE_EXTRA_FILES ?? 0)
async function livePaths(token: string): Promise<Set<string>> {
  const client = new V2SyncClient(token)
  const paths = new Set<string>()
  let next: string | null = null
  do {
    const page = await client.manifest(`?limit=5000${next ? `&next=${encodeURIComponent(next)}` : ''}`)
    for (const item of page.items) if (!item.deleted) paths.add(item.path)
    next = page.next
  } while (next)
  return paths
}
it('publishes an offline deletion beside edits and a folder rename in a settled scoped index', async () => {
  const root = await disk.realpath(await disk.mkdtemp(join(tmpdir(), 'sample-stopped-scope-')))
  const server = await v2Server()
  const factory = new IDBFactory()
  const counted = countedDisk()
  desktopFsPort(counted.port)
  const timers = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] as const
  const previous = timers.map((key) => Object.getOwnPropertyDescriptor(window, key))
  for (const key of timers)
    Object.defineProperty(window, key, { configurable: true, value: globalThis[key] })
  vi.stubGlobal('document', { visibilityState: 'visible' })
  const files = [
    'Sample/Notes/Size.md',
    'Sample/Notes/Time.md',
    'Sample/Z-Removed.md',
    ...Array.from({ length: 32 }, (_, i) => `Sample/Old/Child ${i}.md`),
    ...Array.from({ length: extraFiles }, (_, i) => `Sample/Notes/Item ${i}.md`),
  ]
  let device: Awaited<ReturnType<typeof nativeTokenFixture>> | undefined
  let restarted: TokenEngines | undefined
  try {
    for (const folder of new Set(files.map(dirname)))
      await disk.mkdir(join(root, folder), { recursive: true })
    for (let i = 0; i < files.length; i += 64)
      await Promise.all(files.slice(i, i + 64).map((path) =>
        disk.writeFile(join(root, path), `initial ${path}`)
      ))
    const app = nativeVault(root, counted.port, files)
    const setIndexStat = async (path: string) => {
      const stat = await disk.stat(join(root, path))
      app.vault.getFileByPath(path)!.stat = {
        size: stat.size, mtime: stat.mtimeMs, ctime: stat.birthtimeMs,
      }
    }
    for (let i = 0; i < files.length; i += 64)
      await Promise.all(files.slice(i, i + 64).map(setIndexStat))
    Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => true })
    const user = await createUser(
      { db: server.db, pepper: server.config.tokenPepper }, 'Sample user', server.address
    )
    const client = new V2EngineClient(user.token, { fetch: globalThis.fetch })
    await client.commitRaw([{ op: 'mkdir', path: 'Sample' }], crypto.randomUUID())
    const folder = (await new V2SyncClient(user.token).manifest()).items.find(
      (item) => item.path === 'Sample'
    )!
    const token = (await AccessClient.fromToken(user.token, { fetch: globalThis.fetch }).issue({
      scope: { kind: 'folder', id: folder.file_id }, label: 'sample folder',
    })).token
    device = await nativeTokenFixture(app, token, globalThis.fetch, factory)
    expect((await livePaths(user.token)).has('Sample/Z-Removed.md')).toBe(true)
    await device.host.close()

    const size = files[0], time = files[1], removed = files[2]
    await disk.writeFile(join(root, size), 'a larger replacement with different bytes')
    await app.vault.modify(app.vault.getFileByPath(size)!, 'a larger replacement with different bytes')
    await setIndexStat(size)
    const oldTime = await disk.stat(join(root, time))
    await disk.writeFile(join(root, time), 'same-size replacement'.padEnd(oldTime.size, 'x'))
    await app.vault.modify(app.vault.getFileByPath(time)!, 'same-size replacement'.padEnd(oldTime.size, 'x'))
    await disk.utimes(join(root, time), new Date(oldTime.mtimeMs + 1000), new Date(oldTime.mtimeMs + 1000))
    await setIndexStat(time)
    await disk.mkdir(join(root, 'Sample/New'), { recursive: true })
    await app.vault.createFolder('Sample/New')
    for (const path of ['Sample/Notes/Added.md', 'Sample/New/Child.md']) {
      await disk.writeFile(join(root, path), `added ${path}`)
      await app.vault.create(path, `added ${path}`)
      await setIndexStat(path)
    }
    await disk.rename(join(root, 'Sample/Old'), join(root, 'Sample/Renamed'))
    await app.vault.rename(app.vault.getAbstractFileByPath('Sample/Old')!, 'Sample/Renamed')
    for (let i = 0; i < 32; i++) await setIndexStat(`Sample/Renamed/Child ${i}.md`)
    await disk.unlink(join(root, removed))
    await app.vault.delete(app.vault.getFileByPath(removed)!)

    restarted = new TokenEngines(
      app as unknown as App, device.ui,
      (reference) => device!.keys.get(reference) ?? null,
      { fetch: globalThis.fetch, indexedDB: factory, fallbackMs: 60000, pollMs: 60000,
        WebSocket: class { constructor() { throw new Error('Fixture uses polling') } } as never },
      'Scripts', { path: `${app.vault.configDir}/plugins/abele/data.json`, arrived: () => {} }
    )
    restarted.start()
    await device.ui.connectionsChanged()
    // A settled host may announce an already indexed scope folder during startup.
    app.emit('vault', 'create', app.vault.getAbstractFileByPath('Sample'))
    await new Promise((resolve) => setTimeout(resolve, 350))
    await device.ui.sync(device.id)
    await vi.waitFor(() => {
      const row = device!.ui.rows.value.find((one) => one.id === device!.id)
      if (row?.status !== 'idle') throw new Error('Waiting for the restarted sync')
    }, { timeout: 120000, interval: 50 })
    const live = await livePaths(user.token)
    expect(live.has(removed)).toBe(false)
    expect(await app.vault.adapter.exists(removed)).toBe(false)
    expect(live.has(size)).toBe(true)
    expect(live.has(time)).toBe(true)
    expect(live.has('Sample/Notes/Added.md')).toBe(true)
    expect(live.has('Sample/New/Child.md')).toBe(true)
    for (let i = 0; i < 32; i++) {
      expect(live.has(`Sample/Old/Child ${i}.md`)).toBe(false)
      expect(live.has(`Sample/Renamed/Child ${i}.md`)).toBe(true)
    }
  } finally {
    await restarted?.close()
    await device?.host.close()
    await server.close()
    await disk.rm(root, { recursive: true, force: true })
    timers.forEach((key, i) => {
      if (previous[i]) Object.defineProperty(window, key, previous[i]!)
      else Reflect.deleteProperty(window, key)
    })
    vi.unstubAllGlobals()
  }
}, 180000)
