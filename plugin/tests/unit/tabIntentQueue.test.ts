import { describe, expect, it } from 'vitest'
import { TabIntentQueue } from '@/ai/TabIntentQueue'

describe('serial tab presentation intents', () => {
  it('supersedes the same target but preserves independent background opens', () => {
    const queue = new TabIntentQueue()
    const first = queue.begin('sample-a', false)
    const other = queue.begin('sample-b', false)
    const latest = queue.begin('sample-a', false)
    expect(queue.valid(first)).toBe(false)
    expect(queue.valid(other)).toBe(true)
    expect(queue.selected(other)).toBe(false)
    expect(queue.selected(latest)).toBe(true)
  })

  it('a foreground action supersedes contextual work even for a different target', () => {
    const queue = new TabIntentQueue()
    const older = queue.begin('sample-context', true)
    queue.begin('sample-tab', false)
    expect(queue.apply(older, () => 'stale')).toBeUndefined()
  })

  it('queues reentrant commits instead of letting observers interleave transactions', () => {
    const queue = new TabIntentQueue(), trace: string[] = []
    const older = queue.begin('sample', true)
    queue.apply(older, () => {
      trace.push('old:start')
      const stale = queue.begin('sample', true)
      queue.apply(stale, () => trace.push('stale'))
      const latest = queue.begin('sample', true)
      queue.apply(latest, () => trace.push('latest'))
      trace.push('old:end')
    })
    expect(trace).toEqual(['old:start', 'old:end', 'latest'])
  })

  it('does not let an already expired action supersede live work', () => {
    const queue = new TabIntentQueue()
    const live = queue.begin('sample', true)
    const expired = queue.begin('sample', true, () => false)
    expect(queue.valid(live)).toBe(true)
    expect(queue.valid(expired)).toBe(false)
  })

  it('propagates falsy errors and remains usable after failure', () => {
    const queue = new TabIntentQueue()
    let caught = false
    try { queue.mutate(() => { throw undefined }) } catch { caught = true }
    expect(caught).toBe(true)
    expect(queue.mutate(() => 'ready')).toBe('ready')
  })

  it('drains independently queued actions even if an observer throws', () => {
    const queue = new TabIntentQueue(), trace: string[] = []
    expect(() => queue.mutate(() => {
      queue.mutate(() => trace.push('queued'))
      throw new Error('Sample observer failure')
    })).toThrow('Sample observer failure')
    expect(trace).toEqual(['queued'])
    expect(queue.mutate(() => 'ready')).toBe('ready')
  })

  it('settles queued async callers after teardown without committing their work', async () => {
    const queue = new TabIntentQueue(), intent = queue.begin('sample', true)
    let queued!: Promise<string | undefined>
    queue.mutate(() => {
      queued = queue.applyAsync(intent, () => 'stale')
      queue.clear()
    })
    expect(await queued).toBeUndefined()
  })

  it('rejects an async commit error without poisoning subsequent actions', async () => {
    const queue = new TabIntentQueue(), intent = queue.begin('sample', true)
    await expect(queue.applyAsync(intent, () => { throw new Error('Sample failure') })).rejects.toThrow('Sample failure')
    expect(await queue.applyAsync(intent, () => 'ready')).toBe('ready')
  })

  it('normalizes non-Error async failures while preserving their cause', async () => {
    const queue = new TabIntentQueue(), intent = queue.begin('sample', true)
    await expect(queue.applyAsync(intent, () => { throw 'Sample reason' })).rejects.toMatchObject({
      message: 'Tab presentation failed',
      cause: 'Sample reason',
    })
  })

  it('refuses a reentrant synchronous factory before enqueueing its side effects', () => {
    const queue = new TabIntentQueue()
    let acquired = 0
    queue.mutate(() => {
      expect(() => queue.mutateImmediate(() => { acquired++ })).toThrow('cannot run inside')
    })
    expect(acquired).toBe(0)
    const release = queue.mutateImmediate(() => {
      acquired++
      return () => { acquired-- }
    })
    expect(acquired).toBe(1)
    release()
    expect(acquired).toBe(0)
  })

  it('captures foreground authority without superseding it', () => {
    const queue = new TabIntentQueue(), original = queue.begin('sample', true)
    expect(queue.captureForeground()).toBe(original)
    expect(queue.valid(original)).toBe(true)
    queue.clear()
    expect(queue.captureForeground()).toBeUndefined()
  })

  it('rejects completions from before service teardown', () => {
    const queue = new TabIntentQueue(), intent = queue.begin('sample', true)
    queue.clear()
    expect(queue.apply(intent, () => 'stale')).toBeUndefined()
  })
})
