/**
 * Where "Open file" on a diff lands: the file's address at a commit, and the line of the file a
 * line of the diff stands for.
 */
import { describe, it, expect } from 'vitest'
import { fileUrl, lineOnSide } from '@/github/permalinks'
import { parsePatch } from '@/github/patch'

const repo = { host: 'github.com', owner: 'o', repo: 'r' }
const SHA = 'a'.repeat(40)

describe('the address of a whole file', () => {
  it('is the file at the commit, with the line when one is given', () => {
    expect(fileUrl(repo, SHA, 'src/app.ts')).toBe(`https://github.com/o/r/blob/${SHA}/src/app.ts`)
    expect(fileUrl(repo, SHA, 'src/app.ts', 12)).toBe(
      `https://github.com/o/r/blob/${SHA}/src/app.ts#L12`
    )
  })

  it('opens a markdown file rendered, and as code when a line is asked for', () => {
    expect(fileUrl(repo, SHA, 'README.md')).toBe(`https://github.com/o/r/blob/${SHA}/README.md`)
    expect(fileUrl(repo, SHA, 'README.md', 3)).toBe(
      `https://github.com/o/r/blob/${SHA}/README.md?plain=1#L3`
    )
  })

  it('encodes each part of the path', () => {
    expect(fileUrl(repo, SHA, 'docs/a b#.ts')).toBe(
      `https://github.com/o/r/blob/${SHA}/docs/a%20b%23.ts`
    )
  })
})

describe('the line of the file a line of the diff stands for', () => {
  // 0 hunk, 1 " a" (1/1), 2 "-b" (old 2), 3 "+c" (new 2), 4 "+d" (new 3), 5 hunk, 6 " z" (10/11)
  const lines = parsePatch('@@ -1,2 +1,3 @@\n a\n-b\n+c\n+d\n@@ -10,1 +11,1 @@\n z')

  it('is its own number on that side', () => {
    expect(lineOnSide(lines, 3, 'new')).toBe(2)
    expect(lineOnSide(lines, 2, 'old')).toBe(2)
  })

  it('is the next line that has one, for a removed line or a hunk header', () => {
    expect(lineOnSide(lines, 2, 'new')).toBe(2)
    expect(lineOnSide(lines, 5, 'new')).toBe(11)
    expect(lineOnSide(lines, 0, 'new')).toBe(1)
  })

  it('is the one before, when nothing after has one', () => {
    const removedAtEnd = parsePatch('@@ -1,2 +1,1 @@\n a\n-b')
    expect(lineOnSide(removedAtEnd, 2, 'new')).toBe(1)
  })

  it('is nothing when that side has no lines at all', () => {
    const deleted = parsePatch('@@ -1,2 +0,0 @@\n-a\n-b')
    expect(lineOnSide(deleted, 1, 'new')).toBeUndefined()
    expect(lineOnSide(deleted, 1, 'old')).toBe(1)
  })
})
