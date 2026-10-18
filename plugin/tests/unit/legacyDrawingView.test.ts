import { expect, it, vi } from 'vitest'
import { DrawingView } from '@/drawing/DrawingView'
import { drawingSvg } from '@/drawing/drawingFile'

it('restores a saved legacy tab as an image without an editing session or source writes', () => {
  const write = vi.fn()
  const contentEl = document.createElement('div')
  const view = Object.assign(Object.create(DrawingView.prototype) as DrawingView, {
    contentEl,
    file: { path: 'Sample.svg', basename: 'Sample', stat: { mtime: 1, size: 100 } },
    app: { vault: { getResourcePath: () => 'app://sample.svg', modify: write } },
  })
  const source = drawingSvg({ items: [] })
  view.setViewData(source, true)
  expect(view.getViewData()).toBe(source)
  expect(contentEl.querySelector('img')?.src).toBe('app://sample.svg?1-100')
  expect(contentEl.querySelector('canvas,button,input')).toBeNull()
  expect('session' in view).toBe(false)
  expect(write).not.toHaveBeenCalled()
  view.clear()
  expect(contentEl.childElementCount).toBe(0)
})
