import { expect, it, vi } from 'vitest'
import { watchVault } from '@/sync/vaultWatcher'
import { buildFakeVault } from '../helpers/fakeVault'
import { deferred } from '../helpers/deferred'

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
