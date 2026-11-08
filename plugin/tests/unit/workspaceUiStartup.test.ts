import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import AbelePlugin from '@/main'

const { construct } = vi.hoisted(() => ({ construct: vi.fn() }))
vi.mock('@/App.vue', () => ({
  default: {
    setup() {
      construct()
      return () => null
    },
  },
}))

afterEach(() => {
  vi.useRealTimers()
  construct.mockClear()
  document.body.replaceChildren()
})

it('keeps restored workspace contents out of registration, then renders them after layout in a new task', async () => {
  vi.useFakeTimers()
  const plugin = Object.create(AbelePlugin.prototype)
  await plugin.initializeVue()
  try {
    expect(plugin.getVueApp()).toBeTruthy()
    expect(construct).not.toHaveBeenCalled()
    const ready: (() => void)[] = []
    const dispose: (() => void)[] = []
    plugin.workspaceUi.start({
      app: { workspace: { onLayoutReady: (fn: () => void) => ready.push(fn) } },
      register: (fn: () => void) => dispose.push(fn),
    })
    await vi.runAllTimersAsync()
    expect(construct).not.toHaveBeenCalled()
    ready.forEach((fn) => fn())
    await nextTick()
    expect(construct).not.toHaveBeenCalled()
    await vi.runAllTimersAsync()
    expect(construct).toHaveBeenCalledOnce()
    dispose.forEach((fn) => fn())
  } finally {
    plugin.workspaceUi?.stop()
    plugin.getVueApp().unmount()
  }
})

it.each([false, true])(
  'cancels pending workspace UI on unload, layout ready=%s',
  async (layoutReady) => {
    vi.useFakeTimers()
    const plugin = Object.create(AbelePlugin.prototype)
    await plugin.initializeVue()
    try {
      const ready: (() => void)[] = []
      const dispose: (() => void)[] = []
      plugin.workspaceUi.start({
        app: { workspace: { onLayoutReady: (fn: () => void) => ready.push(fn) } },
        register: (fn: () => void) => dispose.push(fn),
      })
      if (layoutReady) ready.forEach((fn) => fn())
      dispose.forEach((fn) => fn())
      ready.forEach((fn) => fn())
      await vi.runAllTimersAsync()
      expect(construct).not.toHaveBeenCalled()
    } finally {
      plugin.workspaceUi?.stop()
      plugin.getVueApp().unmount()
    }
  }
)
