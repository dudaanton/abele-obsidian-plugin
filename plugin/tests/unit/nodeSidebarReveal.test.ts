import { afterEach, describe, expect, it, vi } from 'vitest'
import { Platform } from 'obsidian'
import { flushPromises } from '@vue/test-utils'
import AbelePlugin from '@/main'
import { ScriptService } from '@/scripting/ScriptService'
import { ScriptViewService } from '@/scripting/view/ScriptViewService'
import { useVault } from '../helpers/testEnv'

afterEach(() => {
  Platform.isMobile = false
  vi.useRealTimers()
  vi.restoreAllMocks()
  ScriptService.destroy()
  ScriptViewService.destroy()
})

describe('opening the Node sidebar command', () => {
  it('recovers a phone drawer that finishes closing after the newly opened leaf is revealed', async () => {
    vi.useFakeTimers()
    Platform.isMobile = true
    const app = useVault([])
    let closing = true
    const split = {
      collapsed: false,
      containerEl: { offsetWidth: 320 },
      collapse: vi.fn(() => {
        split.collapsed = true
        closing = false
      }),
      expand: vi.fn(() => {
        split.collapsed = false
        if (!closing) split.containerEl.offsetWidth = 320
      }),
    }
    let opened = false
    const leaf = {
      getRoot: () => split,
      getViewState: () => ({ type: opened ? 'abele-node-sidebar' : 'empty', state: {} }),
      setViewState: vi.fn(async () => {
        opened = true
      }),
    }
    const revealLeaf = vi.fn(async () => {
      // Obsidian can leave its open flag set while the old leaf's closing transition
      // subsequently hides the replacement drawer. Expanding an already-open flag
      // does not recover its geometry; a settled collapse/expand is needed.
      split.collapsed = false
      window.setTimeout(() => {
        split.containerEl.offsetWidth = 0
      }, 100)
    })
    Object.assign(app.workspace, {
      leftSplit: split,
      rightSplit: {},
      getLeavesOfType: () => (opened ? [leaf] : []),
      getLeftLeaf: () => leaf,
      revealLeaf,
    })
    const addCommand = vi.fn()
    const plugin = Object.assign(Object.create(AbelePlugin.prototype), {
      app,
      registerView: vi.fn(),
      registerExtensions: vi.fn(),
      registerDomEvent: vi.fn(),
      registerEvent: vi.fn(),
      register: vi.fn(),
      addCommand,
      addRibbonIcon: vi.fn(),
    })
    plugin.registerViews()
    const command = addCommand.mock.calls.find(([command]) => command.id === 'open-node')![0]
    command.callback()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1200)
    expect(leaf.setViewState).toHaveBeenCalledWith({
      type: 'abele-node-sidebar',
      active: true,
      state: {},
    })
    expect(revealLeaf).toHaveBeenCalledWith(leaf)
    expect(split.containerEl.offsetWidth).toBe(320)
    expect(split.collapsed).toBe(false)
    expect(split.collapse).toHaveBeenCalledOnce()
    expect(split.expand).toHaveBeenCalledOnce()
  })
})
