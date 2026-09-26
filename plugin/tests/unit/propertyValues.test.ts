/**
 * What a File, Files or cover property says, read without a vault.
 */
import { describe, it, expect } from 'vitest'
import {
  fileEntries,
  fileKind,
  isCoverKey,
  isWikilink,
  linkTarget,
  withEntry,
  withoutEntry,
} from '@/properties/values'

describe('linkTarget', () => {
  it.each([
    ['[[Books/Dune.epub]]', 'Books/Dune.epub'],
    ['[[Books/Dune.epub|Dune]]', 'Books/Dune.epub'],
    ['![[poster.jpg|300]]', 'poster.jpg'],
    ['[[Notes/Idea#Heading]]', 'Notes/Idea'],
    ['Media/poster.jpg', 'Media/poster.jpg'],
    ['  Media/poster.jpg  ', 'Media/poster.jpg'],
  ])('%s points at %s', (value, target) => {
    expect(linkTarget(value)).toBe(target)
  })

  it.each([null, undefined, '', '   ', 42, ['[[a]]']])('%j points nowhere', (value) => {
    expect(linkTarget(value)).toBeNull()
  })
})

describe('isWikilink', () => {
  it('tells a link from a path', () => {
    expect(isWikilink('[[Wallet]]')).toBe(true)
    expect(isWikilink('![[a.png]]')).toBe(true)
    expect(isWikilink('Wallet')).toBe(false)
    expect(isWikilink('see [[Wallet]]')).toBe(false)
    expect(isWikilink(3)).toBe(false)
  })
})

describe('fileEntries', () => {
  it('reads a list, a single entry, or nothing', () => {
    expect(fileEntries(['[[a.pdf]]', '', 'b.png', 3])).toEqual(['[[a.pdf]]', 'b.png'])
    expect(fileEntries('[[a.pdf]]')).toEqual(['[[a.pdf]]'])
    expect(fileEntries(null)).toEqual([])
    expect(fileEntries(undefined)).toEqual([])
  })
})

describe('editing a list of files', () => {
  it('adds at the end, and not a second link to the same file', () => {
    expect(withEntry(['[[a.pdf]]'], '[[b.png]]')).toEqual(['[[a.pdf]]', '[[b.png]]'])
    expect(withEntry(['[[a.pdf]]'], '[[a.pdf|A]]')).toEqual(['[[a.pdf]]'])
  })

  it('removes the one at its place', () => {
    expect(withoutEntry(['a', 'b', 'c'], 1)).toEqual(['a', 'c'])
  })
})

describe('fileKind', () => {
  it.each([
    ['PNG', 'image'],
    ['epub', 'epub'],
    ['pdf', 'pdf'],
    ['md', 'note'],
    ['mp3', 'audio'],
    ['mp4', 'video'],
    ['zip', 'other'],
  ])('.%s is %s', (ext, kind) => {
    expect(fileKind(ext)).toBe(kind)
  })
})

describe('isCoverKey', () => {
  it('is the cover property whatever its case', () => {
    expect(isCoverKey('cover')).toBe(true)
    expect(isCoverKey('Cover')).toBe(true)
    expect(isCoverKey('covers')).toBe(false)
  })
})
