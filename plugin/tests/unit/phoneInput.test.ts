import { afterEach, expect, it, vi } from 'vitest'
import { focusPhoneInput } from '../e2e/helpers/phoneInput'

afterEach(() => {
  document.body.innerHTML = ''
  Reflect.deleteProperty(document, 'elementFromPoint')
  vi.useRealTimers()
})

it.each(['focus', 'covered', 'closed', 'miss'])(
  'only types after a settled native focus (%s)',
  async (mode) => {
    vi.useFakeTimers()
    const input = document.createElement('input')
    document.body.append(input)
    input.scrollIntoView = vi.fn()
    let top = 400,
      waits = 0
    input.getBoundingClientRect = () => ({ left: 20, top, width: 100, height: 20 }) as DOMRect
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => (mode === 'covered' ? null : input),
    })
    const tap = vi.fn(async (x: number, y: number) => {
      expect([x, y]).toEqual([70, 70])
      if (mode === 'closed') input.remove()
      else if (mode === 'focus') input.focus()
    })
    const wait = async (ms: number) => {
      waits++
      top = 60
      vi.advanceTimersByTime(ms)
    }
    const result = focusPhoneInput(input, tap, wait, 2000)
    if (mode === 'focus') {
      await result
      expect(document.activeElement).toBe(input)
      expect(tap).toHaveBeenCalledOnce()
      expect(waits).toBeGreaterThanOrEqual(4)
    } else {
      await expect(result).rejects.toThrow(/Share input|Share input has|Share input closed/)
      if (mode === 'covered') expect(tap).not.toHaveBeenCalled()
    }
  }
)
