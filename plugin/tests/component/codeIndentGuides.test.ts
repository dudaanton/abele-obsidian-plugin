/**
 * Indent guides in code blocks: the depth of each line from the block's own step, guides kept
 * through blank lines, none where tabs and spaces are mixed; in reading mode, one span per line
 * with the highlighting kept and the text unchanged.
 */
import { describe, it, expect, vi } from 'vitest'
// Installs Obsidian's DOM helpers (`doc.win.createSpan`) the drawing uses.
import 'obsidian'
import { guideDepths, indentStep } from '@/codeIndent/indentGuides'
import {
  clearReadingGuides,
  copyReadingGuides,
  drawReadingGuides,
} from '@/codeIndent/readingGuides'

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
  it('retains the terminal newline without adding a layout break and copies the exact source', () => {
    const code = document.createElement('code')
    code.textContent = 'a\n  b\n\n  c\n'
    drawReadingGuides(code, 4)
    expect(code.querySelectorAll('br')).toHaveLength(0)
    expect(code.textContent).toBe('a\n  b\n\n  c\n')
    const pre = document.createElement('pre')
    pre.append(code)
    document.body.append(pre)
    document.addEventListener('copy', copyReadingGuides)
    const range = document.createRange()
    range.selectNodeContents(code)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    const copy = new Event('copy', { bubbles: true, cancelable: true })
    const setData = vi.fn()
    Object.defineProperty(copy, 'clipboardData', { value: { setData } })
    document.dispatchEvent(copy)
    expect(setData).toHaveBeenCalledWith('text/plain', 'a\n  b\n\n  c\n')
    expect(setData).toHaveBeenCalledWith('text/html', expect.stringContaining('abele-code-line'))
    expect(copy.defaultPrevented).toBe(true)
    expect(selection.getRangeAt(0).toString()).toBe(code.textContent)
    range.setStart(code.firstChild.firstChild, 1)
    range.setEnd(code.children[1].firstChild, 3)
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(copy)
    expect(setData).toHaveBeenCalledWith('text/plain', '\n  b')
    selection.removeAllRanges()
    clearReadingGuides(code)
    setData.mockClear()
    document.dispatchEvent(copy)
    expect(setData).not.toHaveBeenCalled()
    pre.remove()
    document.removeEventListener('copy', copyReadingGuides)
  })
  it('guides a single indented line and aligns tabs to the vault size', () => {
    const code = document.createElement('code')
    code.textContent = '\tvalue\n'
    drawReadingGuides(code, 2)
    expect(code.querySelector('.abele-code-line')).not.toBeNull()
    expect(code.querySelector<HTMLElement>('.abele-code-line').style.tabSize).toBe('2')
    expect(code.textContent).toBe('\tvalue\n')
  })
  it('delegates rich copy across blocks and ignores selections outside a single guided block', () => {
    const pre = document.createElement('pre')
    const code = document.createElement('code')
    const token = document.createElement('span')
    token.className = 'token keyword'
    token.textContent = '  value'
    code.append(token, '\n')
    pre.append(code)
    document.body.append(pre)
    drawReadingGuides(code, 4)
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(code)
    selection.removeAllRanges()
    selection.addRange(range)
    const copy = new Event('copy', { cancelable: true })
    const setData = vi.fn()
    Object.defineProperty(copy, 'clipboardData', { value: { setData } })
    document.addEventListener('copy', copyReadingGuides)
    try {
      document.dispatchEvent(copy)
      expect(setData).toHaveBeenCalledWith('text/plain', '  value\n')
      expect(setData).toHaveBeenCalledWith(
        'text/html',
        expect.stringContaining('class="token keyword"')
      )
      setData.mockClear()
      range.selectNodeContents(pre)
      selection.removeAllRanges()
      selection.addRange(range)
      document.dispatchEvent(copy)
      expect(setData).not.toHaveBeenCalled()
    } finally {
      selection.removeAllRanges()
      document.removeEventListener('copy', copyReadingGuides)
      pre.remove()
    }
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
