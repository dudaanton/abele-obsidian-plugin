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
  it.each([
    '> Unassigned lead\n> > [!abele-column]\n> > Left\n>\n> > [!abele-column]\n> > Right',
    '> > [!abele-column]\n> > Left\n>\n> > [!abele-column]\n> > Right\n> Unassigned tail',
    '> > Unassigned deep text\n> > [!abele-column]\n> > Left\n>\n> > [!abele-column]\n> > Right',
  ])('does not offer source mutation when parent content is unaccounted for: %s', (body) => {
    const text = 'Before\n\n> [!abele-columns]\n' + body + '\n\nAfter'
    expect(findColumns(text, text.indexOf('Left'))).toBeNull()
  })

  it.each(['```not-a-close', '~~~not-a-close'])(
    'keeps fence-like content and child markers inside code: %s',
    (falseClose) => {
      const delimiter = falseClose[0].repeat(3)
      const body =
        delimiter + 'text\n' + falseClose + '\n[!abele-column]\nCode payload\n' + delimiter
      const text = createColumns(body, 'two')
      const record = findColumns(text, text.indexOf('Code payload'))!
      expect(record).not.toBeNull()
      expect(record.columns).toHaveLength(2)
      expect(record.columns[0].body.trimEnd()).toBe(body)
      expect(record.columns[1].from).toBe(text.lastIndexOf('> > [!abele-column]'))
      for (const changed of [
        changeColumns(text, record, { type: 'move', index: 0, to: 1 }),
        changeColumns(text, record, { type: 'options', ratio: [2, 1], mobile: 'stack' }),
      ])
        expect(removeColumns(changed, findColumns(changed, 0)!)).toContain(body)
    }
  )

  it.each([true, false])(
    'does not treat a quoted fenced example as an editable frame (closed=%s)',
    (closed) => {
      const frame = createColumns('Example body', 'two')
      const text = '> ```md\n' + frame + (closed ? '\n> ```' : '')
      expect(findColumns(text, text.indexOf('Example body'))).toBeNull()
    }
  )

  it('does not offer frame edits for a fenced example', () => {
    const text = '```md\n' + createColumns('Example', 'two') + '\n```'
    expect(findColumns(text, text.indexOf('Example'))).toBeNull()
  })
})
