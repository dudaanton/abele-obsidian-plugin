import { afterEach, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import type { Plugin } from 'obsidian'
import { DebuggerService } from '@/debugger/DebuggerService'
import { registerDebuggerSelection } from '@/debugger/selection'

const cleanups: (() => void)[] = []
it('keeps the drawer probe on the retained Debug leaf across layout deduplication', async () => {
  const { drawerLeaf } = await import('../e2e/helpers/drawerLeaf')
  const root = {}
  let layout: (() => void) | undefined
  const retained = { getRoot: () => root, detach: vi.fn() }
  const opened = { getRoot: () => root, detach: vi.fn() }
  const leaves = [retained]
  const workspace = {
    rightSplit: root,
    leftSplit: {},
    getLeavesOfType: () => leaves,
    getRightLeaf: vi.fn(() => {
      leaves.push(opened)
      return opened
    }),
    on: (_event: string, callback: () => void) => {
      layout = callback
    },
    onLayoutReady: vi.fn(),
  }
  const plugin = {
    app: { loadLocalStorage: () => null, workspace },
    register: (stop: () => void) => cleanups.push(stop),
    registerEvent: vi.fn(),
  } as unknown as Plugin
  registerDebuggerSelection(plugin, 'sample-debug-view')
  const selected = drawerLeaf(workspace as never, 'sample-debug-view')
  // Opening/revealing a view emits layout-change before the probe measures it.
  layout?.()
  expect(selected.detach).not.toHaveBeenCalled()
  expect(selected).toBe(retained)
  expect(workspace.getRightLeaf).not.toHaveBeenCalled()
})
it('loads a deferred Debug title without a saved selection and removes later reload duplicates', async () => {
  const ready: (() => Promise<void>)[] = []
  let layout: (() => void) | undefined
  const first = { loadIfDeferred: vi.fn(async () => {}) }
  const duplicate = { detach: vi.fn() }
  let leaves: unknown[] = [first]
  const plugin = {
    app: {
      loadLocalStorage: () => null,
      workspace: {
        onLayoutReady: (cb: () => Promise<void>) => ready.push(cb),
        on: (_event: string, cb: () => void) => {
          layout = cb
        },
        getLeavesOfType: () => leaves,
      },
    },
    register: (stop: () => void) => cleanups.push(stop),
    registerEvent: vi.fn(),
  } as unknown as Plugin
  registerDebuggerSelection(plugin, 'sample-debug-view')
  await ready[0]()
  expect(first.loadIfDeferred).toHaveBeenCalledOnce()
  leaves = [first, duplicate]
  layout?.()
  expect(duplicate.detach).toHaveBeenCalledOnce()
})
it('keeps one Debug leaf when an old layout restores duplicates', async () => {
  const ready: (() => Promise<void>)[] = []
  const first = { loadIfDeferred: vi.fn(async () => {}), setViewState: vi.fn(async () => {}) }
  const duplicate = { detach: vi.fn() }
  const plugin = {
    app: {
      loadLocalStorage: () => null,
      workspace: {
        onLayoutReady: (callback: () => Promise<void>) => ready.push(callback),
        getLeavesOfType: () => [first, duplicate],
      },
    },
    register: (stop: () => void) => cleanups.push(stop),
  } as unknown as Plugin
  registerDebuggerSelection(plugin, 'sample-debug-view')
  await ready[0]()
  expect(duplicate.detach).toHaveBeenCalledOnce()
})
it('loads a deferred Debug leaf before deciding whether a second restoration is needed', async () => {
  const service = DebuggerService.instance
  const binding = service.binding({
    reference: { registrationId: 'sample-registration', sessionId: 'sample-chat' },
    connection: { state: ref('connected'), client: {} },
  } as never)
  const ready: (() => Promise<void>)[] = []
  const leaf = {
    setViewState: vi.fn(async () => {}),
    loadIfDeferred: vi.fn(async () => {
      service.active.value = binding
    }),
  }
  const plugin = {
    app: {
      loadLocalStorage: () => ({ sessionId: 'sample-debug' }),
      saveLocalStorage: vi.fn(),
      workspace: {
        onLayoutReady: (callback: () => Promise<void>) => ready.push(callback),
        getLeavesOfType: () => [leaf],
        getRightLeaf: vi.fn(),
      },
    },
    register: (stop: () => void) => cleanups.push(stop),
  } as unknown as Plugin
  registerDebuggerSelection(plugin, 'sample-debug-view')
  await ready[0]()
  expect(leaf.loadIfDeferred).toHaveBeenCalledOnce()
  expect(leaf.setViewState).not.toHaveBeenCalled()
})
afterEach(() => {
  for (const stop of cleanups.splice(0)) stop()
  DebuggerService.instance.destroy()
  vi.restoreAllMocks()
})
it('does not erase remembered selection when unrelated startup bindings publish metadata', async () => {
  const service = DebuggerService.instance
  const save = vi.fn()
  const plugin = {
    app: {
      loadLocalStorage: () => ({ sessionId: 'sample-debug' }),
      saveLocalStorage: save,
      workspace: { onLayoutReady: vi.fn() },
    },
    register: (stop: () => void) => cleanups.push(stop),
  } as unknown as Plugin
  vi.spyOn(service, 'selectionState').mockReturnValue({})
  registerDebuggerSelection(plugin, 'sample-debug-view')
  service.sourceRevision.value++
  await nextTick()
  expect(save).not.toHaveBeenCalled()
})
it('restores a remembered session even when the mobile layout omits the Debug leaf', async () => {
  const saved = { sessionId: 'sample-debug', target: {}, sessions: ['sample-debug'], sources: [] }
  const ready: (() => Promise<void>)[] = []
  const leaf = { setViewState: vi.fn(async () => {}) }
  const plugin = {
    app: {
      loadLocalStorage: vi.fn(() => saved),
      saveLocalStorage: vi.fn(),
      workspace: {
        onLayoutReady: (callback: () => Promise<void>) => ready.push(callback),
        getLeavesOfType: () => [],
        getRightLeaf: () => leaf,
      },
    },
    register: (stop: () => void) => cleanups.push(stop),
  } as unknown as Plugin
  registerDebuggerSelection(plugin, 'sample-debug-view')
  await ready[0]()
  expect(leaf.setViewState).toHaveBeenCalledExactlyOnceWith({
    type: 'sample-debug-view',
    active: false,
    state: saved,
  })
})

it('saves bounded selection metadata and preserves it during service teardown', async () => {
  const service = DebuggerService.instance
  const saved = { sessionId: 'sample-debug', target: {}, sessions: ['sample-debug'], sources: [] }
  const save = vi.fn()
  const plugin = {
    app: {
      loadLocalStorage: () => null,
      saveLocalStorage: save,
      workspace: { onLayoutReady: vi.fn() },
    },
    register: (stop: () => void) => cleanups.push(stop),
  } as unknown as Plugin
  const selection = vi.spyOn(service, 'selectionState').mockReturnValue(saved as never)
  registerDebuggerSelection(plugin, 'sample-debug-view')
  service.active.value = { revision: ref(0) } as never
  await nextTick()
  expect(save).toHaveBeenLastCalledWith('abele-debug-selection', saved)
  selection.mockReturnValue({})
  service.active.value = null
  await nextTick()
  expect(save).toHaveBeenLastCalledWith('abele-debug-selection', null)
  selection.mockReturnValue(undefined)
  service.sourceRevision.value++
  await nextTick()
  expect(save).toHaveBeenCalledTimes(2)
})
