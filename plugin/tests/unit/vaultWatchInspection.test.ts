import { expect, it, vi } from 'vitest'
import { watchVault } from '@/sync/vaultWatcher'
import { buildFakeVault } from '../helpers/fakeVault'
import { deferred } from '../helpers/deferred'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'

it('awaits a fresh settings poll including a kick racing its baseline, and refuses failed coverage', async () => {
  const app = buildFakeVault([])
  let entries = new Map([['.obsidian/sample.json', 'first']])
  let gate: ReturnType<typeof deferred<Map<string, string>>> | undefined
  let failed = false
  const snapshot = vi.fn(async () => {
    if (failed) throw new Error('sample metadata unavailable')
    return gate ? gate.promise : new Map(entries)
  })
  const changed = vi.fn()
  const watch = watchVault(
    {
      app: app as never,
      now: Date.now,
      pollMs: 60000,
      configDir: '.obsidian',
      snapshot,
      onWatch: null,
    },
    changed
  )
  try {
    expect(await watch.inspect()).toBe(true)
    expect(changed).not.toHaveBeenCalled()
    gate = deferred<Map<string, string>>()
    watch.kick()
    const inspected = watch.inspect()
    let settled = false
    void inspected.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    entries = new Map([['.obsidian/sample.json', 'changed externally']])
    const blocked = gate
    gate = undefined
    blocked.resolve(new Map([['.obsidian/sample.json', 'first']]))
    expect(await inspected).toBe(true)
    expect(changed).toHaveBeenCalledExactlyOnceWith(['.obsidian/sample.json'])
    failed = true
    expect(await watch.inspect()).toBe(false)
    expect(changed).toHaveBeenCalledTimes(1)
    failed = false
    gate = deferred<Map<string, string>>()
    const stopped = watch.inspect()
    watch.stop()
    expect(await stopped).toBe(false)
    gate.resolve(entries)
  } finally {
    watch.stop()
  }
})

it('does not report every indexed child when the host announces an existing scoped folder', async () => {
  const app = buildFakeVault(
    Array.from({ length: 33000 }, (_, i) => ({ path: `Sample/Notes/Item ${i}.md` }))
  )
  const changed = vi.fn()
  vi.useFakeTimers()
  const watch = watchVault(
    {
      app: app as never,
      now: Date.now,
      pollMs: 60000,
      configDir: '.obsidian',
      snapshot: async () => new Map(),
      onWatch: null,
    },
    changed
  )
  try {
    app.emit('vault', 'create', app.vault.getAbstractFileByPath('Sample'))
    await vi.advanceTimersByTimeAsync(350)
    expect(changed).toHaveBeenCalledTimes(1)
    expect(changed.mock.calls[0][0]).toHaveLength(1)
    expect(changed.mock.calls[0][0][0]).toBe('Sample')
  } finally {
    watch.stop()
    vi.useRealTimers()
  }
})

it('does not invalidate unchanged children when the host announces their existing scope folder', async () => {
  const app = buildFakeVault([{ path: 'Sample/Notes/One.md' }])
  Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => true })
  const fs = new ObsidianFileSystem(app as never, {
    fileScope: 'Sample', prepareStartupInventory: async () => {},
  })
  const stop = fs.watch(() => {})
  try {
    const epoch = Reflect.get(fs, Symbol.for('abele.sync.watch-epoch-v1')) as () => number
    const revision = Reflect.get(fs, Symbol.for('abele.sync.watch-revision-v1')) as
      (path: string) => number
    epoch.call(fs)
    const before = revision.call(fs, 'Sample/Notes/One.md')
    app.emit('vault', 'create', app.vault.getAbstractFileByPath('Sample'))
    expect(revision.call(fs, 'Sample/Notes/One.md')).toBe(before)
    const inventory = Reflect.get(fs, Symbol.for('abele.sync.inventory-pass-v1')) as
      (work: () => Promise<void>) => Promise<void>
    await inventory.call(fs, async () => {
      const reason = Reflect.get(fs, Symbol.for('abele.sync.unchanged-index-reason-v1')) as
        (path: string) => string
      expect(reason.call(fs, 'Sample/Notes/One.md')).toBe('hit')
    })
  } finally {
    stop()
  }
})

it('still names every moved child under both folder paths', async () => {
  const app = buildFakeVault(
    Array.from({ length: 32 }, (_, i) => ({ path: `Sample/Renamed/Child ${i}.md` }))
  )
  const changed = vi.fn()
  vi.useFakeTimers()
  const watch = watchVault(
    {
      app: app as never, now: Date.now, pollMs: 60000, configDir: '.obsidian',
      snapshot: async () => new Map(), onWatch: null,
    }, changed
  )
  try {
    app.emit('vault', 'rename', app.vault.getAbstractFileByPath('Sample/Renamed'), 'Sample/Old')
    await vi.advanceTimersByTimeAsync(350)
    expect(changed).toHaveBeenCalledTimes(1)
    const paths = new Set(changed.mock.calls[0][0] as string[])
    expect(paths.size).toBe(66)
    expect(paths.has('Sample/Old/Child 0.md')).toBe(true)
    expect(paths.has('Sample/Renamed/Child 0.md')).toBe(true)
  } finally {
    watch.stop()
    vi.useRealTimers()
  }
})
