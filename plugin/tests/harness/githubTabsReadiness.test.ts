import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { WAIT_PRELUDE } from '../e2e/helpers/wait'

const source = readFileSync(resolve(__dirname, '../e2e/githubTabs.e2e.test.ts'), 'utf8')
const settleSource = source.match(/const settle = ([\s\S]*?)\n        const middle/)![1]
const settle = new Function(`${WAIT_PRELUDE}; return ${settleSource}`)() as (
  el: unknown
) => Promise<void>

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

it('rejects a selection target that keeps moving instead of silently exhausting its polls', async () => {
  vi.useFakeTimers()
  let top = 0
  const el = {
    scrollIntoView: vi.fn(),
    getBoundingClientRect: () => ({ top: top++ }),
  }
  const result = settle(el).catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(16000)
  expect(await result).toBeInstanceOf(Error)
  expect(((await result) as Error).message).toMatch(/selection target/)
})

it('observes a full quiet second after the last movement before aiming a drag', async () => {
  vi.useFakeTimers()
  let top = 10
  const el = { scrollIntoView: vi.fn(), getBoundingClientRect: () => ({ top }) }
  const done = vi.fn()
  void settle(el).then(done)
  setTimeout(() => {
    top = 30
  }, 900)
  await vi.advanceTimersByTimeAsync(1800)
  expect(done).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(500)
  expect(done).toHaveBeenCalledOnce()
})
