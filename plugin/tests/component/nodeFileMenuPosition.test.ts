import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import FileView from '@/components/nodeWork/FileView.vue'
import { nodePathMenuPosition } from '@/node/nodePathMenuPosition'

vi.mock('@/github/codeViewer', () => ({ mountCode: vi.fn(() => ({ destroy: vi.fn() })) }))
afterEach(() => vi.restoreAllMocks())

describe('node file context menu position', () => {
  it.each(['mouse', 'touch', 'pen'])(
    'anchors a %s context menu at the line instead of the viewer bottom',
    (pointerType) => {
      const position = vi.fn()
      const view = mount(FileView, {
        props: {
          path: 'sample.ts',
          text: 'const sample = 1',
          onMenu: (e: MouseEvent) => position(nodePathMenuPosition(e)),
        },
      })
      const line = document.createElement('div')
      line.className = 'cm-line'
      view.get('.abele-file-view__code').element.append(line)
      vi.spyOn(line, 'getBoundingClientRect').mockReturnValue({ left: 40, bottom: 136 } as DOMRect)
      vi.spyOn(view.element, 'getBoundingClientRect').mockReturnValue({
        left: 20,
        bottom: 900,
      } as DOMRect)
      const event = new MouseEvent('contextmenu', {
        bubbles: true,
        clientX: 84,
        clientY: 124,
        detail: 0,
      })
      Object.defineProperty(event, 'pointerType', { value: pointerType })
      line.dispatchEvent(event)
      expect(position).toHaveBeenCalledWith({ x: 84, y: pointerType === 'touch' ? 136 : 124 })
      view.unmount()
    }
  )

  it('anchors keyboard invocation below the focused control', () => {
    const control = document.createElement('button')
    const position = vi.fn()
    vi.spyOn(control, 'getBoundingClientRect').mockReturnValue({ left: 30, bottom: 64 } as DOMRect)
    control.addEventListener('click', (e) => position(nodePathMenuPosition(e)))
    control.click()
    expect(position).toHaveBeenCalledWith({ x: 30, y: 64 })
  })
})
