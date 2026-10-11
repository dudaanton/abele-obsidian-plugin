import { afterEach, describe, expect, it, vi } from 'vitest'
import { alignAnchor, anchorAt, holdAnchor } from '@/notePlaces/anchor'
import { NotePlaces } from '@/notePlaces/store'

function fixture() {
  const root = document.createElement('div')
  const footer = document.createElement('div')
  footer.className = 'abele-footer-widget-container'
  for (const key of ['task:sample-row.md', 'task:sample-next.md']) {
    const row = document.createElement('div')
    row.setAttribute('data-abele-anchor', key)
    footer.append(row)
  }
  root.append(footer)
  const scroller = document.createElement('div')
  const [row, next] = root.querySelectorAll<HTMLElement>('[data-abele-anchor]')
  let height = 52
  const box = (top: number, height: number) => ({ top, bottom: top + height, height }) as DOMRect
  vi.spyOn(scroller, 'getBoundingClientRect').mockImplementation(() => box(100, 400))
  vi.spyOn(root.firstElementChild!, 'getBoundingClientRect').mockImplementation(() => box(0, 800))
  vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() =>
    box(63 - scroller.scrollTop, height)
  )
  vi.spyOn(next, 'getBoundingClientRect').mockImplementation(() =>
    box(63 + height + 12 - scroller.scrollTop, 52)
  )
  return {
    root,
    scroller,
    row,
    next,
    resize: (value: number) => {
      height = value
    },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('partly visible footer row anchors', () => {
  it('observes the anchored row itself for before-paint corrections, not only the whole footer', () => {
    const f = fixture(),
      observed: Element[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(el: Element) {
          observed.push(el)
        }
        disconnect() {}
      }
    )
    const release = holdAnchor(f.root, () => f.scroller, anchorAt(f.root, f.scroller)!)
    expect(observed).toContain(f.row)
    release()
  })
  it('keeps the visible trailing edge when a lazy row returns with a shorter placeholder', () => {
    const f = fixture()
    const anchor = anchorAt(f.root, f.scroller)!
    const originalNextTop = f.next.getBoundingClientRect().top
    const saved = NotePlaces.from({ 'sample-note.md': { scroll: 20, at: 1, anchor } })
    f.resize(32)
    expect(alignAnchor(f.root, f.scroller, saved.get('sample-note.md')!.anchor!)).toBe(true)
    expect(f.row.getBoundingClientRect().bottom).toBe(115)
    expect(f.next.getBoundingClientRect().top).toBe(originalNextTop)
    // Keeping the placeholder in view lets its ordinary lazy content render.
    f.resize(52)
    alignAnchor(f.root, f.scroller, saved.get('sample-note.md')!.anchor!)
    expect(f.row.getBoundingClientRect().top).toBe(63)
    expect(f.next.getBoundingClientRect().top).toBe(originalNextTop)
  })

  it('keeps legacy top-only anchors working and does not attach height to fully visible rows', () => {
    const f = fixture()
    f.scroller.scrollTop = -50
    expect(anchorAt(f.root, f.scroller)).toEqual({ key: 'task:sample-row.md', offset: 13 })
    f.resize(32)
    alignAnchor(f.root, f.scroller, { key: 'task:sample-row.md', offset: -37 })
    expect(f.row.getBoundingClientRect().top).toBe(63)
  })

  it('retains valid row heights and detects changed anchor geometry without trusting invalid data', () => {
    const anchor = { key: 'task:sample-row.md', offset: -37, height: 52 }
    const saved = NotePlaces.from({ 'sample-note.md': { scroll: 20, at: 1, anchor } })
    expect(saved.get('sample-note.md')!.anchor).toEqual(anchor)
    expect(
      saved.remember('sample-note.md', { scroll: 20, at: 2, anchor: { ...anchor, height: 60 } })
    ).toBe(true)
    for (const height of [0, -1, NaN, Infinity, '52']) {
      const invalid = NotePlaces.from({
        'sample-note.md': { scroll: 20, at: 1, anchor: { ...anchor, height } },
      })
      expect(invalid.get('sample-note.md')!.anchor).toEqual({
        key: anchor.key,
        offset: anchor.offset,
      })
    }
  })
})
