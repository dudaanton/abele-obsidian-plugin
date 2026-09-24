/**
 * A snippet of GitHub code or a quoted comment, kept in a note as a fenced block.
 *
 * The block is the whole record: it is read offline and does not change when the repository
 * does. What is pinned here is that it reads back to what was written, that its code cannot
 * close its fence, that a diff keeps the numbers of both sides, and that its address still opens
 * the place it came from.
 */
import { describe, it, expect } from 'vitest'
import {
  SNIPPET_BLOCK,
  codeSnippet,
  commentSnippet,
  diffSnippet,
  formatSnippet,
  parseSnippet,
} from '@/github/snippetBlock'
import { parsePatch } from '@/github/patch'
import { parseGithubUrl } from '@/github/urls'

const inner = (block: string) => block.split('\n').slice(1, -1).join('\n')
const HOST = 'github.example.com'
const SHA = '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d'
const link = {
  label: 'acme/widgets@1a2b3c4 · src/app.ts:10–12',
  url: `https://${HOST}/acme/widgets/blob/${SHA}/src/app.ts#L10-L12`,
}

describe('a snippet of a file', () => {
  const text = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n')
  const snippet = codeSnippet(link, 'src/app.ts', text, { from: 10, to: 12 })

  it('keeps the lines, their first number and the language', () => {
    expect(snippet).toEqual({
      ...link,
      kind: 'code',
      lang: 'ts',
      start: 10,
      text: 'line 10\nline 11\nline 12',
    })
  })

  it('is written as a block that reads back to the same snippet', () => {
    const block = formatSnippet(snippet)
    expect(block.split('\n').slice(0, 5)).toEqual([
      '```abele-github',
      `url: ${link.url}`,
      `label: ${link.label}`,
      'lang: ts',
      'start: 10',
    ])
    expect(block.endsWith('\n---\nline 10\nline 11\nline 12\n```')).toBe(true)
    expect(parseSnippet(inner(block))).toEqual(snippet)
  })

  it('outgrows a fence in its own text, so the text cannot close the block', () => {
    const md = codeSnippet(
      { ...link, url: `https://${HOST}/acme/widgets/blob/${SHA}/README.md#L1-L3` },
      'README.md',
      'Example:\n````js\nx()',
      { from: 1, to: 3 }
    )
    const block = formatSnippet(md)
    expect(block.startsWith(`\`\`\`\`\`${SNIPPET_BLOCK}`)).toBe(true)
    expect(block.endsWith('\n`````')).toBe(true)
    expect(parseSnippet(inner(block))?.text).toBe('Example:\n````js\nx()')
  })

  it('keeps its address one the plugin opens at the same lines', () => {
    const back = parseSnippet(inner(formatSnippet(snippet)))!
    expect(parseGithubUrl(back.url, [HOST])).toMatchObject({
      kind: 'blob',
      lines: { start: 10, end: 12 },
    })
  })
})

describe('a snippet of a diff', () => {
  // Old 10..14, new 10..15.
  const lines = parsePatch(
    '@@ -10,5 +10,6 @@ class A\n a\n-b\n+c\n+d\n e\n f\n@@ -40,2 +41,2 @@\n x\n-y\n+z'
  )
  const dlink = {
    label: 'acme/widgets#42 · src/app.ts:11–12',
    url: `https://${HOST}/acme/widgets/pull/42/files#diff-${'a'.repeat(64)}R11-R12`,
  }

  it('writes the lines with their signs, under a header that carries both numbers', () => {
    const s = diffSnippet(dlink, 'src/app.ts', lines, { from: 3, to: 5 })
    expect(s).toMatchObject({ kind: 'diff', lang: 'ts' })
    expect(s.text).toBe('@@ -11 +11 @@\n-b\n+c\n+d')
    // Read back, the numbers are the file's, not the snippet's.
    const back = parsePatch(parseSnippet(inner(formatSnippet(s)))!.text)
    expect(back.map((l) => [l.type, l.old, l.new])).toEqual([
      ['hunk', undefined, undefined],
      ['del', 11, undefined],
      ['add', undefined, 11],
      ['add', undefined, 12],
    ])
  })

  it('starting on an added line, takes the old side from the line that follows', () => {
    const s = diffSnippet(dlink, 'src/app.ts', lines, { from: 4, to: 6 })
    expect(s.text).toBe('@@ -12 +11 @@\n+c\n+d\n e')
    expect(parsePatch(s.text).pop()).toMatchObject({ type: 'ctx', old: 12, new: 13 })
  })

  it('a range across two hunks keeps the second hunk header as it was', () => {
    const s = diffSnippet(dlink, 'src/app.ts', lines, { from: 6, to: 10 })
    expect(s.text).toBe('@@ -12 +13 @@\n e\n f\n@@ -40,2 +41,2 @@\n x\n-y')
  })

  it('in a new file, the old side starts where the hunk says: at 0', () => {
    const added = parsePatch('@@ -0,0 +1,3 @@\n+x\n+y\n+z')
    expect(diffSnippet(dlink, 'src/new.ts', added, { from: 3, to: 4 }).text).toBe(
      '@@ -0 +2 @@\n+y\n+z'
    )
  })

  it('writes `diff: true` in its header and reads it back', () => {
    const block = formatSnippet(diffSnippet(dlink, 'src/app.ts', lines, { from: 2, to: 2 }))
    expect(block).toContain('\ndiff: true\n')
    expect(parseSnippet(inner(block))?.kind).toBe('diff')
  })
})

describe('a quoted comment', () => {
  it('keeps who wrote it and when, then the comment itself as markdown', () => {
    const s = commentSnippet(
      {
        label: 'acme/widgets#42 · comment by alice',
        url: `https://${HOST}/acme/widgets/pull/42#issuecomment-5`,
      },
      {
        author: 'alice',
        createdAt: '2026-09-02T10:00:00Z',
        body: 'Looks **good**.\n\n```ts\nx()\n```',
      }
    )
    expect(s.kind).toBe('comment')
    expect(s.text.split('\n')[0]).toMatch(/^\*\*alice\*\* · .*2026/)
    const block = formatSnippet(s)
    expect(block).toContain('\ncomment: true\n')
    expect(block.startsWith('````abele-github')).toBe(true)
    expect(parseSnippet(inner(block))).toEqual(s)
  })
})

describe('a block edited by hand', () => {
  it('is refused when it has no address, no label or no separator', () => {
    expect(parseSnippet('label: x\n---\ncode')).toBeNull()
    expect(parseSnippet('url: https://github.com/a/b/issues/1\n---\ncode')).toBeNull()
    expect(parseSnippet('url: https://github.com/a/b/issues/1\nlabel: x\ncode')).toBeNull()
  })

  it('ignores a start that is not a number', () => {
    const s = parseSnippet(
      'url: https://github.com/a/b/blob/c/d.ts#L1\nlabel: x\nstart: soon\n---\nx'
    )
    expect(s?.start).toBeUndefined()
  })
})
