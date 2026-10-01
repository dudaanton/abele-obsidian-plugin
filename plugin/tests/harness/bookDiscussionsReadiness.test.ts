import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { WAIT_PRELUDE } from '../e2e/helpers/wait'

const source = readFileSync(resolve(__dirname, '../e2e/bookDiscussions.e2e.test.ts'), 'utf8')
const template = source.match(/const PRELUDE = `([\s\S]*?)`\n/)![1]
const prelude = new Function('WAIT_PRELUDE', 'SHOTS', `return \`${template}\``)(
  WAIT_PRELUDE,
  'sample-shots'
)

function opening() {
  const bounds = { width: 0, height: 0 }
  const doc = {
    body: { getBoundingClientRect: () => bounds },
    defaultView: { frameElement: { getBoundingClientRect: () => bounds } },
  }
  const leaf = {
    view: {
      model: { status: 'ready' },
      reading: {},
      engine: { renderer: { getContents: () => [{ doc }] } },
    },
    setViewState: async () => {},
  }
  const app = {
    workspace: { getLeavesOfType: () => [], iterateRootLeaves: () => {}, getLeaf: () => leaf },
  }
  const window = { __abeleTest: { CommentService: { getInstance: () => ({}) } } }
  const open = new Function('app', 'window', `${prelude}; return open`)(app, window) as (
    path: string
  ) => Promise<unknown>
  return { bounds, open }
}

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

it('waits for the discussion page to draw beyond the old opening sleep', async () => {
  vi.useFakeTimers()
  const { bounds, open } = opening()
  setTimeout(() => Object.assign(bounds, { width: 600, height: 800 }), 1400)
  const done = vi.fn()
  void open('sample.epub').then(done)
  await vi.advanceTimersByTimeAsync(1000)
  expect(done).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(500)
  expect(done).toHaveBeenCalledOnce()
})

it('rejects a discussion page which never draws', async () => {
  vi.useFakeTimers()
  const result = opening()
    .open('sample.epub')
    .catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(20000)
  expect(await result).toBeInstanceOf(Error)
  expect(((await result) as Error).message).toMatch(/discussion.*page/i)
})
