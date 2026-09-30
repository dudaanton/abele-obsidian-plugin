import { expect, it, vi } from 'vitest'
import { useFakeClock } from '../../helpers/fakeClock'

const advance = useFakeClock()
// The stack frame represents the write-behind producer the guard recognises.
function useSettingsSave() {
  return setTimeout(() => {}, 500)
}

it('left pending', () => {
  useSettingsSave()
  expect(vi.getTimerCount()).toBe(1)
})

it('cancelled', () => {
  clearTimeout(useSettingsSave())
})

it('completed', async () => {
  useSettingsSave()
  await advance(500)
})
