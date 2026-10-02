import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Execute the fixture's actual page-local helpers, without loading its e2e suite.
const source = readFileSync(resolve(__dirname, '../e2e/taskTimelineScroll.e2e.test.ts'), 'utf8')
const prelude = source.match(/  const wait = ms[\s\S]*?(?=  const folder =)/)![0]

function fixture() {
  const tasks = new Map<string, { dates: string[] }>()
  const cache = new Map<string, unknown>()
  const create = vi.fn(async (path: string) => ({ path }))
  const writeBatch = new Function('app', 'window', `${prelude}; return { createTask, writeBatch }`)(
    {
      vault: { create },
      metadataCache: { getFileCache: (file: { path: string }) => cache.get(file.path) },
    },
    { __abeleTest: { GlobalStore: { getInstance: () => ({ tasksList: { value: { tasks } } }) } } }
  ) as {
    createTask: (path: string, text: string) => Promise<void>
    writeBatch: (writes: (() => Promise<void>)[]) => Promise<void>
  }
  const ready = (path: string) => {
    cache.set(path, { frontmatter: { type: 'task' } })
    tasks.set(path, { dates: ['2030-01-01'] })
  }
  return { ...writeBatch, create, ready, cache }
}

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('timeline native fixture creation', () => {
  it('does not start the next write before both metadata and the task store are ready', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const done = vi.fn()
    const result = f.writeBatch(
      ['sample-a.md', 'sample-b.md'].map((path) => () => f.createTask(path, 'sample'))
    )
    void result.then(done)
    await vi.advanceTimersByTimeAsync(500)
    expect(f.create).toHaveBeenCalledTimes(1)
    f.cache.set('sample-a.md', { frontmatter: { type: 'task' } })
    await vi.advanceTimersByTimeAsync(500)
    expect(f.create).toHaveBeenCalledTimes(1)
    f.ready('sample-a.md')
    await vi.advanceTimersByTimeAsync(100)
    expect(f.create).toHaveBeenCalledTimes(2)
    expect(done).not.toHaveBeenCalled()
    f.ready('sample-b.md')
    await vi.advanceTimersByTimeAsync(100)
    await result
    expect(done).toHaveBeenCalledOnce()
  })

  it('reports the exact fixture note whose metadata never becomes ready', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const result = f.createTask('sample-missing.md', 'sample').catch((error) => error)
    await vi.advanceTimersByTimeAsync(15_100)
    expect((await result).message).toContain('created task metadata sample-missing.md')
  })
})
