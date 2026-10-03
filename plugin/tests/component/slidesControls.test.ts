import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeckViewer } from '@/slides/core/DeckViewer'
import { parseDeck } from '@/slides/core/markdown'

let viewer: DeckViewer
const make = async (options: ConstructorParameters<typeof DeckViewer>[3] = {}) => {
  const host = document.createElement('div')
  document.body.append(host)
  viewer = new DeckViewer(
    host,
    {
      render: async (block, el) => {
        el.textContent = block.source
        return () => {}
      },
    },
    { resolve: () => null, readCss: async () => '' },
    options
  )
  await viewer.setDeck(parseDeck('# First\n---\n# Second\n---\n# Third'))
  return viewer
}
const visible = () => viewer.root.classList.contains('abele-deck-controls-visible')
const touch = (x: number) => {
  for (const type of ['pointerdown', 'pointerup'])
    viewer.viewport.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerType: 'touch',
        isPrimary: true,
        pointerId: 1,
        clientX: x,
        clientY: 100,
      })
    )
}
afterEach(() => {
  viewer?.destroy()
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('unobstructed presentation controls', () => {
  it('starts hidden, appears only over the top strip and fades after leaving it', async () => {
    await make()
    vi.useFakeTimers()
    await viewer.present(false)
    expect(visible()).toBe(false)
    expect(viewer.toolbar.inert).toBe(true)
    expect(viewer.toolbar.getAttribute('aria-hidden')).toBe('true')
    const move = (clientY: number) =>
      viewer.root.dispatchEvent(
        new PointerEvent('pointermove', { pointerType: 'mouse', clientY, bubbles: true })
      )
    move(300)
    expect(visible()).toBe(false)
    move(20)
    expect(visible()).toBe(true)
    expect(viewer.toolbar.inert).toBe(false)
    vi.advanceTimersByTime(3000)
    expect(visible()).toBe(true)
    move(300)
    vi.advanceTimersByTime(2000)
    move(20)
    move(300)
    vi.advanceTimersByTime(1000)
    expect(visible()).toBe(true)
    vi.advanceTimersByTime(2000)
    expect(visible()).toBe(false)
    expect(viewer.toolbar.inert).toBe(true)
    viewer.exitPresenting()
    expect(viewer.toolbar.inert).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reveals on empty-area taps while preserving tap thirds, swipes and keys', async () => {
    await make()
    vi.spyOn(viewer.viewport, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 300,
      height: 200,
    } as DOMRect)
    vi.useFakeTimers()
    await viewer.present(false)
    touch(150)
    expect(visible()).toBe(true)
    expect(viewer.index).toBe(0)
    vi.advanceTimersByTime(3000)
    expect(visible()).toBe(false)
    touch(280)
    await viewer.ready
    expect(viewer.index).toBe(1)
    expect(visible()).toBe(true)
    touch(20)
    await viewer.ready
    expect(viewer.index).toBe(0)
    viewer.viewport.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        pointerType: 'touch',
        isPrimary: true,
        pointerId: 2,
        clientX: 280,
        clientY: 100,
      })
    )
    viewer.viewport.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        pointerType: 'touch',
        isPrimary: true,
        pointerId: 2,
        clientX: 20,
        clientY: 100,
      })
    )
    await viewer.ready
    expect(viewer.index).toBe(1)
    viewer.handleKey(new KeyboardEvent('keydown', { key: 'End' }))
    await viewer.ready
    expect(viewer.index).toBe(2)
  })

  it('requests fullscreen synchronously from the Play click and Escape restores the tab', async () => {
    const enter = vi.fn(async () => {}),
      exit = vi.fn(async () => {})
    await make({ fullscreenHost: { enter, exit } })
    const host = viewer.root.parentElement
    viewer.toolbar.querySelector<HTMLButtonElement>('button[aria-label="Play"]')!.click()
    expect(enter).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    expect(visible()).toBe(false)
    viewer.handleKey(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(viewer.root.parentElement).toBe(host)
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('keeps keyboard-accessible controls available without idle hiding focused buttons', async () => {
    await make()
    vi.useFakeTimers()
    await viewer.present(false)
    viewer.handleKey(new KeyboardEvent('keydown', { key: 'Tab' }))
    expect(visible()).toBe(true)
    const exit = viewer.toolbar.querySelector<HTMLButtonElement>(
      'button[aria-label="Exit presentation"]'
    )!
    exit.focus()
    vi.advanceTimersByTime(3000)
    expect(visible()).toBe(true)
    viewer.root.focus()
    vi.advanceTimersByTime(3000)
    expect(visible()).toBe(false)
    viewer.destroy()
    expect(vi.getTimerCount()).toBe(0)
  })
})
