/**
 * The compact forms an agent gets listings in lose nothing: each is read back — by a reader
 * written from the format, not from the code — into exactly what it was made from.
 */
import { describe, it, expect } from 'vitest'
import {
  groupByFolder,
  inlineValue,
  pathTree,
  propertiesLine,
  sharedProperties,
} from '@/ai/tools/compactListing'
import { estimateTokens } from '@/ai/tokens'
import { readGrouped, readProperties } from '../helpers/compactListing'

const PATHS = [
  'Root note.md',
  'Finance/Transactions/2026/03/Coffee (1).md',
  'Finance/Transactions/2026/03/Coffee 2026-03-06.md',
  'Finance/Transactions/2026/04/Rent.md',
  'Notes/A b/c — d.md',
  'Notes/x.canvas',
  'Finance/Transactions/2026/03/Late arrival.md',
  'Другое/Заметка.md',
]

describe('a list of paths as a tree', () => {
  it('reads back to every path, none added and none lost', () => {
    const tree = pathTree(PATHS)
    expect(
      readGrouped(tree)
        .map((r) => r.path)
        .sort()
    ).toEqual([...PATHS].sort())
  })

  it('says each folder once, with how many files it holds', () => {
    const tree = pathTree(PATHS)
    expect(tree.match(/^Finance\/Transactions\/2026\/03\/ \(3\)$/gm)).toHaveLength(1)
    expect(tree).toContain('/ (1)\n  Root note.md')
  })

  it('costs less than the flat list once folders repeat', () => {
    const many = Array.from({ length: 50 }, (_, i) => `Finance/Transactions/2026/03/Item ${i}.md`)
    expect(estimateTokens(pathTree(many))).toBeLessThan(estimateTokens(many.join('\n')) * 0.6)
  })

  it('keeps the order within a folder', () => {
    const rows = readGrouped(pathTree(['F/b.md', 'F/a.md']))
    expect(rows.map((r) => r.path)).toEqual(['F/b.md', 'F/a.md'])
  })
})

describe('rows grouped by folder', () => {
  it('carries every field of every row', () => {
    const items = PATHS.map((path, i) => ({ path, due: `2026-01-0${i + 1}`, n: String(i) }))
    const text = groupByFolder(
      items,
      (x) => x.path,
      (x, name) => [name, x.due, x.n].join(' | ')
    )
    const back = readGrouped(text)
    expect(back).toHaveLength(items.length)
    for (const item of items) {
      const row = back.find((r) => r.path === item.path)
      expect(row?.fields).toEqual([item.due, item.n])
    }
  })
})

describe('properties on one line', () => {
  const tricky: Record<string, unknown> = {
    type: 'task',
    created: '2026-07-31',
    hours: 0.87,
    done: false,
    count: '12',
    note: 'semi; colon',
    pipe: 'a | b',
    quote: 'say "hi"',
    spaced: ' padded ',
    empty: '',
    nothing: null,
    groups: ['[[Kyoto Trip]]', '[[A, B]]'],
    nested: { a: 1 },
    looksLikeList: '[not a list]',
    multi: 'line one\nline two',
  }

  it('reads back to the same values, types included', () => {
    expect(readProperties(propertiesLine(tricky, new Set()))).toEqual(tricky)
  })

  it('writes a plain string bare', () => {
    expect(inlineValue('Washington Trip')).toBe('Washington Trip')
    expect(inlineValue('12')).toBe('"12"')
  })

  it('leaves out what is said elsewhere', () => {
    expect(propertiesLine({ type: 'task', due: 'x' }, new Set(['type']))).toBe('due: x')
  })

  it('finds what every file shares, and only that', () => {
    expect(
      sharedProperties([
        { type: 'task', groups: ['[[A]]'], due: '1' },
        { type: 'task', groups: ['[[A]]'], due: '2' },
      ])
    ).toEqual({ type: 'task', groups: ['[[A]]'] })
    expect(sharedProperties([{ type: 'task' }])).toEqual({})
    expect(sharedProperties([{ type: 'task' }, {}])).toEqual({})
  })
})
