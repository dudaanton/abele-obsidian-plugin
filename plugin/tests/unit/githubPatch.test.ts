import { describe, it, expect } from 'vitest'
import { parsePatch, linesFor } from '@/github/patch'

const PATCH = [
  '@@ -10,4 +10,5 @@ function a() {',
  ' keep',
  '-old one',
  '+new one',
  '+added',
  ' tail',
  '@@ -40,2 +41,2 @@',
  '-gone',
  '+here',
  '\\ No newline at end of file',
].join('\n')

describe('parsePatch', () => {
  it('numbers each side the way GitHub does', () => {
    const lines = parsePatch(PATCH)
    expect(lines.map((l) => [l.type, l.old, l.new])).toEqual([
      ['hunk', undefined, undefined],
      ['ctx', 10, 10],
      ['del', 11, undefined],
      ['add', undefined, 11],
      ['add', undefined, 12],
      ['ctx', 12, 13],
      ['hunk', undefined, undefined],
      ['del', 40, undefined],
      ['add', undefined, 41],
      ['note', undefined, undefined],
    ])
    expect(lines[2].text).toBe('old one')
  })

  it('drops the empty line a trailing newline leaves', () => {
    expect(parsePatch('@@ -1 +1 @@\n a\n').map((l) => l.type)).toEqual(['hunk', 'ctx'])
  })
})

describe('linesFor', () => {
  const lines = parsePatch(PATCH)

  it('finds a new-side range', () => {
    expect(linesFor(lines, 'R', 11, 12)).toEqual([3, 4])
  })

  it('finds an old-side line', () => {
    expect(linesFor(lines, 'L', 40)).toEqual([7])
  })

  it('finds nothing in a fold', () => {
    expect(linesFor(lines, 'R', 25)).toEqual([])
  })
})
