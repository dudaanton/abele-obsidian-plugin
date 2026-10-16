import type { ItemView, Menu, Plugin, View, WorkspaceLeaf } from 'obsidian'
import { defineComponent, h, reactive } from 'vue'
import { mountKit, type KitMount } from '@/components/obsidian/mount'
import ZenOverlay from '@/components/zen/ZenOverlay.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { zenWide, zenWidth } from './zenLayout'
import { zenEscapeBlocked, zenSettings } from './zenSession'

interface WindowZen {
  key: string
  leaf?: WorkspaceLeaf
  view?: View
  mount?: KitMount
  action?: HTMLElement
  activeEl?: Element
  dispose(): void
  props: {
    width: number
    wide: boolean
    document: Document
    'onUpdate:width': (width: number) => void
  }
}

/** One controller per plugin, with an independent session in every Obsidian window. */
export function registerZen(plugin: Plugin): void {
  const workspace = plugin.app.workspace
  const config = AbeleConfig.getInstance()
  config.zen = zenSettings(config.zen)
  const windows = new Map<Document, WindowZen>()
  const menus = new WeakSet<Menu>()
  const patched = new Map<View, View['onPaneMenu']>()
  const moving = new WeakSet<WorkspaceLeaf>()
  let alive = true
  const save = () => {
    void config.saveSettings()
  }
  const unmount = (state: WindowZen) => {
    state.mount?.unmount()
    state.mount = undefined
    state.action?.remove()
    state.action = undefined
    state.activeEl?.classList.remove('abele-zen-active')
    state.activeEl = undefined
  }
  const session = (leaf: WorkspaceLeaf): WindowZen => {
    const doc = leaf.view.containerEl.ownerDocument
    let state = windows.get(doc)
    if (state) return state
    // Workspace container ids are also serialized in Obsidian's saved layout.
    const container = leaf.getContainer() as ReturnType<WorkspaceLeaf['getContainer']> & {
      id?: string
    }
    const key = doc === document ? 'main' : (container.id ?? `window-${windows.size}`)
    state = {
      key,
      dispose: () => {},
      props: reactive({
        width: config.zen.width,
        wide: false,
        document: doc,
        'onUpdate:width': (width: number) => {
          config.zen.width = width
          for (const [otherDoc, other] of windows)
            other.props.width = zenWidth(width, otherDoc.defaultView!.innerWidth)
          save()
        },
      }),
    }
    windows.set(doc, state)
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !config.zen.windows[key]) return
      const blocked = zenEscapeBlocked(doc)
      // Let the view and its own search/selection handlers consume Escape first.
      queueMicrotask(() => {
        if (blocked || event.defaultPrevented) return
        config.zen.windows[key] = false
        unmount(state!)
        save()
      })
    }
    doc.addEventListener('keydown', onKey, true)
    const resize = () => {
      state!.props.width = zenWidth(config.zen.width, doc.defaultView!.innerWidth)
    }
    doc.defaultView!.addEventListener('resize', resize)
    state.dispose = () => {
      doc.removeEventListener('keydown', onKey, true)
      doc.defaultView?.removeEventListener('resize', resize)
    }
    return state
  }
  const show = (leaf: WorkspaceLeaf) => {
    if (!alive) return
    const state = session(leaf)
    if (!config.zen.windows[state.key]) return
    if (leaf.getRoot() === workspace.leftSplit || leaf.getRoot() === workspace.rightSplit) {
      if (moving.has(leaf)) return
      moving.add(leaf)
      const tab = workspace.getLeaf('tab')
      void tab
        .setViewState(leaf.getViewState())
        .then(() => {
          if (!alive) return
          workspace.setActiveLeaf(tab, { focus: true })
          leaf.detach()
          show(tab)
        })
        .catch((error: unknown) => console.error('[Abele zen] Could not move sidebar view', error))
        .finally(() => moving.delete(leaf))
      return
    }
    const doc = leaf.view.containerEl.ownerDocument
    if (state.leaf === leaf && state.view === leaf.view && state.mount) return
    unmount(state)
    state.leaf = leaf
    state.view = leaf.view
    state.props.wide = zenWide(leaf.view.getViewType())
    state.props.width = zenWidth(config.zen.width, doc.defaultView!.innerWidth)
    const host = doc.body.createDiv()
    leaf.view.containerEl.append(host)
    state.activeEl = leaf.view.containerEl.closest('.workspace-leaf') ?? undefined
    state.activeEl?.classList.add('abele-zen-active')
    state.mount = mountKit(
      host,
      defineComponent({ setup: () => () => h(ZenOverlay, state.props) }),
      null,
      { remove: true }
    )
    state.action = (leaf.view as ItemView).addAction?.('minimize-2', 'Exit zen mode', () => {
      config.zen.windows[state.key] = false
      unmount(state)
      save()
    })
  }
  const toggle = async (leaf: WorkspaceLeaf | null) => {
    if (!leaf) return
    const state = session(leaf)
    const on = !config.zen.windows[state.key]
    if (on && (leaf.getRoot() === workspace.leftSplit || leaf.getRoot() === workspace.rightSplit)) {
      const previous = leaf
      leaf = workspace.getLeaf('tab')
      await leaf.setViewState(previous.getViewState())
      if (!alive) return
      workspace.setActiveLeaf(leaf, { focus: true })
      previous.detach()
    }
    config.zen.windows[state.key] = on
    if (on) show(leaf)
    else unmount(state)
    save()
  }
  const addMenu = (menu: Menu, leaf: WorkspaceLeaf) => {
    if (menus.has(menu)) return
    menus.add(menu)
    menu.addItem((item) =>
      item
        .setTitle('Zen mode')
        .setIcon('maximize-2')
        .onClick(() => toggle(leaf))
    )
  }
  const scan = () => {
    const present = new Set<View>()
    workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view
      present.add(view)
      if (patched.has(view)) return
      const original = view.onPaneMenu
      patched.set(view, original)
      view.onPaneMenu = function (menu, source) {
        original.call(this, menu, source)
        addMenu(menu, leaf)
      }
    })
    for (const [view, original] of patched) {
      if (present.has(view)) continue
      view.onPaneMenu = original
      patched.delete(view)
    }
  }
  plugin.addCommand({
    id: 'toggle-zen-mode',
    name: 'Toggle zen mode',
    callback: () => toggle(workspace.activeLeaf),
  })
  plugin.registerEvent(
    workspace.on('file-menu', (menu, _file, source, leaf) => {
      if (leaf && (source === 'more-options' || source === 'tab-header')) addMenu(menu, leaf)
    })
  )
  plugin.registerEvent(
    workspace.on('active-leaf-change', (leaf) => {
      scan()
      if (leaf) show(leaf)
    })
  )
  plugin.registerEvent(
    workspace.on('layout-change', () => {
      scan()
      if (workspace.activeLeaf) show(workspace.activeLeaf)
    })
  )
  plugin.registerEvent(
    workspace.on('window-close', (_container, win) => {
      const state = windows.get(win.document)
      if (state) {
        unmount(state)
        state.dispose()
      }
      windows.delete(win.document)
    })
  )
  workspace.onLayoutReady(() => {
    scan()
    workspace.iterateAllLeaves((leaf) => {
      if (
        leaf.view.containerEl.ownerDocument !== document &&
        leaf.view.containerEl.closest('.mod-active')
      )
        show(leaf)
    })
    if (workspace.activeLeaf) show(workspace.activeLeaf)
  })
  plugin.register(() => {
    alive = false
    for (const state of windows.values()) {
      unmount(state)
      state.dispose()
    }
    for (const [view, original] of patched) view.onPaneMenu = original
    windows.clear()
    patched.clear()
  })
}
