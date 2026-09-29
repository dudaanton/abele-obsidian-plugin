/**
 * How the lists under a note were left — pages drawn, tasks opened — kept per note, so the note
 * comes back with the row the reader was on drawn and in the same spot.
 */
import { describe, it, expect } from 'vitest'
import {
  FOOTER_VIEW_LIMIT,
  MAX_RESTORED_PAGES,
  footerViewFrom,
  isOpen,
  pagesOf,
  renameFooterView,
  setOpen,
  setPages,
} from '@/helpers/footerView'

describe('the pages of a list under a note', () => {
  it('start at one, and come back as they were left, within the limit', () => {
    let s = setPages({}, 'a.md', 'tasks', 3)
    expect(pagesOf(s, 'a.md', 'tasks')).toBe(3)
    expect(pagesOf(s, 'a.md', 'logs')).toBe(1)
    expect(pagesOf(s, 'b.md', 'tasks')).toBe(1)
    s = setPages(s, 'a.md', 'tasks', 50)
    expect(pagesOf(s, 'a.md', 'tasks')).toBe(MAX_RESTORED_PAGES)
  })

  it('leave no entry on the first page, and the same record when nothing changed', () => {
    const s = setPages({}, 'a.md', 'tasks', 2)
    expect(setPages(s, 'a.md', 'tasks', 2)).toBe(s)
    expect(setPages(s, 'a.md', 'tasks', 1)).toEqual({})
  })
})

describe('the tasks opened under a note', () => {
  it('are kept per note, and closing one forgets it', () => {
    let s = setOpen({}, 'a.md', 'Tasks/one.md', true)
    s = setOpen(s, 'a.md', 'Tasks/two.md', true)
    expect(isOpen(s, 'a.md', 'Tasks/one.md')).toBe(true)
    expect(isOpen(s, 'b.md', 'Tasks/one.md')).toBe(false)
    s = setOpen(s, 'a.md', 'Tasks/one.md', false)
    s = setOpen(s, 'a.md', 'Tasks/two.md', false)
    expect(s).toEqual({})
  })
})

describe('the record', () => {
  it('follows a note that moved', () => {
    const s = setOpen(setPages({}, 'a.md', 'logs', 2), 'a.md', 'T.md', true)
    const moved = renameFooterView(s, 'a.md', 'b.md')
    expect(pagesOf(moved, 'b.md', 'logs')).toBe(2)
    expect(isOpen(moved, 'b.md', 'T.md')).toBe(true)
    expect(moved['a.md']).toBeUndefined()
    expect(renameFooterView(s, 'x.md', 'y.md')).toBe(s)
  })

  it('forgets the note touched longest ago past its limit', () => {
    let s = {}
    for (let i = 0; i <= FOOTER_VIEW_LIMIT; i++) s = setPages(s, `n${i}.md`, 'tasks', 2)
    expect(Object.keys(s)).toHaveLength(FOOTER_VIEW_LIMIT)
    expect(pagesOf(s, 'n0.md', 'tasks')).toBe(1)
  })

  it('reads back only what it could have written', () => {
    expect(
      footerViewFrom({
        'a.md': { pages: { tasks: 3, nope: 4, logs: 'x', chats: 1 }, open: ['T.md', 5] },
        'b.md': 'junk',
        'c.md': { pages: {}, open: [] },
      })
    ).toEqual({ 'a.md': { pages: { tasks: 3 }, open: ['T.md'] } })
    expect(footerViewFrom(null)).toEqual({})
  })
})
