import { describe, it, expect } from 'vitest'
import { proseBlocks, proseText } from '@/columns/prose'
import { columnSource } from '@/columns/source'

describe('native column prose projection', () => {
  it.each(['math', 'picture'])('keeps an inline %s paragraph in the block map', (kind) => {
    const column = document.createElement('div')
    column.className = 'abele-column'
    if (kind === 'math')
      column.innerHTML =
        '<p>Result <span class="math"><span>generated equation</span></span>.</p><p>Edit here.</p>'
    else
      column.innerHTML =
        '<p>Result <span class="internal-embed"><img src="sample-image.png"></span>.</p><p>Edit here.</p>'
    const body = kind === 'math' ? 'Result $x$.' : 'Result ![[sample-image.png]].'
    const text =
      '> [!abele-columns]\n> > [!abele-column]\n> > ' +
      body +
      '\n> >\n> > Edit here.\n>\n> > [!abele-column]\n> > Right.'
    const source = columnSource(text, 0)!.columns[0]
    const blocks = proseBlocks(column)
    expect(blocks).toHaveLength(source.paragraphs.length)
    expect(blocks).toHaveLength(2)
    const range = document.createRange()
    range.selectNodeContents(blocks[0])
    expect(proseText(range)).toBe(source.paragraphs[0].text)
    expect(source.paragraphs[1].from).toBe(text.indexOf('Edit here.'))
  })
  it('does not include generated paragraphs inside an embed', () => {
    const column = document.createElement('div')
    column.className = 'abele-column'
    column.innerHTML = '<p>Text</p><div class="internal-embed"><p>Foreign text</p></div>'
    expect(proseBlocks(column)).toHaveLength(1)
  })
})
