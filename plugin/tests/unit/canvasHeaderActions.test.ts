import { expect, it, vi } from 'vitest'
import { CanvasView } from '@/canvas/CanvasView'

vi.mock('obsidian', async (original) => {
  const api = await original<typeof import('../mocks/obsidian')>()
  return {
    ...api,
    EditableFileView: class extends api.EditableFileView {
      async onOpen() {}
    },
  }
})
vi.mock('@/canvas/adapter', () => ({ hostCanvasViewer: vi.fn(() => ({})) }))

it('distinguishes file and picture attachments in the canvas header', async () => {
  const icons = new Map<string, string>()
  const view = Object.assign(Object.create(CanvasView.prototype) as CanvasView, {
    contentEl: document.createElement('div'),
    addAction: (icon: string, title: string) => icons.set(title, icon),
  })
  await view.onOpen()
  expect(icons.get('Attach to a chat')).toBe('paperclip')
  expect(icons.get('Attach to the chat as a picture')).toBe('image-plus')
})
