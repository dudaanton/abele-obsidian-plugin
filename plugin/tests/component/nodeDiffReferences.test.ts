import { expect, it, vi } from 'vitest'
import { diffReferenceSymbol, installDiffReferences } from '@/node/diffReferences'
import { Menu } from 'obsidian'

it('maps an after-side symbol to its full-file position and rejects removed or stale lines', () => {
  const root = document.createElement('div')
  const row = document.createElement('div')
  row.className = 'abele-diff__line'
  row.dataset.lineB = '2'
  const text = document.createElement('span')
  text.className = 'abele-diff__text'
  text.textContent = '  sample()'
  row.append(text)
  root.append(row)
  document.body.append(root)
  const range = document.createRange()
  range.setStart(text.firstChild!, 4)
  range.collapse(true)
  const original = document.caretRangeFromPoint
  document.caretRangeFromPoint = vi.fn(() => range)
  const event = new MouseEvent('contextmenu', { clientX: 4, clientY: 4 })
  Object.defineProperty(event, 'target', { value: text })
  expect(diffReferenceSymbol(root, event, 'header\n  sample()')).toEqual({
    name: 'sample',
    position: { line: 1, character: 2 },
  })
  const run = vi.fn()
  const show = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
  const remove = installDiffReferences(root, () => 'header\n  sample()', run)
  text.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  const menu = show.mock.contexts.at(-1)!
  expect(menu.items.map((item) => item.title)).toEqual([
    'Go to definition of sample',
    'Find references to sample',
  ])
  menu.items[1].handler?.()
  expect(run).toHaveBeenCalledWith('references', {
    name: 'sample',
    position: { line: 1, character: 2 },
  })
  document.getSelection()?.removeAllRanges()
  document.getSelection()?.addRange(range)
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', shiftKey: true }))
  expect(run).toHaveBeenCalledTimes(2)
  remove()
  show.mockRestore()
  row.classList.add('abele-diff__line_removed')
  expect(diffReferenceSymbol(root, event, 'header\n  sample()')).toBeNull()
  row.classList.remove('abele-diff__line_removed')
  expect(diffReferenceSymbol(root, event, 'header\nchanged()')).toBeNull()
  document.caretRangeFromPoint = original
  document.getSelection()?.removeAllRanges()
  root.remove()
})
