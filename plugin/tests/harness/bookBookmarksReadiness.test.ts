import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { WAIT_PRELUDE } from '../e2e/helpers/wait'

const source = readFileSync(resolve(__dirname, '../e2e/bookBookmarks.e2e.test.ts'), 'utf8')
const template = source.match(/const PRELUDE = `([\s\S]*?)`\n/)![1]
const prelude = new Function('WAIT_PRELUDE', 'SHOTS', `return \`${template}\``)(WAIT_PRELUDE, '')
const press = new Function('window', `${prelude}; return press`)({
  __abeleTest: {
    AbeleConfig: { getInstance: () => ({ reader: {} }) },
    createBookTools: () => [],
  },
}) as (view: unknown) => Promise<void>

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

it('waits for the bookmark button to reflect a delayed toggle', async () => {
  vi.useFakeTimers()
  let active = false
  const button = {
    click: () =>
      setTimeout(() => {
        active = true
      }, 900),
    classList: { contains: () => active },
  }
  const done = vi.fn()
  void press({ contentEl: { querySelector: () => button } }).then(done)
  await vi.advanceTimersByTimeAsync(800)
  expect(done).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(200)
  expect(done).toHaveBeenCalledOnce()
})

it('rejects a bookmark toggle which never reaches the DOM', async () => {
  vi.useFakeTimers()
  const button = { click: vi.fn(), classList: { contains: () => false } }
  const result = press({ contentEl: { querySelector: () => button } }).catch(
    (error: unknown) => error
  )
  await vi.advanceTimersByTimeAsync(16000)
  expect(await result).toBeInstanceOf(Error)
  expect(((await result) as Error).message).toMatch(/bookmark.*toggle/i)
})
