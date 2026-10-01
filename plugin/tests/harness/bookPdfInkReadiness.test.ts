import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { WAIT_PRELUDE } from '../e2e/helpers/wait'

const source = readFileSync(resolve(__dirname, '../e2e/bookPdfInk.e2e.test.ts'), 'utf8')
const template = source.match(/const PRELUDE = `([\s\S]*?)`\n/)![1]
const prelude = new Function('WAIT_PRELUDE', 'SHOTS', `return \`${template}\``)(WAIT_PRELUDE, '')

function opening() {
  const image = { complete: false, naturalWidth: 0 }
  const bounds = { left: 0, top: 0, width: 600, height: 800 }
  const doc = {
    querySelector: () => image,
    defaultView: { frameElement: { getBoundingClientRect: () => bounds } },
  }
  const view = {
    model: { status: 'ready', panel: false },
    ink: {},
    engine: { renderer: { getContents: () => [{ doc, index: 0 }] } },
  }
  const leaf = { view, setViewState: async () => {} }
  const app = { workspace: { layoutReady: true, getLeaf: () => leaf, revealLeaf: async () => {} } }
  const open = new Function('app', 'require', `${prelude}; return open`)(app, () => ({
    getCurrentWebContents: () => ({ debugger: {} }),
  })) as (path: string) => Promise<unknown>
  return { image, open }
}

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

it('does not return a PDF page before its image has decoded', async () => {
  vi.useFakeTimers()
  const { image, open } = opening()
  const done = vi.fn()
  setTimeout(() => Object.assign(image, { complete: true, naturalWidth: 600 }), 2600)
  void open('sample.pdf').then(done)
  await vi.advanceTimersByTimeAsync(2000)
  expect(done).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1000)
  expect(done).toHaveBeenCalledOnce()
})

it('rejects an image which never becomes drawable', async () => {
  vi.useFakeTimers()
  const { open } = opening()
  const result = open('sample.pdf').catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(20000)
  expect(await result).toBeInstanceOf(Error)
  expect(((await result) as Error).message).toMatch(/PDF page/)
})
