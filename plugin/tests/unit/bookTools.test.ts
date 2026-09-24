/**
 * How the book tools name a book and who may read it (`src/ai/tools/BookTools.ts`), and what
 * "Ask here" puts in a new chat (`src/reader/askAboutBook.ts`). Reading real books is the e2e
 * tier's (`tests/e2e/bookAgent.e2e.test.ts`).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { namedBook } from '@/ai/tools/BookTools'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { bookChatText } from '@/reader/askAboutBook'
import { useVault } from '../helpers/testEnv'

beforeEach(() => {
  useVault([
    { path: 'Books/Dune.epub', content: '' },
    { path: 'Papers/Paper.pdf', content: '' },
    { path: 'Private/Diary.epub', content: '' },
    { path: 'Notes/Dune.md', content: '' },
  ])
  const scope = ScopeResolver.getInstance()
  scope.clear()
  scope.setFullVaultAccess(false)
  scope.addFolder('Books')
  scope.addFolder('Papers')
  scope.addFolder('Notes')
})

describe('a book named to a tool', () => {
  it('is found by its path, and by a link with a place in it', () => {
    expect(namedBook('Books/Dune.epub')).toMatchObject({
      file: { path: 'Books/Dune.epub' },
      place: null,
    })
    const linked = namedBook('[[Books/Dune.epub#cfi=/6/8!/4/2%5Bp%5D,/1:0,/1:22|Chapter 3]]')
    expect(linked.file.path).toBe('Books/Dune.epub')
    expect(linked.place).toEqual({ cfi: 'epubcfi(/6/8!/4/2[p],/1:0,/1:22)' })
    expect(namedBook('[p. 4](Papers/Paper.pdf#page=4)').place).toEqual({ page: 4 })
    expect(namedBook('Papers/Paper.pdf#page=2').place).toEqual({ page: 2 })
  })

  it('is refused outside the chat’s scope, as a note would be', () => {
    expect(() => namedBook('Private/Diary.epub')).toThrow(/Access denied/)
  })

  it('is refused when it is not a book, or not there', () => {
    expect(() => namedBook('Notes/Dune.md')).toThrow(/not a book/)
    expect(() => namedBook('Books/Missing.epub')).toThrow(/No book/)
    expect(() => namedBook('')).toThrow(/Name a book/)
  })
})

describe('"Ask here"', () => {
  it('puts the link and the words quoted under it in the chat, and leaves room to write', () => {
    expect(bookChatText('[[Dune.epub#cfi=/6/8!|Ch 3]]', 'Fear is\nthe mind-killer.')).toBe(
      '[[Dune.epub#cfi=/6/8!|Ch 3]]\n> Fear is\n> the mind-killer.\n\n'
    )
    expect(bookChatText('[[Dune.epub#page=2]]')).toBe('[[Dune.epub#page=2]] ')
  })
})
