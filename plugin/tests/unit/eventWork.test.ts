import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { MarkdownView, WorkspaceLeaf } from 'obsidian'
import { HeaderCommands } from '@/headerButtons/viewActions'
import { registerNotePlaces } from '@/notePlaces/register'
import { AbeleConfig } from '@/services/AbeleConfig'
import AbelePlugin from '@/main'
import { GlobalStore } from '@/stores/GlobalStore'
import { useVault } from '../helpers/testEnv'

const disposers: (() => void)[] = []
afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function pluginFor(app: unknown) {
  return {
    app,
    addCommand: () => {},
    register: (fn: () => void) => disposers.push(fn),
    registerEvent: () => {},
    registerInterval: (id: number) => disposers.push(() => window.clearInterval(id)),
    registerDomEvent: (el: EventTarget, type: string, fn: EventListener) => {
      el.addEventListener(type, fn)
      disposers.push(() => el.removeEventListener(type, fn))
    },
  }
}

describe('workspace work is bounded', () => {
  it('cleans orphaned widgets once for twenty tab switches and cancels pending work on unload', () => {
    vi.useFakeTimers()
    const app = useVault([])
    const handlers = new Map<string, (leaf: unknown) => void>()
    Object.assign(app.workspace, {
      on: (name: string, fn: (leaf: unknown) => void) => {
        handlers.set(name, fn)
        return {}
      },
      getActiveViewOfType: () => null,
    })
    const cleanup = vi
      .spyOn(GlobalStore.getInstance(), 'cleanupOrphanedWidgets')
      .mockImplementation(() => {})
    const plugin = pluginFor(app)
    const registerEvents = (AbelePlugin.prototype as unknown as { registerWorkspaceEvents(): void })
      .registerWorkspaceEvents
    registerEvents.call(plugin)
    for (let i = 0; i < 20; i++)
      handlers.get('active-leaf-change')!({ view: { getViewType: () => 'markdown', file: null } })
    vi.advanceTimersByTime(500)
    expect(cleanup).toHaveBeenCalledTimes(1)
    handlers.get('active-leaf-change')!({ view: { getViewType: () => 'markdown', file: null } })
    for (const dispose of disposers.splice(0)) dispose()
    vi.advanceTimersByTime(500)
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('draws command headers once for a note-switch event burst and not for unrelated saves', async () => {
    vi.useFakeTimers()
    const app = useVault([])
    const handlers = new Map<string, () => void>()
    Object.assign(app.workspace, {
      on: (name: string, fn: () => void) => {
        handlers.set(name, fn)
        return {}
      },
      iterateAllLeaves: vi.fn(),
    })
    const config = AbeleConfig.getInstance()
    config.headerButtons = []
    const commands = new HeaderCommands()
    disposers.push(() => commands.stop())
    const draw = vi.spyOn(commands, 'draw')
    commands.start(pluginFor(app) as never)
    expect(draw).toHaveBeenCalledTimes(1)
    for (const event of ['layout-change', 'active-leaf-change', 'file-open']) handlers.get(event)!()
    await vi.advanceTimersByTimeAsync(20)
    expect(draw).toHaveBeenCalledTimes(2)
    config.birthDate = '2000-01-01'
    config.version.value++
    await nextTick()
    await vi.advanceTimersByTimeAsync(20)
    expect(draw).toHaveBeenCalledTimes(2)
    config.headerButtons = [{ id: 'sample', runs: 'command', enabled: false } as never]
    config.version.value++
    await nextTick()
    await vi.advanceTimersByTimeAsync(20)
    expect(draw).toHaveBeenCalledTimes(3)
    handlers.get('file-open')!()
    commands.stop()
    await vi.advanceTimersByTimeAsync(20)
    expect(draw).toHaveBeenCalledTimes(3)
  })

  it('does not enumerate note places while off or backgrounded, and resumes when enabled', async () => {
    vi.useFakeTimers()
    const app = useVault([])
    const iterate = vi.fn()
    Object.assign(app.workspace, { iterateAllLeaves: iterate, onLayoutReady: () => {} })
    Object.assign(app, { loadLocalStorage: () => null, saveLocalStorage: () => {} })
    // Only the adapter contract here; the real prototypes are checked in the live tier.
    for (const [proto, key] of [
      [WorkspaceLeaf.prototype, 'setViewState'],
      [WorkspaceLeaf.prototype, 'detach'],
      [MarkdownView.prototype, 'setEphemeralState'],
      [MarkdownView.prototype, 'onUnloadFile'],
    ] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(proto, key)
      Object.defineProperty(proto, key, { configurable: true, writable: true, value: vi.fn() })
      disposers.push(() =>
        descriptor
          ? Object.defineProperty(proto, key, descriptor)
          : Reflect.deleteProperty(proto, key)
      )
    }
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    const config = AbeleConfig.getInstance()
    config.rememberNotePlaces = false
    registerNotePlaces(pluginFor(app) as never)
    await vi.advanceTimersByTimeAsync(5000)
    expect(iterate).toHaveBeenCalledTimes(0)
    config.rememberNotePlaces = true
    config.version.value++
    await nextTick()
    await vi.advanceTimersByTimeAsync(3000)
    expect(iterate).toHaveBeenCalledTimes(3)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    const before = iterate.mock.calls.length
    await vi.advanceTimersByTimeAsync(5000)
    expect(iterate).toHaveBeenCalledTimes(before)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(iterate).toHaveBeenCalledTimes(before + 1)
    config.rememberNotePlaces = false
    config.version.value++
    await nextTick()
    const stopped = iterate.mock.calls.length
    await vi.advanceTimersByTimeAsync(5000)
    expect(iterate).toHaveBeenCalledTimes(stopped)
  })
})
