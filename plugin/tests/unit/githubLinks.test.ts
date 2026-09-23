import { describe, it, expect } from 'vitest'
import { urlInLine, linkAtClick } from '@/github/links'

describe('urlInLine', () => {
  const md = 'see [the PR](https://github.com/o/r/pull/1/files#diff-abc) for more'

  it('reads a markdown link from anywhere on it, text included', () => {
    expect(urlInLine(md, md.indexOf('the PR'))).toBe('https://github.com/o/r/pull/1/files#diff-abc')
    expect(urlInLine(md, md.indexOf('diff-'))).toBe('https://github.com/o/r/pull/1/files#diff-abc')
  })

  it('finds nothing beside the link', () => {
    expect(urlInLine(md, 1)).toBeNull()
    expect(urlInLine(md, md.length - 1)).toBeNull()
  })

  it('reads a link with a title and one in angle brackets', () => {
    const titled = '[x](https://github.com/o/r/issues/2 "Issue")'
    expect(urlInLine(titled, 1)).toBe('https://github.com/o/r/issues/2')
    const angled = '[x](<https://github.com/o/r/issues/3>)'
    expect(urlInLine(angled, 1)).toBe('https://github.com/o/r/issues/3')
  })

  it('reads a bare URL without the full stop after it', () => {
    const bare = 'Fixed in https://github.com/o/r/pull/4.'
    expect(urlInLine(bare, bare.indexOf('pull'))).toBe('https://github.com/o/r/pull/4')
  })

  it('reads an autolink', () => {
    const auto = 'at <https://github.com/o/r/issues/5> ok'
    expect(urlInLine(auto, auto.indexOf('issues'))).toBe('https://github.com/o/r/issues/5')
  })

  it('tells two links on one line apart', () => {
    const two = '[a](https://github.com/o/r/issues/1) and [b](https://github.com/o/r/issues/2)'
    expect(urlInLine(two, two.indexOf('[b]') + 1)).toBe('https://github.com/o/r/issues/2')
  })
})

describe('linkAtClick on rendered markdown', () => {
  it('takes the href of an anchor, from a click on anything inside it', () => {
    const a = document.createElement('a')
    a.href = 'https://github.com/o/r/issues/1'
    a.className = 'external-link'
    const inner = document.createElement('span')
    a.appendChild(inner)
    expect(linkAtClick(inner)).toEqual({
      url: 'https://github.com/o/r/issues/1',
      sourceMode: false,
    })
  })

  it('ignores internal links and plain elements', () => {
    const a = document.createElement('a')
    a.setAttribute('href', 'Some note')
    expect(linkAtClick(a)).toBeNull()
    expect(linkAtClick(document.createElement('div'))).toBeNull()
  })
})
