import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { WAIT_PRELUDE } from '../e2e/helpers/wait'

const source = readFileSync(resolve(__dirname, '../e2e/githubPhone.e2e.test.ts'), 'utf8')
const lookSource = source.slice(
  source.indexOf('      const look = async (text)'),
  source.indexOf('      const steps = []')
)

function navigation() {
  const state = { inView: false }
  const element = {
    textContent: 'sample-line',
    isConnected: true,
    getBoundingClientRect: () => ({
      height: 20,
      top: state.inView ? 10 : 900,
      bottom: state.inView ? 30 : 920,
    }),
  }
  const root = { querySelectorAll: () => [element] }
  const scroller = () => ({ getBoundingClientRect: () => ({ top: 0, bottom: 800 }) })
  const placeInView = () => ({ inView: state.inView })
  const look = new Function(
    'root',
    'scroller',
    'placeInView',
    `${WAIT_PRELUDE}; ${lookSource}; return look`
  )(root, scroller, placeInView) as (text: string) => Promise<unknown>
  return { state, look }
}

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

it('waits for marked lines to scroll into view beyond the former fixed allowance', async () => {
  vi.useFakeTimers()
  const { state, look } = navigation()
  setTimeout(() => {
    state.inView = true
  }, 3500)
  const done = vi.fn()
  void look('sample-line').then(done)
  await vi.advanceTimersByTimeAsync(3000)
  expect(done).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(600)
  expect(done).toHaveBeenCalledWith({ inView: true, drawn: 1 })
})

it('fails explicitly when marked lines never reach the viewport', async () => {
  vi.useFakeTimers()
  const result = navigation()
    .look('sample-line')
    .catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(20000)
  expect(await result).toBeInstanceOf(Error)
  expect(((await result) as Error).message).toMatch(/marked.*screen/i)
})
