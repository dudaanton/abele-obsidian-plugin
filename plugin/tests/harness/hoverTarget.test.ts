import { afterEach, expect, it, vi } from 'vitest'
import { settledHoverTarget } from '../e2e/helpers/hoverTarget'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

function marker(left: () => number) {
  const element = document.createElement('span')
  document.body.append(element)
  vi.spyOn(element, 'getBoundingClientRect').mockImplementation(
    () => ({ left: left(), top: 20, width: 8, height: 4 }) as DOMRect
  )
  return element
}

it('waits for the same hit-tested marker to stop moving before taking hover coordinates', async () => {
  vi.useFakeTimers()
  let left = 10
  let element = marker(() => left)
  vi.spyOn(document, 'elementFromPoint').mockImplementation(() => element)
  let settled = false
  const pending = settledHoverTarget(() => element).then((target) => {
    settled = true
    return target
  })
  await vi.advanceTimersByTimeAsync(500)
  expect(settled).toBe(false)
  left = 50
  await vi.advanceTimersByTimeAsync(500)
  expect(settled).toBe(false)
  // A rerender can replace a marker without changing its rectangle.
  element.remove()
  element = marker(() => left)
  await vi.advanceTimersByTimeAsync(500)
  expect(settled).toBe(false)
  await vi.advanceTimersByTimeAsync(750)
  expect(await pending).toEqual({ element, x: 54, y: 22 })
})

it('does not settle while a marker is covered', async () => {
  vi.useFakeTimers()
  const element = marker(() => 10)
  const hit = vi.spyOn(document, 'elementFromPoint').mockReturnValue(document.body)
  let settled = false
  const pending = settledHoverTarget(() => element).then((target) => {
    settled = true
    return target
  })
  await vi.advanceTimersByTimeAsync(1000)
  expect(settled).toBe(false)
  hit.mockReturnValue(element)
  await vi.advanceTimersByTimeAsync(800)
  expect((await pending).element).toBe(element)
})
