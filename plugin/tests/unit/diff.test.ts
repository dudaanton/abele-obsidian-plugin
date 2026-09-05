/**
 * The line diff the version history draws with.
 *
 * `src/sync/diff.ts` is the daemon's `packages/cli/src/diff.ts`, copied because how a host
 * draws a change is presentation rather than engine. These are that file's own tests, adapted
 * to the plugin's import path, so the copy is held to the same behaviour the original is.
 */
import { describe, expect, it } from 'vitest'
import { diffLines, toLines, unifiedDiff } from '@/sync/diff'

const labels = { from: 'a', to: 'b' }
const lines = (n: number, prefix = 'line'): string =>
  Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`).join('\n')

describe('lines', () => {
  it('does not count the empty line a trailing newline leaves', () => {
    expect(toLines('one\ntwo\n')).toEqual(['one', 'two'])
    expect(toLines('one\ntwo')).toEqual(['one', 'two'])
  })

  it('reads an empty file as no lines, not as one blank one', () => {
    expect(toLines('')).toEqual([])
  })
})

describe('a unified diff', () => {
  it('is empty when the texts are the same', () => {
    expect(unifiedDiff('one\ntwo\n', 'one\ntwo\n', labels)).toEqual([])
  })

  it('shows one changed line with the lines around it', () => {
    const diff = unifiedDiff(`${lines(8)}\n`, `${lines(8).replace('line 4', 'edited')}\n`, labels)
    expect(diff[0]).toBe('--- a')
    expect(diff[1]).toBe('+++ b')
    expect(diff[2]).toBe('@@ -1,7 +1,7 @@')
    expect(diff).toContain('-line 4')
    expect(diff).toContain('+edited')
    expect(diff).toContain(' line 3')
    // Three lines of context on each side, and nothing of the eighth line beyond them.
    expect(diff).not.toContain(' line 8')
  })

  it('counts a pure addition from nothing on the left', () => {
    const diff = unifiedDiff('', 'hello\n', labels)
    expect(diff[2]).toBe('@@ -0,0 +1,1 @@')
    expect(diff.slice(3)).toEqual(['+hello'])
  })

  it('reports a deletion as a hunk with no lines on the right', () => {
    const diff = unifiedDiff('gone\n', '', labels)
    expect(diff[2]).toBe('@@ -1,1 +0,0 @@')
    expect(diff.slice(3)).toEqual(['-gone'])
  })

  it('has nothing to say about two versions that were both empty', () => {
    expect(unifiedDiff('', '', labels)).toEqual([])
  })

  it('splits changes that are far apart into two hunks', () => {
    const before = `${lines(40)}\n`
    const after = `${before.replace('line 2\n', 'edited 2\n').replace('line 39\n', 'edited 39\n')}`
    const diff = unifiedDiff(before, after, labels)
    expect(diff.filter((line) => line.startsWith('@@'))).toHaveLength(2)
  })

  it('keeps every line of both texts, in order', () => {
    const changes = diffLines(['a', 'b', 'c'], ['a', 'x', 'c'])
    expect(changes.map((change) => `${change.sign}${change.text}`)).toEqual([
      ' a',
      '-b',
      '+x',
      ' c',
    ])
  })

  /**
   * The labels are what tells a reader which side is which. On this screen they name the
   * version and the file as it stands, and a preview that lost them would be a wall of signs.
   */
  it('names both sides of the comparison', () => {
    const diff = unifiedDiff('one\n', 'two\n', { from: 'Notes/a.md #3', to: 'Notes/a.md now' })

    expect(diff[0]).toBe('--- Notes/a.md #3')
    expect(diff[1]).toBe('+++ Notes/a.md now')
  })
})
