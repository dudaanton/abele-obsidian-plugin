/**
 * Reading a link to lines of a note out of what an agent wrote or what a click landed on.
 */
import { describe, it, expect } from 'vitest'
import {
  clampRange,
  internalLinkInLine,
  lineSubpath,
  parseLineLink,
  parseLineSubpath,
} from '@/lineLinks/parse'

describe('the line subpath', () => {
  it('reads one line', () => {
    expect(parseLineSubpath('#L10')).toEqual({ from: 10, to: 10 })
  })

  it('reads a range, with or without the second L', () => {
    expect(parseLineSubpath('#L10-L12')).toEqual({ from: 10, to: 12 })
    expect(parseLineSubpath('#L10-12')).toEqual({ from: 10, to: 12 })
    expect(parseLineSubpath('L3-L4')).toEqual({ from: 3, to: 4 })
  })

  it('puts a backwards range the right way round', () => {
    expect(parseLineSubpath('#L12-L10')).toEqual({ from: 10, to: 12 })
  })

  it('takes line 0 as the first line', () => {
    expect(parseLineSubpath('#L0')).toEqual({ from: 1, to: 1 })
  })

  it('leaves headings and blocks alone', () => {
    expect(parseLineSubpath('#Launch plan')).toBeNull()
    expect(parseLineSubpath('#L10 notes')).toBeNull()
    expect(parseLineSubpath('#^block-id')).toBeNull()
    expect(parseLineSubpath('#Lx')).toBeNull()
  })

  it('writes the forms agents are told to use', () => {
    expect(lineSubpath({ from: 7, to: 7 })).toBe('#L7')
    expect(lineSubpath({ from: 7, to: 9 })).toBe('#L7-L9')
  })
})

describe('a link target', () => {
  it('splits a wikilink target into note and lines', () => {
    expect(parseLineLink('Projects/Budget#L10-L12')).toEqual({
      linkpath: 'Projects/Budget',
      lines: { from: 10, to: 12 },
    })
  })

  it('reads a markdown link target, encoded or not', () => {
    expect(parseLineLink('Projects/My%20Budget.md#L4')).toEqual({
      linkpath: 'Projects/My Budget.md',
      lines: { from: 4, to: 4 },
    })
    expect(parseLineLink('Projects/My Budget.md#L4')?.linkpath).toBe('Projects/My Budget.md')
  })

  it('is not a line link without a note, or with a heading', () => {
    expect(parseLineLink('#L10')).toBeNull()
    expect(parseLineLink('Budget#Summary')).toBeNull()
    expect(parseLineLink('Budget')).toBeNull()
  })
})

describe('the link under the pointer in a line of markdown', () => {
  const line = 'See [[Projects/Budget#L10-L12|the totals]] and [why](Notes/Why.md#L3) here'

  it('finds the wikilink the offset is in', () => {
    expect(internalLinkInLine(line, line.indexOf('the totals'))).toBe('Projects/Budget#L10-L12')
  })

  it('finds the markdown link the offset is in', () => {
    expect(internalLinkInLine(line, line.indexOf('why'))).toBe('Notes/Why.md#L3')
  })

  it('reads an angle-bracketed markdown target with spaces', () => {
    const text = '[x](<My Notes/A note.md#L2-L5>)'
    expect(internalLinkInLine(text, 1)).toBe('My Notes/A note.md#L2-L5')
  })

  it('finds nothing between links, in an embed or on a web link', () => {
    expect(internalLinkInLine(line, line.indexOf(' and ') + 2)).toBeNull()
    expect(internalLinkInLine('![[pic.png]]', 4)).toBeNull()
    expect(internalLinkInLine('[site](https://example.com#L1)', 2)).toBeNull()
  })
})

describe('a range past the end of the note', () => {
  it('ends at the last line', () => {
    expect(clampRange({ from: 40, to: 60 }, 42)).toEqual({ from: 40, to: 42 })
    expect(clampRange({ from: 90, to: 99 }, 42)).toEqual({ from: 42, to: 42 })
  })

  it('still names a line in an empty note', () => {
    expect(clampRange({ from: 3, to: 4 }, 0)).toEqual({ from: 1, to: 1 })
  })
})
