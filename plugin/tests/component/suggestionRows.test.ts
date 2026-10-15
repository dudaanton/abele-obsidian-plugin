/**
 * A picker row is the kit's `SuggestionRow`, rendered into the element Obsidian hands
 * `renderSuggestion`, in Obsidian's own markup — and taken out again when the list is redrawn
 * or the picker closes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, onUnmounted } from 'vue'
import { SuggestionRows } from '@/components/obsidian/suggestionRows'

afterEach(() => document.body.replaceChildren())

const list = () => document.body.appendChild(document.createElement('div'))
const item = (parent: HTMLElement) => {
  const el = document.createElement('div')
  el.className = 'suggestion-item'
  parent.appendChild(el)
  return el
}

describe('SuggestionRow', () => {
  it("draws Obsidian's row: icon flair, title, note and the aux parts in order", () => {
    const el = item(list())
    new SuggestionRows().draw(el, {
      icon: 'git-branch',
      title: 'sample-branch',
      note: 'shown now',
      aux: [{ kbd: 'Branch' }, { flair: '10:30', cls: 'abele-sample-time' }, { dot: 'Working' }],
    })
    expect(el.classList.contains('mod-complex')).toBe(true)
    expect([...el.children].map((c) => c.className)).toEqual([
      'suggestion-icon',
      'suggestion-content',
      'suggestion-aux',
    ])
    expect(el.querySelector('.suggestion-icon > .suggestion-flair')).not.toBeNull()
    expect(el.querySelector('.suggestion-title')?.textContent).toBe('sample-branch')
    expect(el.querySelector('.suggestion-note')?.textContent?.trim()).toBe('shown now')
    const aux = el.querySelector('.suggestion-aux')!
    expect(aux.querySelector('kbd.suggestion-hotkey')?.textContent).toBe('Branch')
    expect(aux.querySelector('.suggestion-flair.abele-sample-time')?.textContent).toBe('10:30')
    expect(aux.children).toHaveLength(3)
  })

  it('leaves out what it was not given, and keeps an empty note only when asked', () => {
    const parent = list()
    const rows = new SuggestionRows()
    const bare = item(parent)
    rows.draw(bare, { title: 'Sample', note: '' })
    expect([...bare.children].map((c) => c.className)).toEqual(['suggestion-content'])
    expect(bare.querySelector('.suggestion-note')).toBeNull()
    const kept = item(parent)
    rows.draw(kept, { title: 'Sample', note: '', keepNote: true })
    expect(kept.querySelector('.suggestion-note')).not.toBeNull()
  })

  it('puts a swatch in the icon place and a slot at the end', () => {
    const el = item(list())
    new SuggestionRows().draw(el, { swatch: 'red', title: 'red' }, () =>
      h('button', { class: 'abele-sample-pin' })
    )
    expect(
      (el.querySelector('.suggestion-icon .abele-suggestion-row__swatch') as HTMLElement).style
        .backgroundColor
    ).toBe('red')
    expect(el.querySelector('.suggestion-aux > .abele-sample-pin')).not.toBeNull()
  })
})

describe('SuggestionRows', () => {
  const gone = vi.fn()
  const Probe = defineComponent({
    setup: () => {
      onUnmounted(gone)
      return () => h('i', { class: 'abele-sample-probe' })
    },
  })
  afterEach(() => gone.mockClear())

  it('takes out the rows Obsidian dropped when it draws the next list, and all on close', () => {
    const parent = list()
    const rows = new SuggestionRows()
    const first = [item(parent), item(parent)]
    for (const el of first) rows.draw(el, { title: 'old' }, () => h(Probe))
    // Obsidian empties the list before it asks for the rows again.
    parent.replaceChildren()
    const next = item(parent)
    rows.draw(next, { title: 'new' }, () => h(Probe))
    expect(gone).toHaveBeenCalledTimes(2)
    expect(first.every((el) => el.childElementCount === 0)).toBe(true)
    rows.clear()
    expect(gone).toHaveBeenCalledTimes(3)
    expect(next.childElementCount).toBe(0)
  })

  it('redraws one row afresh, with the new icon', () => {
    const el = item(list())
    const rows = new SuggestionRows()
    rows.draw(el, { icon: 'tag', title: 'a' })
    rows.draw(el, { icon: 'git-branch', title: 'b' })
    expect(el.querySelectorAll('.suggestion-title')).toHaveLength(1)
    expect(el.querySelector('.suggestion-title')?.textContent).toBe('b')
  })
})
