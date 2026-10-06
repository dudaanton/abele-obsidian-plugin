import { afterEach, describe, expect, it, vi } from 'vitest'
import { Platform, type WorkspaceLeaf } from 'obsidian'
import { DeckView } from '@/slides/DeckView'
import { DeckViewer } from '@/slides/core/DeckViewer'
import { parseDeck } from '@/slides/core/markdown'
import { mobilePresentation } from '@/slides/mobilePresentation'

const viewers: DeckViewer[] = []
afterEach(() => {
  viewers.splice(0).forEach((viewer) => viewer.destroy())
  vi.restoreAllMocks()
  Platform.isMobile = false
  document.body.replaceChildren()
})

async function setup(mobile = true) {
  Platform.isMobile = mobile
  const callbacks = new Map<string, (...args: unknown[]) => void>()
  const containerEl = document.body.appendChild(document.createElement('div'))
  const contentEl = containerEl.appendChild(document.createElement('div'))
  // Happy DOM does not measure layout; model the leaf's tab container, not the body overlay.
  Object.defineProperty(containerEl, 'offsetParent', {
    configurable: true,
    get: () => document.body,
  })
  let visible = true
  const bridge = {
    getInfo: vi.fn(async () => ({ visible })),
    hide: vi.fn(async () => {
      visible = false
    }),
    show: vi.fn(async () => {
      visible = true
    }),
  }
  const viewer = new DeckViewer(
    contentEl,
    { render: async () => () => {} },
    {
      resolve: () => null,
      readCss: async () => '',
    },
    { presentationHost: mobilePresentation({ Capacitor: { Plugins: { StatusBar: bridge } } }) }
  )
  viewers.push(viewer)
  await viewer.setDeck(parseDeck('# Sample show'))
  const leaf = {} as WorkspaceLeaf
  const view = Object.assign(Object.create(DeckView.prototype) as DeckView, {
    app: {
      workspace: {
        on: (name: string, callback: (...args: unknown[]) => void) => {
          callbacks.set(name, callback)
          return {}
        },
      },
    },
    leaf,
    containerEl,
    contentEl,
    viewer,
    show: null,
    follower: { stop: vi.fn(), invalidate: vi.fn() },
    updateTimer: 0,
  })
  leaf.view = view
  await view.onOpen()
  await viewer.present(false)
  await vi.waitFor(() => expect(bridge.hide).toHaveBeenCalledTimes(1))
  return {
    view,
    viewer,
    leaf,
    containerEl,
    bridge,
    visible: () => visible,
    emit: (name: string, ...args: unknown[]) => callbacks.get(name)?.(...args),
  }
}

describe('mobile show foreground lifetime', () => {
  it.each(['tab switch', 'sidebar navigation', 'no active leaf'])(
    'ends Play on %s',
    async (navigation) => {
      const s = await setup()
      s.emit('active-leaf-change', s.leaf)
      expect(s.viewer.root.parentElement).toBe(document.body)
      s.emit('active-leaf-change', navigation === 'no active leaf' ? null : { view: {} })
      expect(s.viewer.root.parentElement).toBe(s.view.contentEl)
      expect(s.viewer.root.classList.contains('abele-deck-presenting')).toBe(false)
      await vi.waitFor(() => expect(s.visible()).toBe(true))
      expect(s.bridge.show).toHaveBeenCalledTimes(1)
      s.emit('active-leaf-change', s.leaf)
      expect(s.viewer.root.classList.contains('abele-deck-presenting')).toBe(false)
    }
  )

  it.each(['hidden', 'detached', 'replaced'])(
    'ends Play when its leaf is %s without an active-leaf event',
    async (change) => {
      const s = await setup()
      s.emit('layout-change')
      expect(s.viewer.root.parentElement).toBe(document.body)
      if (change === 'hidden') vi.spyOn(s.containerEl, 'offsetParent', 'get').mockReturnValue(null)
      if (change === 'detached') s.containerEl.remove()
      if (change === 'replaced') s.leaf.view = {} as never
      s.emit('layout-change')
      expect(s.viewer.root.parentElement).toBe(s.view.contentEl)
      await vi.waitFor(() => expect(s.visible()).toBe(true))
    }
  )

  it('ends the local presenter as well as Play when navigating away', async () => {
    const s = await setup()
    const end = vi.fn(() => {
      s.view.show = null
    })
    s.view.show = { end } as never
    s.emit('active-leaf-change', { view: {} })
    expect(end).toHaveBeenCalledTimes(1)
    expect(s.viewer.root.parentElement).toBe(s.view.contentEl)
    await vi.waitFor(() => expect(s.visible()).toBe(true))
  })

  it('does not end a desktop audience when the presenter becomes active', async () => {
    const s = await setup(false)
    const end = vi.fn()
    s.view.show = { end } as never
    s.emit('active-leaf-change', { view: {} })
    s.emit('layout-change')
    expect(end).not.toHaveBeenCalled()
    expect(s.viewer.root.parentElement).toBe(document.body)
  })
})
