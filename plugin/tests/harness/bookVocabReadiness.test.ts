import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { WAIT_PRELUDE } from '../e2e/helpers/wait'

const source = readFileSync(resolve(__dirname, '../e2e/bookVocab.e2e.test.ts'), 'utf8')
const template = source.match(/const PRELUDE = `([\s\S]*?)`\n/)![1]
const prelude = new Function('WAIT_PRELUDE', `return \`${template}\``)(WAIT_PRELUDE)

function opening() {
  const bounds = { width: 0, height: 0 }
  const doc = {
    fonts: { ready: Promise.resolve() },
    defaultView: { frameElement: { getBoundingClientRect: () => bounds } },
  }
  const section = { doc, done: true }
  const view = {
    model: { status: 'ready', panel: false },
    contentEl: { querySelector: () => null },
    reading: { marks: { vocab: { sections: new Map([[0, section]]) } } },
    engine: { renderer: { getContents: () => [{ doc, index: 0 }] } },
  }
  const leaf = { view, setViewState: async () => {} }
  const app = {
    workspace: { getLeavesOfType: () => [], iterateRootLeaves: () => {}, getLeaf: () => leaf },
  }
  const open = new Function('app', `${prelude}; return open`)(app) as (
    path: string
  ) => Promise<unknown>
  return { bounds, open }
}

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

it('waits for the vocabulary page to have a visible frame, beyond the old opening sleep', async () => {
  vi.useFakeTimers()
  const { bounds, open } = opening()
  const done = vi.fn()
  setTimeout(() => Object.assign(bounds, { width: 600, height: 800 }), 1200)
  void open('sample.epub').then(done)
  await vi.advanceTimersByTimeAsync(1000)
  expect(done).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(500)
  expect(done).toHaveBeenCalledOnce()
})

it('rejects a vocabulary page which never becomes visible', async () => {
  vi.useFakeTimers()
  const { open } = opening()
  const result = open('sample.epub').catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(20000)
  expect(await result).toBeInstanceOf(Error)
  expect(((await result) as Error).message).toMatch(/vocabulary page/i)
})
