import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, type EffectScope } from 'vue'
import { useDate } from '@/composables/useDate'

const scopes: EffectScope[] = []
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2024, 0, 1, 12, 0, 0))
})
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it('shares one minute clock, does no frame polling and stops when all consumers hide', async () => {
  const frame = vi.spyOn(window, 'requestAnimationFrame')
  const visible = [ref(true), ref(true), ref(true)]
  const dates = visible.map((active) => {
    const scope = effectScope()
    scopes.push(scope)
    return scope.run(() => useDate(active))!
  })
  await vi.advanceTimersByTimeAsync(60_000)
  console.info(`date clock: frames/minute=${frame.mock.calls.length}, timers=${vi.getTimerCount()}`)
  expect(frame).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(1)
  visible.forEach((active) => {
    active.value = false
  })
  await nextTick()
  expect(vi.getTimerCount()).toBe(0)
  const old = dates[1].now.value
  vi.setSystemTime(new Date(2024, 0, 2, 12, 0, 0))
  visible[0].value = true
  await nextTick()
  expect(dates[0].now.value.format('YYYY-MM-DD')).toBe('2024-01-02')
  expect(dates[1].now.value).toBe(old)
  expect(vi.getTimerCount()).toBe(1)
})

it('suspends when the document hides and catches up once on return', async () => {
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  const scope = effectScope()
  scopes.push(scope)
  const date = scope.run(() => useDate())!
  hidden.mockReturnValue(true)
  document.dispatchEvent(new Event('visibilitychange'))
  expect(vi.getTimerCount()).toBe(0)
  vi.setSystemTime(new Date(2024, 0, 2))
  hidden.mockReturnValue(false)
  document.dispatchEvent(new Event('visibilitychange'))
  await nextTick()
  expect(date.now.value.format('YYYY-MM-DD')).toBe('2024-01-02')
  expect(vi.getTimerCount()).toBe(1)
})
