import { describe, it, expect } from 'vitest'
import { createColumns, findColumns, changeColumns, removeColumns } from '@/columns/operations'

describe('column frame operations', () => {
  it('inserts two or three columns with the selection in the first', () => {
    for (const kind of ['two', 'three', 'aside'] as const) {
      const text = createColumns('Selected **text**\n- [ ] Item', kind)
      const record = findColumns(text, 0)!
      expect(record.columns).toHaveLength(kind === 'three' ? 3 : 2)
      expect(removeColumns(text, record)).toContain('Selected **text**\n- [ ] Item')
      if (kind === 'aside') expect(text).toContain('role=aside')
    }
  })
  it('moves and adds columns without discarding code or nested quotes', () => {
    const original = createColumns('```js\nconst sample=1\n```\n> Nested quote', 'two')
    const moved = changeColumns(original, findColumns(original, 0)!, {
      type: 'move',
      index: 0,
      to: 1,
    })
    expect(findColumns(moved, 0)!.columns[1].body).toContain('const sample=1')
    const added = changeColumns(moved, findColumns(moved, 0)!, { type: 'add' })
    expect(findColumns(added, 0)!.columns).toHaveLength(3)
    expect(removeColumns(added, findColumns(added, 0)!)).toContain('> Nested quote')
  })
  it('changes ratio and narrow layout while preserving every body', () => {
    const text = createColumns('First', 'two')
    const r = findColumns(text, 0)!
    const changed = changeColumns(text, r, { type: 'options', ratio: [1.5, 1], mobile: 'keep' })
    expect(changed).toContain('ratio=1.5:1 mobile=keep')
    expect(findColumns(changed, 0)!.columns.map((c) => c.body)).toEqual(
      r.columns.map((c) => c.body)
    )
    expect(() =>
      changeColumns(text, r, { type: 'options', ratio: [1, 0], mobile: 'stack' })
    ).toThrow()
    expect(() =>
      changeColumns(text, r, { type: 'options', ratio: [1, 1, 1], mobile: 'stack' })
    ).toThrow()
  })
  it('removes only the frame and keeps titles and surrounding text', () => {
    const text =
      'Before\n\n> [!abele-columns] Group title\n> > [!abele-column] First title\n> > Left\n>\n> > [!abele-column] Second title\n> > Right\n\nAfter'
    const result = removeColumns(text, findColumns(text, text.indexOf('Left'))!)
    expect(result).toBe(
      'Before\n\nGroup title\n\nFirst title\nLeft\n\nSecond title\nRight\n\nAfter'
    )
  })
  it('does not offer frame edits for a fenced example', () => {
    const text = '```md\n' + createColumns('Example', 'two') + '\n```'
    expect(findColumns(text, text.indexOf('Example'))).toBeNull()
  })
})
