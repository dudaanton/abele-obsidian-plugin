/**
 * A simulated touch selection changes repeatedly while its range is extended. Action bars must
 * wait for the selection to settle after the touch ends instead of covering the active range.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SettledSelection, SETTLE_MS } from '@/helpers/settledSelection'

let text: Text
let watcher: SettledSelection
const settled = vi.fn()
const cleared = vi.fn()

function selectWords(to = 5) {
  const selection = document.getSelection()!
  selection.removeAllRanges()
  const range = document.createRange()
  range.setStart(text, 0)
  range.setEnd(text, to)
  selection.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
}

function letGo() {
  document.getSelection()!.removeAllRanges()
  document.dispatchEvent(new Event('selectionchange'))
}

const touch = (type: 'touchstart' | 'touchend' | 'touchcancel', down: number) => {
  const event = new Event(type, { bubbles: true })
  Object.defineProperty(event, 'touches', { value: { length: down } })
  document.body.dispatchEvent(event)
}

const pointer = (type: 'pointerdown' | 'pointerup', pointerType: string) =>
  document.body.dispatchEvent(
    Object.assign(new Event(type, { bubbles: true }), { pointerType, button: 0 })
  )

beforeEach(() => {
  vi.useFakeTimers()
  settled.mockClear()
  cleared.mockClear()
  document.body.innerHTML = '<p>Take the night train.</p>'
  text = document.body.querySelector('p')!.firstChild as Text
  watcher = new SettledSelection(document, { settled, cleared })
})

afterEach(() => {
  watcher.destroy()
  document.getSelection()?.removeAllRanges()
  vi.useRealTimers()
})

describe('a finger selecting words', () => {
  it('shows nothing while the finger is down, however long it drags', () => {
    touch('touchstart', 1)
    for (let to = 2; to < 12; to++) {
      selectWords(to)
      vi.advanceTimersByTime(300)
    }
    vi.advanceTimersByTime(5000)
    expect(settled).not.toHaveBeenCalled()
  })

  it('shows once the finger is lifted and the words have stayed put a moment', () => {
    touch('touchstart', 1)
    selectWords()
    touch('touchend', 0)
    vi.advanceTimersByTime(SETTLE_MS.touch - 50)
    expect(settled).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(settled).toHaveBeenCalledTimes(1)
  })

  it('waits for the second finger too', () => {
    touch('touchstart', 1)
    touch('touchstart', 2)
    selectWords()
    touch('touchend', 1)
    vi.advanceTimersByTime(2000)
    expect(settled).not.toHaveBeenCalled()
    touch('touchend', 0)
    vi.advanceTimersByTime(SETTLE_MS.touch + 10)
    expect(settled).toHaveBeenCalledTimes(1)
  })

  it('a handle dragged without touches reaching the page waits for the words to stop moving', () => {
    // iOS moves its selection handles itself: the page hears only `selectionchange`.
    pointer('pointerdown', 'touch')
    pointer('pointerup', 'touch')
    for (let to = 2; to < 8; to++) {
      selectWords(to)
      vi.advanceTimersByTime(SETTLE_MS.touch - 100)
    }
    expect(settled).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    expect(settled).toHaveBeenCalledTimes(1)
  })

  it('a touch cancelled by the system counts as the finger going', () => {
    touch('touchstart', 1)
    selectWords()
    touch('touchcancel', 0)
    vi.advanceTimersByTime(SETTLE_MS.touch + 10)
    expect(settled).toHaveBeenCalledTimes(1)
  })
})

describe('a mouse', () => {
  it('waits for the button to come up', () => {
    pointer('pointerdown', 'mouse')
    selectWords()
    vi.advanceTimersByTime(2000)
    expect(settled).not.toHaveBeenCalled()
    pointer('pointerup', 'mouse')
    vi.advanceTimersByTime(SETTLE_MS.mouse + 10)
    expect(settled).toHaveBeenCalledTimes(1)
  })
})

describe('the keyboard', () => {
  it('shift and the arrows: shown after a short pause, not on every step', () => {
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true })
    )
    selectWords(2)
    vi.advanceTimersByTime(SETTLE_MS.key - 100)
    selectWords(3)
    vi.advanceTimersByTime(SETTLE_MS.key - 100)
    expect(settled).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    expect(settled).toHaveBeenCalledTimes(1)
  })
})

describe('the words let go', () => {
  it('is heard at once, and nothing settles afterwards', () => {
    selectWords()
    letGo()
    expect(cleared).toHaveBeenCalled()
    vi.advanceTimersByTime(2000)
    expect(settled).not.toHaveBeenCalled()
  })

  it('a finger going down starts over: whatever was shown goes until it settles again', () => {
    selectWords()
    vi.advanceTimersByTime(2000)
    expect(settled).toHaveBeenCalledTimes(1)
    touch('touchstart', 1)
    expect(cleared).toHaveBeenCalled()
  })

  it('a handle moving the words takes down what was shown until they stop again', () => {
    selectWords(4)
    vi.advanceTimersByTime(2000)
    expect(settled).toHaveBeenCalledTimes(1)
    selectWords(6)
    expect(cleared).toHaveBeenCalled()
    vi.advanceTimersByTime(2000)
    expect(settled).toHaveBeenCalledTimes(2)
  })

  it('a press on the bar itself is not a new selection', () => {
    const bar = document.createElement('div')
    document.body.append(bar)
    watcher.destroy()
    watcher = new SettledSelection(document, { settled, cleared, ignore: (n) => bar.contains(n) })
    selectWords()
    vi.advanceTimersByTime(2000)
    cleared.mockClear()
    const event = new Event('touchstart', { bubbles: true })
    Object.defineProperty(event, 'touches', { value: { length: 1 } })
    bar.dispatchEvent(event)
    expect(cleared).not.toHaveBeenCalled()
  })
})
