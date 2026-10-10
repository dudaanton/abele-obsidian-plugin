/** The comparison's lines: what was removed, what was added, which words changed, what folds. */
import { describe, it, expect } from 'vitest'
import { diffLines, foldUnchanged, pairRows } from '@/components/diffModel'

const text = (line: { pieces: { text: string }[] }) => line.pieces.map((p) => p.text).join('')

describe('diffLines', () => {
  it('keeps unchanged lines and sets the removed line before the added one', () => {
    const lines = diffLines(
      '# Title\nAsk first.\nKeep notes.',
      '# Title\nCheck first.\nKeep notes.'
    )

    expect(lines.map((l) => [l.kind, text(l)])).toEqual([
      ['same', '# Title'],
      ['removed', 'Ask first.'],
      ['added', 'Check first.'],
      ['same', 'Keep notes.'],
    ])
    expect(lines[1].lineA).toBe(2)
    expect(lines[2].lineB).toBe(2)
    expect(lines[3]).toMatchObject({ lineA: 3, lineB: 3 })
  })

  it('leaves a wholly added or removed line unmarked, its colour already says it', () => {
    const lines = diffLines('a', 'a\nnew line')

    expect(lines[1]).toMatchObject({
      kind: 'added',
      pieces: [{ text: 'new line', changed: false }],
    })
  })

  it('marks the words that changed inside a changed line', () => {
    const [, removed, added] = diffLines('a\nAsk first.', 'a\nCheck first.')

    expect(
      removed.pieces
        .filter((p) => p.changed)
        .map((p) => p.text)
        .join('')
    ).toContain('Ask')
    expect(
      added.pieces
        .filter((p) => p.changed)
        .map((p) => p.text)
        .join('')
    ).toContain('Check')
    expect(added.pieces.some((p) => !p.changed && p.text.includes('first'))).toBe(true)
  })

  it('keeps an unchanged line unchanged when lines around it were replaced and added', () => {
    const lines = diffLines(
      't\nAsk first.\nKeep notes.',
      't\nCheck first.\nKeep notes.\nShow source.'
    )

    expect(lines.map((l) => [l.kind, text(l)])).toEqual([
      ['same', 't'],
      ['removed', 'Ask first.'],
      ['added', 'Check first.'],
      ['same', 'Keep notes.'],
      ['added', 'Show source.'],
    ])
  })

  it('marks a changed word whole, not the letters that differ', () => {
    const [, removed, added] = diffLines(
      't\nСпрашивать перед подключением.',
      't\nПроверить перед подключением.'
    )

    expect(removed.pieces.find((p) => p.changed)?.text).toBe('Спрашивать')
    expect(added.pieces.find((p) => p.changed)?.text).toBe('Проверить')
  })

  it('marks nothing on the side where a word was only inserted', () => {
    const [, removed, added] = diffLines('t\nв узкой панели', 't\nв узкой боковой панели')

    expect(removed.pieces.some((p) => p.changed)).toBe(false)
    expect(added.pieces.find((p) => p.changed)?.text.trim()).toBe('боковой')
  })

  it('handles lines added at the end and removed from the start', () => {
    expect(diffLines('a\nb', 'a\nb\nc').map((l) => [l.kind, text(l)])).toEqual([
      ['same', 'a'],
      ['same', 'b'],
      ['added', 'c'],
    ])
    expect(diffLines('x\na', 'a').map((l) => [l.kind, text(l)])).toEqual([
      ['removed', 'x'],
      ['same', 'a'],
    ])
  })

  it('has nothing but unchanged lines for equal texts, and one empty line for two empty ones', () => {
    expect(diffLines('a\nb', 'a\nb').every((l) => l.kind === 'same')).toBe(true)
    expect(diffLines('', '')).toEqual([
      { kind: 'same', pieces: [{ text: '', changed: false }], lineA: 1, lineB: 1 },
    ])
  })
})

describe('foldUnchanged', () => {
  it('folds a long unchanged run, keeping the lines next to a change', () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n')
    const after = before.replace('line 10', 'line ten')
    const rows = foldUnchanged(diffLines(before, after), 2)

    const folds = rows.filter((r) => r.kind === 'fold')
    expect(folds).toHaveLength(2)
    expect(rows[0].kind).toBe('fold')
    const visible = rows.filter((r) => r.kind !== 'fold')
    expect(visible.map((l) => text(l as never))).toEqual([
      'line 8',
      'line 9',
      'line 10',
      'line ten',
      'line 11',
      'line 12',
    ])
  })

  it('does not fold a run that would hide a single line', () => {
    const rows = foldUnchanged(diffLines('a\nb\nc\nd', 'a\nb\nc\nD'), 1)
    expect(rows.some((r) => r.kind === 'fold')).toBe(true)
    const short = foldUnchanged(diffLines('a\nb', 'a\nB'), 1)
    expect(short.some((r) => r.kind === 'fold')).toBe(false)
  })
})

describe('pairRows', () => {
  it('sets each removed line beside the added line that replaced it', () => {
    const pairs = pairRows(foldUnchanged(diffLines('a\nb\nc', 'a\nB\nC\nD')))

    expect(pairs[0]).toMatchObject({ kind: 'same' })
    const changes = pairs.filter((p) => p.kind === 'change')
    expect(changes.map((p) => [p.left && text(p.left), p.right && text(p.right)])).toEqual([
      ['b', 'B'],
      ['c', 'C'],
      [undefined, 'D'],
    ])
  })
})
