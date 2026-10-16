import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Plugin, WorkspaceLeaf } from 'obsidian'
import { registerZen } from '@/zen/registerZen'

const config = vi.hoisted(() => ({
  zen: { width: 700, windows: {} as Record<string, boolean> },
  saveSettings: vi.fn(),
}))
vi.mock('@/services/AbeleConfig', () => ({ AbeleConfig: { getInstance: () => config } }))

let dispose: (() => void)[] = []
afterEach(() => {
  dispose.reverse().forEach((run) => run())
  dispose = []
  document.body.replaceChildren()
  config.zen = { width: 700, windows: {} }
})

function fixture() {
  const events: Record<string, (...args: any[]) => void> = {}
  let command: () => Promise<void>
  const root = {}
  const leaves: any[] = []
  const makeLeaf = (type = 'markdown', doc = document) => {
    const containerEl = doc.createElement('div')
    doc.body.append(containerEl)
    const view = {
      containerEl,
      getViewType: () => type,
      onPaneMenu: vi.fn(),
      addAction: vi.fn(() => containerEl.appendChild(doc.createElement('button'))),
    }
    const leaf: any = {
      view,
      getContainer: () => ({ id: 'sample-window' }),
      getRoot: () => root,
      getViewState: () => ({ type, state: { sample: true } }),
      setViewState: vi.fn(async () => {}),
      detach: vi.fn(),
    }
    leaves.push(leaf)
    return leaf
  }
  const workspace: any = {
    activeLeaf: makeLeaf(),
    leftSplit: {},
    rightSplit: {},
    on: (name: string, run: (...args: any[]) => void) => {
      events[name] = run
    },
    onLayoutReady: (run: () => void) => run(),
    iterateAllLeaves: (run: (leaf: WorkspaceLeaf) => void) => leaves.forEach(run),
    getLeaf: () => makeLeaf('chat'),
    setActiveLeaf: (leaf: WorkspaceLeaf) => {
      workspace.activeLeaf = leaf
    },
  }
  const plugin = {
    app: { workspace },
    register: (run: () => void) => dispose.push(run),
    registerEvent: vi.fn(),
    addCommand: (value: any) => {
      command = value.callback
    },
  } as unknown as Plugin
  registerZen(plugin)
  return { workspace, events, makeLeaf, toggle: () => command!() }
}

describe('window zen controller', () => {
  it('moves the overlay and exit action on tab changes and restores after re-registration', async () => {
    const { workspace, events, makeLeaf, toggle } = fixture()
    const first = workspace.activeLeaf
    await toggle()
    expect(document.body.classList).toContain('abele-zen')
    expect(config.zen.windows.main).toBe(true)
    const canvas = makeLeaf('canvas')
    events['active-leaf-change'](canvas)
    expect(first.view.containerEl.querySelector('button')).toBeNull()
    expect(document.body.classList).toContain('abele-zen-wide')
    expect(canvas.view.containerEl.querySelector('.abele-zen')).not.toBeNull()
    dispose.reverse().forEach((run) => run())
    dispose = []
    fixture()
    expect(document.body.classList).toContain('abele-zen')
  })

  it('keeps the pop-out independent', async () => {
    const { workspace, events, makeLeaf, toggle } = fixture()
    await toggle()
    const frame = document.createElement('iframe')
    document.body.append(frame)
    const doc = frame.contentDocument!
    const popup = makeLeaf('canvas', doc)
    events['active-leaf-change'](popup)
    expect(doc.body.classList).not.toContain('abele-zen')
    expect(document.body.classList).toContain('abele-zen')
    workspace.activeLeaf = popup
    await toggle()
    expect(doc.body.classList).toContain('abele-zen')
    expect(config.zen.windows['sample-window']).toBe(true)
    await toggle()
    expect(doc.body.classList).not.toContain('abele-zen')
    expect(document.body.classList).toContain('abele-zen')
    frame.remove()
  })

  it('moves a sidebar view into a main tab before entering', async () => {
    const { workspace, toggle } = fixture()
    const sidebar = workspace.activeLeaf
    sidebar.getRoot = () => workspace.rightSplit
    await toggle()
    expect(workspace.activeLeaf.setViewState).toHaveBeenCalledWith(sidebar.getViewState())
    expect(sidebar.detach).toHaveBeenCalledOnce()
    expect(document.body.classList).toContain('abele-zen')
  })

  it('moves a sidebar selected while zen is already on into the main area', async () => {
    const { workspace, events, makeLeaf, toggle } = fixture()
    await toggle()
    const sidebar = makeLeaf('chat')
    sidebar.getRoot = () => workspace.rightSplit
    events['active-leaf-change'](sidebar)
    await Promise.resolve()
    await Promise.resolve()
    expect(sidebar.detach).toHaveBeenCalledOnce()
    expect(workspace.activeLeaf.setViewState).toHaveBeenCalledWith(sidebar.getViewState())
  })

  it('keeps zen for an overlay Escape, then leaves with the next Escape', async () => {
    const { toggle } = fixture()
    await toggle()
    const modal = document.createElement('div')
    modal.className = 'modal-container'
    document.body.append(modal)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    modal.remove()
    await Promise.resolve()
    expect(config.zen.windows.main).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await Promise.resolve()
    expect(config.zen.windows.main).toBe(false)
    expect(document.body.classList).not.toContain('abele-zen')
  })
})
