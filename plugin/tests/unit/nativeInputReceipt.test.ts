import { afterEach, expect, it, vi } from 'vitest'
import { nativeInputReceipt } from '../e2e/helpers/nativeInputReceipt'

afterEach(() => vi.restoreAllMocks())

it('recognizes the native touch at the scroll box even when its target is a moving backdrop', () => {
  const el = document.createElement('div')
  const backdrop = document.createElement('div')
  vi.spyOn(document, 'elementFromPoint').mockReturnValue(el)
  const receive = nativeInputReceipt(() => el)
  const event = (type: string, id: number) =>
    ({
      type,
      target: backdrop,
      changedTouches: [{ identifier: id, clientX: 20, clientY: 50 }],
    }) as unknown as TouchEvent
  expect(receive(event('touchstart', 1))).toBe(true)
  vi.spyOn(document, 'elementFromPoint').mockReturnValue(backdrop)
  expect(receive(event('touchmove', 1))).toBe(true)
  expect(receive(event('touchmove', 2))).toBe(false)
  expect(receive(event('touchend', 1))).toBe(true)
  expect(receive(event('touchmove', 1))).toBe(false)
  expect(receive(event('touchstart', 2))).toBe(false)
})

it('still requires the wheel target to be inside the box', () => {
  const el = document.createElement('div')
  const receive = nativeInputReceipt(() => el)
  expect(receive({ type: 'wheel', target: el } as unknown as WheelEvent)).toBe(true)
  expect(receive({ type: 'wheel', target: document.body } as unknown as WheelEvent)).toBe(false)
})
