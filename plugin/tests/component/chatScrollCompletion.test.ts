import { afterEach, expect, it, vi } from 'vitest'
import { scrollCompletion } from '../e2e/helpers/scrollCompletion'

afterEach(() => vi.useRealTimers())

const viewport = () => {
  const el = document.createElement('div')
  Object.defineProperties(el, {
    scrollHeight: { value: 2000 },
    clientHeight: { value: 800 },
  })
  return el
}

it('does not start the hold at release acknowledgement before the final native movement', async () => {
  const el = viewport()
  const completion = scrollCompletion(el)
  el.scrollTop = 144
  el.dispatchEvent(new Event('scrollend')) // An earlier gesture is not this release.
  completion.releasing()
  let baseline: number | undefined
  const hold = completion.wait().then(() => {
    baseline = el.scrollTop
  })
  await Promise.resolve()
  expect(baseline).toBeUndefined()
  el.scrollTop = 0
  el.dispatchEvent(new Event('scroll'))
  await Promise.resolve()
  expect(baseline).toBeUndefined()
  el.dispatchEvent(new Event('scrollend'))
  await hold
  expect(baseline).toBe(0)
  completion.stop()
})

it('remembers completion delivered before release acknowledgement returns', async () => {
  const el = viewport()
  const completion = scrollCompletion(el)
  completion.releasing()
  el.dispatchEvent(new Event('scrollend'))
  await completion.wait()
  completion.stop()
})

it('fails missing completion instead of silently starting a hold', async () => {
  vi.useFakeTimers()
  const completion = scrollCompletion(viewport())
  completion.releasing()
  const failure = expect(completion.wait()).rejects.toThrow(
    'Native scrollbar drag did not complete'
  )
  await vi.advanceTimersByTimeAsync(1000)
  await failure
  completion.stop()
})

it('allows a no-op drag in a viewport without a scroll range', async () => {
  const completion = scrollCompletion(document.createElement('div'))
  completion.releasing()
  await completion.wait()
  completion.stop()
})
