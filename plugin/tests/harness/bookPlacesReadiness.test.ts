import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WAIT_PRELUDE } from '../e2e/helpers/wait'

// Execute the actual eval-local setup without loading an e2e suite or driving Obsidian.
const source = readFileSync(resolve(__dirname, '../e2e/bookPlaces.e2e.test.ts'), 'utf8')
const template = source.match(/const PRELUDE = `([\s\S]*?)`\n/)![1]
const prelude = new Function('WAIT_PRELUDE', `return \`${template}\``)(WAIT_PRELUDE)
const ready = new Function('window', `${prelude}; return ready`)({
  __abeleTest: { AbeleConfig: { getInstance: () => ({ reader: {} }) } },
}) as (leaf: ReturnType<typeof fixture>) => Promise<unknown>

function fixture() {
  return {
    loadIfDeferred: vi.fn().mockResolvedValue(undefined),
    view: {
      model: { status: 'ready', chapter: 'Sample chapter' },
      engine: {
        lastLocation: { cfi: 'sample-place' },
        renderer: { getContents: () => [{ doc: { readyState: 'complete' } }] },
      },
    },
  }
}

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('book places setup readiness', () => {
  it('returns an already located reader without a fixed settling sleep', async () => {
    vi.useFakeTimers()
    const leaf = fixture()
    const done = vi.fn()
    void ready(leaf).then(done)
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toHaveBeenCalledWith(leaf.view)
    expect(leaf.loadIfDeferred).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not return before a delayed initial location exists', async () => {
    vi.useFakeTimers()
    const leaf = fixture()
    leaf.view.engine.lastLocation.cfi = ''
    const done = vi.fn()
    void ready(leaf).then(done)
    await vi.advanceTimersByTimeAsync(900)
    expect(done).not.toHaveBeenCalled()
    leaf.view.engine.lastLocation.cfi = 'sample-place'
    await vi.advanceTimersByTimeAsync(100)
    expect(done).toHaveBeenCalledWith(leaf.view)
  })

  it('rejects a reader which never becomes ready instead of using it after expiry', async () => {
    vi.useFakeTimers()
    const leaf = fixture()
    leaf.view.model.status = 'loading'
    const result = ready(leaf).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(16000)
    expect(await result).toBeInstanceOf(Error)
    expect(((await result) as Error).message).toMatch(/reader.*ready/i)
  })
})
