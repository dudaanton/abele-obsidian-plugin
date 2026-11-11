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

it('retains real upward movement across a history page rebase', async () => {
  const el = viewport()
  el.scrollTop = 1000
  const completion = scrollCompletion(el)
  el.scrollTop = 100
  el.dispatchEvent(new Event('scroll'))
  // Prepending history changes the coordinate origin, not the reader's travel.
  el.scrollTop = 1800
  el.dispatchEvent(new Event('scroll'))
  completion.releasing()
  el.dispatchEvent(new Event('scrollend'))
  await completion.wait()
  expect(completion.movedUp).toBe(true)
  completion.stop()
})

it('accepts the final movement completing before mouse release', async () => {
  vi.useFakeTimers()
  const el = viewport()
  el.scrollTop = 1000
  const completion = scrollCompletion(el)
  el.scrollTop = 100
  el.dispatchEvent(new Event('scroll'))
  el.dispatchEvent(new Event('scrollend'))
  completion.releasing()
  const settled = expect(completion.wait()).resolves.toBeUndefined()
  await vi.advanceTimersByTimeAsync(1000)
  await settled
  completion.stop()
})

it('does not count a press and release without upward movement as a drag', async () => {
  const el = viewport()
  const completion = scrollCompletion(el)
  completion.releasing()
  el.dispatchEvent(new Event('scrollend'))
  await completion.wait()
  expect(completion.movedUp).toBe(false)
  completion.stop()
})

it('waits for later movement even if an earlier drag movement already completed', async () => {
  const el = viewport()
  el.scrollTop = 1000
  const completion = scrollCompletion(el)
  el.scrollTop = 600
  el.dispatchEvent(new Event('scroll'))
  el.dispatchEvent(new Event('scrollend'))
  el.scrollTop = 200
  el.dispatchEvent(new Event('scroll'))
  completion.releasing()
  let settled = false
  const done = completion.wait().then(() => {
    settled = true
  })
  await Promise.resolve()
  expect(settled).toBe(false)
  el.dispatchEvent(new Event('scrollend'))
  await done
  expect(settled).toBe(true)
  completion.stop()
})
