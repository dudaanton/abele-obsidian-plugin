/**
 * Indent guides in code blocks: the depth of each line from the block's own step, guides kept
 * through blank lines, none where tabs and spaces are mixed; in reading mode, one span per line
 * with the highlighting kept and the text unchanged.
 */
import { describe, it, expect } from 'vitest'
// Installs Obsidian's DOM helpers (`doc.win.createSpan`) the drawing uses.
import 'obsidian'
import { guideDepths, indentStep } from '@/codeIndent/indentGuides'
import { drawReadingGuides } from '@/codeIndent/readingGuides'

describe('indent guides', () => {
  it('reads the step from the block: two spaces, four, tabs', () => {
    expect(indentStep(['a', '  b', '    c'], 4)).toBe(2)
    expect(indentStep(['a', '    b', '        c'], 4)).toBe(4)
    expect(guideDepths(['a', '\tb', '\t\tc'], 4)).toEqual([0, 1, 2])
  })

  it('falls back to the tab size when one stray space would make every column a level', () => {
    expect(indentStep(['a', ' b'], 4)).toBe(4)
  })

  it('runs the guides through a blank line inside a region, not past its end', () => {
    expect(guideDepths(['a', '    b', '', '    c', '', 'd'], 4)).toEqual([0, 1, 1, 1, 0, 0])
  })

  it('draws nothing on a line whose indent mixes tabs and spaces', () => {
    expect(guideDepths(['a', '    b', '\t    c'], 4)).toEqual([0, 1, 0])
  })
})

describe('drawReadingGuides', () => {
  it('guides a single indented line and aligns tabs to the vault size', () => {
    const code = document.createElement('code')
    code.textContent = '\tvalue\n'
    drawReadingGuides(code, 2)
    expect(code.querySelector('.abele-code-line')).not.toBeNull()
    expect(code.querySelector<HTMLElement>('.abele-code-line').style.tabSize).toBe('2')
    expect(code.textContent).toBe('\tvalue\n')
  })
  it('puts each line in its own span, keeping a token that spans lines and the text', () => {
    const code = document.createElement('code')
    code.innerHTML = 'a {\n  <span class="token comment">/* one\n  two */</span>\n}\n'
    const before = code.textContent
    drawReadingGuides(code, 4)
    const rows = [...code.querySelectorAll(':scope > .abele-code-line')] as HTMLElement[]
    expect(rows).toHaveLength(4)
    expect(code.textContent).toBe(before)
    expect(rows[2].querySelector('.token.comment')?.textContent).toBe('  two */')
    expect(rows[1].style.getPropertyValue('--abele-guide-depth')).toBe('1')
    expect(code.style.getPropertyValue('--abele-guide-step')).toBe('2ch')
  })

  it('leaves a block with no indent as it was', () => {
    const code = document.createElement('code')
    code.innerHTML = 'one\ntwo\n'
    drawReadingGuides(code, 4)
    expect(code.querySelector('.abele-code-line')).toBeNull()
  })
})
