import { afterEach, expect, it, vi } from 'vitest'
import { menuAction, modalDetached, modalIsMoving, modalReady } from '../e2e/helpers/modalMotion'

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

it('activates a menu item only after deferred loading and the opening spring settle', async () => {
  const menu = document.createElement('div')
  menu.className = 'menu'
  menu.getAnimations = () => []
  menu.getBoundingClientRect = () =>
    ({ left: 0, top: menu.style.transform ? 420 : 0, width: 200, height: 100 }) as DOMRect
  const item = document.createElement('div')
  item.className = 'menu-item'
  item.textContent = 'Rename…'
  menu.append(item)
  document.body.append(menu)
  let frames = 0,
    loaded = false
  const clicks: Array<{ loaded: boolean; transform: string }> = []
  item.addEventListener('click', () => clicks.push({ loaded, transform: menu.style.transform }))
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
    frames++
    if (frames === 1) menu.style.transform = 'translateY(420px)'
    if (frames === 2) loaded = true
    if (frames === 4) menu.style.transform = ''
    queueMicrotask(() => callback(frames * 16))
    return frames
  })
  await menuAction(menu, 'Rename…')
  expect(clicks).toEqual([{ loaded: true, transform: '' }])
  expect(frames).toBeGreaterThanOrEqual(7)
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
