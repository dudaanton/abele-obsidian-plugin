import { afterEach, expect, it, vi } from 'vitest'
import { wideWheelStep } from '../e2e/helpers/wideWheelStep'
import { scrollCompletion } from '../e2e/helpers/scrollCompletion'

afterEach(() => vi.useRealTimers())

it('waits for renderer receipt and scroll completion after CDP acknowledgement', async () => {
  vi.useFakeTimers()
  const el = document.createElement('div')
  Object.defineProperty(el, 'scrollHeight', { value: 2000 })
  let receipts = 0,
    finished = false
  const run = wideWheelStep(
    el,
    async () => undefined,
    () => receipts,
    scrollCompletion
  ).then(() => {
    finished = true
  })
  await vi.advanceTimersByTimeAsync(32)
  expect(finished).toBe(false)
  receipts++
  el.scrollTop = 40
  el.dispatchEvent(new Event('scroll'))
  await vi.advanceTimersByTimeAsync(80)
  expect(finished).toBe(false)
  el.dispatchEvent(new Event('scrollend'))
  await run
  expect(finished).toBe(true)
})

it.each(['receipt', 'completion'])(
  'bounds a missing %s and removes its observers',
  async (missing) => {
    vi.useFakeTimers()
    const el = document.createElement('div')
    Object.defineProperty(el, 'scrollHeight', { value: 2000 })
    const remove = vi.spyOn(el, 'removeEventListener')
    let receipts = 0
    const run = wideWheelStep(
      el,
      async () => {
        if (missing === 'completion') receipts++
      },
      () => receipts,
      scrollCompletion
    )
    const failed = expect(run).rejects.toThrow(
      missing === 'receipt' ? 'not received' : 'did not complete'
    )
    await vi.advanceTimersByTimeAsync(2200)
    await failed
    expect(remove.mock.calls.map(([type]) => type)).toEqual(['scroll', 'scrollend'])
  }
)
