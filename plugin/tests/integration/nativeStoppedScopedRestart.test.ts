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
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { nativeOf } from '@/sync/vaultPathLinks'

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
it.each([
  { label: 'publishes an offline deletion with a commit range receipt', withoutHeader: false },
  { label: 'holds an offline deletion for review without a commit range receipt', withoutHeader: true },
])('$label', async ({ withoutHeader }) => {
  const root = await disk.realpath(await disk.mkdtemp(join(tmpdir(), 'sample-stopped-scope-')))
  const server = await v2Server()
  const factory = new IDBFactory()
  const contentReads: string[] = []
  const counted = countedDisk((path) => contentReads.push(path))
  desktopFsPort(counted.port)
  const timers = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] as const
  const previous = timers.map((key) => Object.getOwnPropertyDescriptor(window, key))
  for (const key of timers)
    Object.defineProperty(window, key, { configurable: true, value: globalThis[key] })
  vi.stubGlobal('document', { visibilityState: 'visible' })
  const files = [
    'Sample/Notes/Size.md',
    'Sample/Notes/Time.md',
    'Sample/Notes/Stable.md',
    'Sample/Z-Removed.md',
    ...Array.from({ length: 32 }, (_, i) => `Sample/Old/Child ${i}.md`),
    // Keep the host index at vault scale without uploading unrelated files through this scope.
    ...Array.from({ length: extraFiles }, (_, i) => `Other/Item ${i}.md`),
  ]
  let device: Awaited<ReturnType<typeof nativeTokenFixture>> | undefined
  let restarted: TokenEngines | undefined
  const trustReason = Symbol.for('abele.sync.unchanged-index-reason-v1')
  const prototype = ObsidianFileSystem.prototype as unknown as Record<symbol, (path: string) => string>
  const originalTrustReason = prototype[trustReason]
  const verifyInventory = Symbol.for('abele.sync.verify-inventory-root-v1')
  const originalVerify = Reflect.get(ObsidianFileSystem.prototype, verifyInventory) as () => Promise<void>
  let retiredAncestor = false
  const stableReasons: string[] = []
  let commitBaseHeaders = 0
  let directoryReceipts = 0
  let pauseAtDirectories: Promise<void> | undefined
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
    contentReads.length = 0

    const size = files[0], time = files[1], removed = files[3]
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

    const restartFetch: typeof fetch = async (input, init) => {
      const response = await globalThis.fetch(input, init)
      const url = input instanceof Request ? input.url : String(input)
      if (new URL(url).pathname !== '/v2/commit' || !response.headers.has('abele-commit-base'))
        return response
      commitBaseHeaders++
      const operation = JSON.parse(String(init?.body)) as { ops?: Array<{ op: string }> }
      if (operation.ops?.some((op) => op.op === 'move_directory' || op.op === 'mkdir')) {
        directoryReceipts++
        if (directoryReceipts === 2) {
          const runtime = device!.ui.runtimes.get(device!.id)
          if (!runtime) throw new Error('The connection runtime is unavailable')
          pauseAtDirectories = runtime.pause(true)
        }
      }
      if (!withoutHeader) return response
      const headers = new Headers(response.headers)
      headers.delete('abele-commit-base')
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
    }
    let indexClean = withoutHeader
    Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => indexClean })
    restarted = new TokenEngines(
      app as unknown as App, device.ui,
      (reference) => device!.keys.get(reference) ?? null,
      { fetch: restartFetch, indexedDB: factory, fallbackMs: 60000, pollMs: 60000,
        WebSocket: class { constructor() { throw new Error('Fixture uses polling') } } as never },
      'Scripts', { path: `${app.vault.configDir}/plugins/abele/data.json`, arrived: () => {} }
    )
    prototype[trustReason] = function (this: ObsidianFileSystem, path: string) {
      const reason = originalTrustReason.call(this, path)
      if (path === 'Sample/Notes/Stable.md') stableReasons.push(reason)
      return reason
    }
    Reflect.set(ObsidianFileSystem.prototype, verifyInventory, async function (this: ObsidianFileSystem) {
      if (!withoutHeader && !retiredAncestor) {
        retiredAncestor = true
        const before = '.abele-sync/sample-advisory'
        await disk.mkdir(join(root, before), { recursive: true })
        await disk.writeFile(join(root, before, 'sample.md'), 'private sample')
        expect(await nativeOf(app.vault.adapter)!.fileIdentity!(before + '/sample.md')).toBeTruthy()
        await disk.rename(join(root, before), join(root, '.abele-sync/sample-retired'))
      }
      return originalVerify.call(this)
    })
    restarted.start()
    await device.ui.connectionsChanged(() => {})
    if (!withoutHeader) {
      await vi.waitFor(() => {
        if (!device!.ui.activity.value[device!.id]?.indexWaiting)
          throw new Error('Waiting for the host index')
      }, { timeout: 30000, interval: 20 })
    }
    // A settled host may announce an already indexed scope folder during startup.
    app.emit('vault', 'create', app.vault.getAbstractFileByPath('Sample'))
    await new Promise((resolve) => setTimeout(resolve, 350))
    const firstSync = device.ui.sync(device.id)
    if (!withoutHeader) {
      await new Promise((resolve) => setTimeout(resolve, 10500))
      expect(device.ui.activity.value[device.id]?.indexWaiting).toBe(true)
      expect(device.ui.rows.value.find((one) => one.id === device!.id)?.status).not.toBe('error')
      indexClean = true
      app.emit('metadataCache', 'resolved')
    }
    await vi.waitFor(() => {
      if (!pauseAtDirectories) throw new Error('Waiting for directory receipts')
    }, { timeout: 30000, interval: 20 })
    await pauseAtDirectories
    await firstSync
    await device.ui.runtimes.get(device.id)!.pause(false)
    await device.ui.sync(device.id)
    await vi.waitFor(() => {
      const row = device!.ui.rows.value.find((one) => one.id === device!.id)
      if (row?.status !== 'idle') throw new Error('Waiting for the restarted sync')
    }, { timeout: 120000, interval: 50 })
    const live = await livePaths(user.token)
    expect(stableReasons.length).toBeGreaterThan(0)
    expect(stableReasons).not.toContain('pending-event')
    expect(directoryReceipts).toBeGreaterThanOrEqual(2)
    if (!withoutHeader) expect(retiredAncestor).toBe(true)
    if (withoutHeader) {
      expect(commitBaseHeaders).toBeGreaterThan(0)
      expect(device.ui.activity.value[device.id]?.reconciliation?.phase).toBe('review')
      expect(live.has(removed)).toBe(true)
    } else {
      expect(commitBaseHeaders).toBeGreaterThan(0)
      expect(device.ui.activity.value[device.id]?.reconciliation?.phase).not.toBe('review')
      expect(contentReads.filter((path) => path.endsWith('/Sample/Notes/Stable.md'))).toHaveLength(0)
      expect(live.has(removed)).toBe(false)
    }
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
    prototype[trustReason] = originalTrustReason
    Reflect.set(ObsidianFileSystem.prototype, verifyInventory, originalVerify)
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
