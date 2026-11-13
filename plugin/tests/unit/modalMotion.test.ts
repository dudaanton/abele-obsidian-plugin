import { afterEach, expect, it, vi } from 'vitest'
import { modalDetached, modalIsMoving, modalReady } from '../e2e/helpers/modalMotion'

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

it('does not measure an opening sheet before its inline spring settles', async () => {
  const modal = document.createElement('div')
  document.body.append(modal)
  modal.getAnimations = () => []
  modal.style.transform = 'translateY(700px)'
  let frames = 0
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
    frames++
    if (frames === 3) modal.style.transform = ''
    queueMicrotask(() => callback(frames * 16))
    return frames
  })
  await modalReady(modal)
  expect(frames).toBeGreaterThanOrEqual(5)
})

it('waits for the backdrop container, even after its content was removed', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  let frames = 0
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
    frames++
    if (frames === 3) container.remove()
    queueMicrotask(() => callback(frames * 16))
    return frames
  })
  await modalDetached(container)
  expect(container.isConnected).toBe(false)
  expect(frames).toBe(3)
})

it('recognizes a host spring with no Web Animation records', () => {
  const modal = document.createElement('div')
  modal.getAnimations = () => []
  modal.style.transform = 'translateY(700px)'
  expect(modalIsMoving(modal)).toBe(true)
  modal.style.transform = ''
  expect(modalIsMoving(modal)).toBe(false)
})

it('ignores indefinite status motion but waits for finite chrome motion', () => {
  const modal = document.createElement('div')
  modal.getAnimations = () =>
    [
      {
        playState: 'running',
        effect: { getTiming: () => ({ iterations: Infinity }) },
      },
    ] as Animation[]
  expect(modalIsMoving(modal)).toBe(false)
  modal.getAnimations = () =>
    [
      {
        playState: 'running',
        effect: { getTiming: () => ({ iterations: 1 }) },
      },
    ] as Animation[]
  expect(modalIsMoving(modal)).toBe(true)
})
