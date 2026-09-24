/**
 * The contents and progress a book tab shows (`src/reader/model.ts`).
 */
import { describe, it, expect } from 'vitest'
import { pathTo, percent, tocEntries } from '@/reader/model'

const toc = tocEntries([
  { label: ' One ', href: 'c1.xhtml', subitems: [{ label: 'Part two', href: 'c1.xhtml#s2' }] },
  { label: '', href: 'c2.xhtml' },
])

describe('the contents of a book', () => {
  it('become a tree with keys unique in it, and a name for an entry without one', () => {
    expect(toc.map((e) => [e.key, e.label])).toEqual([
      ['0', 'One'],
      ['1', 'Untitled'],
    ])
    expect(toc[0].children[0].key).toBe('0.0')
  })

  it('lead to the entry of the page on screen through every entry above it', () => {
    expect(pathTo(toc, 'c1.xhtml#s2')).toEqual(['0', '0.0'])
    expect(pathTo(toc, 'c2.xhtml')).toEqual(['1'])
    expect(pathTo(toc, 'nowhere')).toEqual([])
    expect(pathTo(toc, null)).toEqual([])
  })
})

describe('how far into the book', () => {
  it('reads 100% only at the very end', () => {
    expect(percent(0)).toBe('0%')
    expect(percent(0.999)).toBe('99%')
    expect(percent(1)).toBe('100%')
    expect(percent(Number.NaN)).toBe('0%')
    expect(percent(2)).toBe('100%')
  })
})
