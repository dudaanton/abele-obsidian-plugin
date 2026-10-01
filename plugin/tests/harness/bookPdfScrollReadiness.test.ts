import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { WAIT_PRELUDE } from '../e2e/helpers/wait'

const source = readFileSync(resolve(__dirname, '../e2e/bookPdfScroll.e2e.test.ts'), 'utf8')
const template = source.match(/const PRELUDE = `([\s\S]*?)`\n/)![1]
const prelude = new Function('WAIT_PRELUDE', `return \`${template}\``)(WAIT_PRELUDE)

function opening() {
  const image = { complete: false, naturalWidth: 0 }
  const bounds = { width: 600, height: 800 }
  const doc = {
    querySelector: () => image,
    defaultView: { frameElement: { getBoundingClientRect: () => bounds } },
  }
  const view = {
    model: { status: 'ready' },
    engine: { renderer: { index: 0, getContents: () => [{ doc, index: 0 }] } },
  }
  const leaf = { view, setViewState: async () => {} }
  const app = { workspace: { getLeaf: () => leaf } }
  const open = new Function('app', `${prelude}; return open`)(app) as (
    path: string
  ) => Promise<unknown>
  return { image, open }
}

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

it('waits for the current PDF image to decode, not just for its element', async () => {
  vi.useFakeTimers()
  const { image, open } = opening()
  const done = vi.fn()
  setTimeout(() => Object.assign(image, { complete: true, naturalWidth: 600 }), 1200)
  void open('sample.pdf').then(done)
  await vi.advanceTimersByTimeAsync(800)
  expect(done).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(600)
  expect(done).toHaveBeenCalledOnce()
})

it('rejects a PDF whose image never decodes', async () => {
  vi.useFakeTimers()
  const { open } = opening()
  const result = open('sample.pdf').catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(16000)
  expect(await result).toBeInstanceOf(Error)
  expect(((await result) as Error).message).toMatch(/PDF page/i)
})
