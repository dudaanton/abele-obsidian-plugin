import { expect, it, vi } from 'vitest'
import { sha256, MemoryFileSystem } from '@abele/sync-sdk/core'
import { ObsidianFileSystem, RETENTION_IDLE } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'

import { scopedFileSystem } from '@/sync/scopedFileSystem'
import { LocalFolderPlacement } from '@/sync/localFolderPlacement'

const root = '.obsidian/plugins/abele/sync-conditional'
const bytes = (s: string) => new TextEncoder().encode(s)
it('does not evict two recently displaced large attachments to meet the soft target', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(100000)
  try {
    const app = buildFakeVault([{ path: 'sample.bin', content: 'before', mtime: 1000 }])
    const disk = new ObsidianFileSystem(app as never)
    const conditional = Reflect.get(disk, 'conditional')
    Reflect.set(conditional, 'retentionBytes', 1)
    await disk.conditionalFile({
      path: 'sample.bin',
      expected: { sha: await sha256(bytes('before')), size: 6, mtime: 1000 },
      effect: { kind: 'write', bytes: bytes('after'), mtime: 2000, receipt: 'older' },
    })
    clock.mockReturnValue(101000)
    await disk.conditionalFile({
      path: 'sample.bin',
      expected: { sha: await sha256(bytes('after')), size: 5, mtime: 2000 },
      effect: { kind: 'write', bytes: bytes('latest'), mtime: 3000, receipt: 'newer' },
    })
    // Charge two 300 MiB attachments without allocating their payloads on the test host.
    const index = Reflect.get(conditional, 'host').retention
    for (const id of ['older', 'newer'])
      await index.put({ ...(await index.find(id)), size: 300 * 1024 * 1024 })
    Reflect.set(conditional, 'retentionBytes', 512 * 1024 * 1024)
    await conditional.maintenanceStep()
    await conditional.maintenanceStep()
    await disk.recoverConditionalFiles()
    expect(await app.vault.adapter.read(root + '/trash/older/victim')).toBe('before')
    expect(await app.vault.adapter.read(root + '/trash/newer/victim')).toBe('after')
    clock.mockReturnValue(100000 + 24 * 3600000 - 1)
    await conditional.maintenanceStep()
    expect(await app.vault.adapter.exists(root + '/trash/older/victim')).toBe(true)
    clock.mockReturnValue(100000 + 24 * 3600000)
    await conditional.maintenanceStep()
    expect(await app.vault.adapter.exists(root + '/trash/older/victim')).toBe(false)
    expect(await app.vault.adapter.read(root + '/trash/newer/victim')).toBe('after')
  } finally {
    clock.mockRestore()
  }
})

it('does constant startup filesystem work with thirty thousand retained entries', async () => {
  const app = buildFakeVault([])
  const disk = new ObsidianFileSystem(app as never)
  const host = Reflect.get(Reflect.get(disk, 'conditional'), 'host')
  const stat = host.stat.bind(host),
    list = host.list.bind(host),
    read = host.read.bind(host)
  const summary = vi.fn(async () => ({
    count: 30000,
    bytes: 30000,
    earliestExpiry: 1,
    migrated: true,
  }))
  host.retention = {
    summary,
    oldest: () => {
      throw new Error('startup opened retention cursor')
    },
  }
  let operations = 0
  host.stat = async (path: string) => {
    if (++operations > 30) throw new Error('startup walked retention')
    return path === root + '/retained' ? { type: 'folder', size: 0, mtime: 0 } : stat(path)
  }
  host.list = async (path: string) => {
    if (++operations > 30) throw new Error('startup walked retention')
    return path === root + '/retained'
      ? {
          files: Array.from({ length: 30000 }, (_, i) => root + '/retained/sample-' + i + '.json'),
          folders: [],
        }
      : list(path)
  }
  host.read = async (path: string) => {
    if (++operations > 30) throw new Error('startup walked retention')
    return path.startsWith(root + '/retained/')
      ? bytes(JSON.stringify({ at: 1, intent: { path: 'sample.bin', expected: null } }))
      : read(path)
  }
  await expect(disk.recoverConditionalFiles()).resolves.toBeUndefined()
  expect(operations).toBeLessThanOrEqual(10)
  expect(summary).toHaveBeenCalledOnce()
})

it('sweeps only on idle ticks and drains a running tick when idle ends', async () => {
  vi.useFakeTimers()
  const disk = new ObsidianFileSystem(buildFakeVault([]) as never)
  try {
    const conditional = Reflect.get(disk, 'conditional')
    vi.spyOn(conditional, 'maintenanceDelay').mockResolvedValue(0)
    let finish!: () => void
    const step = vi.spyOn(conditional, 'maintenanceStep').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    await vi.advanceTimersByTimeAsync(100)
    expect(step).not.toHaveBeenCalled()
    await disk[RETENTION_IDLE](true)
    await vi.advanceTimersByTimeAsync(25)
    expect(step).toHaveBeenCalledOnce()
    const signal: AbortSignal = step.mock.calls[0][1]
    expect(signal.aborted).toBe(false)
    let stopped = false
    const stopping = disk[RETENTION_IDLE](false).then(() => {
      stopped = true
    })
    expect(signal.aborted).toBe(true)
    await Promise.resolve()
    expect(stopped).toBe(false)
    finish()
    await stopping
    await vi.advanceTimersByTimeAsync(100)
    expect(step).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    await disk[RETENTION_IDLE](false)
    vi.useRealTimers()
    vi.restoreAllMocks()
  }
})

it('imports at most eight legacy records per idle tick from a thirty-thousand-record namespace', async () => {
  const disk = new ObsidianFileSystem(buildFakeVault([]) as never)
  const conditional = Reflect.get(disk, 'conditional'),
    host = Reflect.get(conditional, 'host')
  host.stat = host.retirementStat = async () => ({
    type: 'file',
    size: 6,
    mtime: 1000,
    ctime: 1000,
  })
  const list = vi.fn(async () => ({
    files: Array.from({ length: 30000 }, (_, i) => root + '/retained/sample-' + i + '.json'),
    folders: [],
  }))
  const read = vi.fn(async () =>
    bytes(JSON.stringify({ at: 1000, intent: { path: 'sample.bin', expected: null } }))
  )
  host.list = list
  host.read = read
  await conditional.maintenanceStep()
  expect(read).toHaveBeenCalledTimes(8)
  expect(list).toHaveBeenCalledOnce()
  await conditional.maintenanceStep()
  expect(read).toHaveBeenCalledTimes(16)
  expect(list).toHaveBeenCalledOnce()
  expect((await host.retention.summary()).count).toBe(16)
})

it('forwards idle lifecycle through scoped and placed filesystems without exposing paths', async () => {
  const idle = Symbol.for('abele.sync.retention-idle-v1')
  const calls: boolean[] = []
  const disk = Object.assign(new MemoryFileSystem(), {
    async [idle](value: boolean) {
      expect(this).toBe(disk)
      calls.push(value)
    },
  })
  const scoped = scopedFileSystem(
    disk,
    () => {},
    () => true
  )
  const placed = new LocalFolderPlacement('Shared', 'Moved').fileSystem(scoped)
  await Reflect.get(placed, idle).call(placed, true)
  await Reflect.get(placed, idle).call(placed, false)
  expect(calls).toEqual([true, false])
})
