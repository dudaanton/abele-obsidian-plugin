import { expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mountCode } from '@/github/codeViewer'
import type { Plugin, WorkspaceLeaf } from 'obsidian'
import { DebugValueTab, openDebugValue, registerDebugValues } from '@/debugger/DebugValueTab'

const { workspace, actions, copy } = vi.hoisted(() => ({
  workspace: { getLeaf: vi.fn(), revealLeaf: vi.fn() },
  actions: new Map<string, () => void>(),
  copy: vi.fn(async () => {}),
}))
vi.mock('@/stores/GlobalStore', () => ({
  GlobalStore: { getInstance: () => ({ app: { workspace } }) },
}))
vi.mock('obsidian', () => ({
  ItemView: class {
    constructor(public leaf: WorkspaceLeaf) {}
    contentEl = document.createElement('div')
    titleEl = document.createElement('div')
    addAction(_icon: string, title: string, run: () => void) {
      actions.set(title, run)
      return document.createElement('div')
    }
  },
  Notice: class {},
}))
vi.mock('@/github/codeViewer', () => ({
  mountCode: vi.fn(() => ({ destroy: vi.fn() })),
}))

it('opens a transient adjacent tab and keeps raw copy independent of presentation', async () => {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: copy }, configurable: true })
  const tab = new DebugValueTab({} as WorkspaceLeaf)
  const leaf = { view: tab, setViewState: vi.fn() }
  workspace.getLeaf.mockReturnValue(leaf)
  const registerView = vi.fn()
  registerDebugValues({ registerView } as unknown as Plugin)
  expect(registerView).toHaveBeenCalledOnce()
  await tab.onOpen()
  const raw = '{"sample":1}'
  await openDebugValue('payload', raw, 'string')
  expect(workspace.getLeaf).toHaveBeenCalledWith('split', 'vertical')
  expect(leaf.setViewState).toHaveBeenCalledWith({ type: tab.getViewType(), active: true })
  expect(workspace.revealLeaf).toHaveBeenCalledWith(leaf)
  expect(tab.getDisplayText()).toBe('payload')
  await nextTick()
  expect(vi.mocked(mountCode).mock.lastCall?.[1]).toBe('{\n  "sample": 1\n}')
  actions.get('Toggle raw value')!()
  actions.get('Toggle line wrapping')!()
  await nextTick()
  await nextTick()
  expect(vi.mocked(mountCode).mock.lastCall?.[1]).toBe(raw)
  expect(vi.mocked(mountCode).mock.lastCall?.[7]).toBe(true)
  actions.get('Copy raw value')!()
  expect(copy).toHaveBeenCalledWith(raw)
  await tab.onClose()
})
