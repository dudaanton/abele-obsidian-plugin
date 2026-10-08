import { describe, it, expect } from 'vitest'
import { proseAnchor, proseBlocks, proseText } from '@/columns/prose'
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
  it('does not jump past a trailing link for a DOM caret at the end of preceding prose', () => {
    const text =
      '> [!abele-columns]\n> > [!abele-column]\n> > Before [[Sample]]\n>\n> > [!abele-column]\n> > Right.'
    const block = document.createElement('p')
    block.innerHTML = 'Before <a class="internal-link">Sample</a>'
    const paragraph = columnSource(text, 0)!.columns[0].paragraphs[0]
    const caret = document.createRange()
    caret.selectNodeContents(block)
    caret.setEnd(block.firstChild!, 6)
    const complete = document.createRange()
    complete.selectNodeContents(block)
    // This reproduces the admitted exact-offset branch, without a layout mock.
    const count = proseText(caret).length
    expect(proseText(complete)).toBe(paragraph.text)
    const anchor = proseAnchor(paragraph, count)
    expect(anchor - text.lastIndexOf('\n', anchor - 1) - 1).toBe(10)
    caret.setEnd(block.firstChild!, 7)
    expect(proseAnchor(paragraph, proseText(caret).length) - text.indexOf('> > Before')).toBe(11)
  })

  it('does not include generated paragraphs inside an embed', () => {
    const column = document.createElement('div')
    column.className = 'abele-column'
    column.innerHTML = '<p>Text</p><div class="internal-embed"><p>Foreign text</p></div>'
    expect(proseBlocks(column)).toHaveLength(1)
  })
})
