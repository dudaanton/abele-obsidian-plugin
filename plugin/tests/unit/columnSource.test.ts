import { describe, expect, it } from 'vitest'
import { columnSource } from '@/columns/source'

describe('source positions inside column callouts', () => {
  it('maps identical passages by syntax position, not by their text', () => {
    const text =
      'Before.\n\n> [!abele-columns]\n> > [!abele-column]\n> > Same **bold** passage.\n>\n> > [!abele-column]\n> > Same **bold** passage.\n\nAfter.'
    const record = columnSource(text, text.indexOf('> [!'))!
    expect(record.columns.map((c) => c.paragraphs.map((p) => p.from))).toEqual([
      [text.indexOf('Same')],
      [text.lastIndexOf('Same')],
    ])
    expect(record.columns[1].paragraphs[0].positions).toEqual([
      ...Array.from({ length: 5 }, (_, i) => text.lastIndexOf('Same') + i),
      ...Array.from({ length: 4 }, (_, i) => text.lastIndexOf('Same') + 7 + i),
      ...Array.from({ length: 9 }, (_, i) => text.lastIndexOf('Same') + 13 + i),
    ])
  })

  it('retains offsets across continuation lines, nested lists and headings', () => {
    const text =
      '> [!abele-columns]\n> > [!abele-column]\n> > ## Heading\n> >\n> > First line\n> > continued.\n> >\n> > - List passage\n> >   - Nested passage\n>\n> > [!abele-column]\n> > Right.'
    const record = columnSource(text, 0)!
    expect(record.columns[0].paragraphs.map((p) => [p.tag, p.from])).toEqual([
      ['h2', text.indexOf('Heading')],
      ['p', text.indexOf('First line')],
      ['li', text.indexOf('List passage')],
      ['li', text.indexOf('Nested passage')],
    ])
    const paragraph = record.columns[0].paragraphs[1]
    expect(paragraph.positions[11]).toBe(text.indexOf('continued.'))
  })

  it('maps escaped syntax and entities while excluding native link and math controls', () => {
    const text =
      '> [!abele-columns]\n> > [!abele-column]\n> > Before [[Sample|Alias]] and [label](https://example.invalid) $x$ &copy; \\* ~~end~~.\n>\n> > [!abele-column]\n> > Right.'
    const p = columnSource(text, 0)!.columns[0].paragraphs[0]
    expect(p.positions[14]).toBe(text.indexOf('&copy;'))
    expect(p.positions.slice(-4)).toEqual([
      text.indexOf('end'),
      text.indexOf('end') + 1,
      text.indexOf('end') + 2,
      text.indexOf('~~.') + 2,
    ])
  })

  it('does not make columns out of examples in fences or merge separate records', () => {
    const example = '```md\n> [!abele-columns]\n> > [!abele-column]\n> > Sample.\n```'
    expect(columnSource(example, example.indexOf('>'))).toBeNull()
    expect(columnSource('> [!other]\n> > [!abele-column]\n> > Sample.', 0)).toBeNull()
  })
})
