/** Drawing registration coexists with other file-menu providers and unloads with the plugin. */
import { describe, expect, it, vi } from 'vitest'
import { Menu, TFolder, type Plugin } from 'obsidian'
import { registerDrawing } from '@/drawing/register'
import { newDrawing } from '@/drawing/files'

vi.mock('@/drawing/DrawingView', () => ({
  DRAWING_VIEW_TYPE: 'abele-drawing',
  DrawingView: class {},
}))
vi.mock('@/drawing/ImageInkView', () => ({
  IMAGE_INK_VIEW_TYPE: 'abele-image-ink',
  DRAWABLE_PICTURES: ['png'],
  ImageInkView: class {},
}))
vi.mock('@/drawing/files', () => ({
  adoptDrawingLeaves: vi.fn(),
  copyEmbed: vi.fn(),
  openImageInk: vi.fn(),
  insertDrawing: vi.fn(),
  isDrawingFile: vi.fn(),
  known: new Map(),
  newDrawing: vi.fn(),
}))
vi.mock('@/drawing/embed', () => ({
  drawingEmbedProcessor: vi.fn(),
  drawingEmbedsInEditor: vi.fn(),
}))
vi.mock('@/drawing/noteRenames', () => ({ followNoteRename: vi.fn() }))

type Listener = (...args: unknown[]) => void
function host() {
  const listeners = new Map<string, Set<Listener>>()
  const events = {
    on(name: string, fn: Listener) {
      const group = listeners.get(name) ?? new Set<Listener>()
      group.add(fn)
      listeners.set(name, group)
      return () => group.delete(fn)
    },
    trigger(name: string, ...args: unknown[]) {
      for (const fn of listeners.get(name) ?? []) fn(...args)
    },
  }
  const app = {
    workspace: { ...events, onLayoutReady: vi.fn() },
    vault: events,
  }
  function plugin() {
    const cleanup: (() => void)[] = []
    const p = {
      app,
      registerView: vi.fn(),
      registerMarkdownPostProcessor: vi.fn(),
      registerEditorExtension: vi.fn(),
      registerDomEvent: vi.fn(),
      addCommand: vi.fn(),
      register: (stop: () => void) => cleanup.push(stop),
      registerEvent: (stop: () => void) => cleanup.push(stop),
    }
    registerDrawing(p as unknown as Plugin)
    return () => cleanup.splice(0).forEach((stop) => stop())
  }
  const folder = Object.assign(new TFolder(), { path: 'sample-folder', name: 'sample-folder' })
  const menu = () => {
    const m = new Menu()
    events.trigger('file-menu', m, folder, 'file-explorer-context-menu')
    return m
  }
  return { events, plugin, folder, menu }
}

describe('the folder drawing menu', () => {
  it.each(['before', 'after'])(
    'distinguishes its drawing from another provider registered %s it',
    (order) => {
      const h = host()
      const other = () =>
        h.events.on('file-menu', (menu) => {
          ;(menu as Menu).addItem((item) => item.setTitle('New drawing').setIcon('other-drawing'))
        })
      if (order === 'before') other()
      const unload = h.plugin()
      if (order === 'after') other()
      try {
        const menu = h.menu()
        expect(menu.items.map((item) => item.title).sort()).toEqual([
          'New Abele drawing',
          'New drawing',
        ])
        const ours = menu.items.find((item) => item.title === 'New Abele drawing')!
        expect(ours.icon).toBe('pen-line')
        expect(ours.section).toBe('action-primary')
        ours.handler!()
        expect(newDrawing).toHaveBeenCalledWith(expect.anything(), h.folder)
      } finally {
        unload()
      }
    }
  )

  it('adds one item to each new menu and removes the handler on unload and re-enable', () => {
    const h = host()
    let unload = h.plugin()
    try {
      expect(h.menu().items).toHaveLength(1)
      expect(h.menu().items).toHaveLength(1)
      unload()
      expect(h.menu().items).toHaveLength(0)
      unload = h.plugin()
      expect(h.menu().items).toHaveLength(1)
    } finally {
      unload()
    }
  })
})
