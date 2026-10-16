import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import Chart from '@/components/obsidian/Chart.vue'
import { GlobalStore } from '@/stores/GlobalStore'

const created = vi.hoisted(
  () => [] as { dispose: ReturnType<typeof vi.fn>; resize: ReturnType<typeof vi.fn> }[]
)
vi.mock('@/bases/echarts', () => ({
  echartsInit: () => {
    const chart = { dispose: vi.fn(), resize: vi.fn() }
    created.push(chart)
    return chart
  },
}))
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200)
})
afterEach(() => {
  vi.restoreAllMocks()
  created.length = 0
  vi.unstubAllGlobals()
})

describe('shared chart lifetime', () => {
  it('does not render hidden source updates and catches up on reveal', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        disconnect() {}
        observe() {}
      }
    )
    const render = vi.fn()
    const view = mount(Chart, { props: { source: [1], render, active: false } })
    await nextTick()
    expect(render).not.toHaveBeenCalled()
    await view.setProps({ source: [2] })
    expect(render).not.toHaveBeenCalled()
    await view.setProps({ active: true })
    expect(render).toHaveBeenCalledTimes(1)
    view.unmount()
  })

  it('has one observer per chart, disconnects on every theme recreation and unmount', async () => {
    const observers: { disconnect: ReturnType<typeof vi.fn>; observe: ReturnType<typeof vi.fn> }[] =
      []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        disconnect = vi.fn()
        observe = vi.fn()
        constructor() {
          observers.push(this)
        }
      }
    )
    const render = vi.fn()
    const view = mount(Chart, { props: { source: [1], render } })
    await nextTick()
    expect(created).toHaveLength(1)
    for (let i = 0; i < 3; i++) {
      GlobalStore.getInstance().themeVersion.value++
      await nextTick()
      await nextTick()
      expect(observers[i].disconnect).toHaveBeenCalledTimes(1)
      expect(created[i].dispose).toHaveBeenCalledTimes(1)
    }
    await view.setProps({ source: [2] })
    expect(created).toHaveLength(4)
    expect(render).toHaveBeenCalledTimes(5)
    view.unmount()
    expect(observers[3].disconnect).toHaveBeenCalledTimes(1)
    expect(created[3].dispose).toHaveBeenCalledTimes(1)
  })

  it('resizes on reveal even without an observer notification', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    )
    const view = mount(Chart, { props: { source: [1], render: vi.fn() } })
    await view.setProps({ active: false })
    await view.setProps({ active: true })
    expect(created[0].resize).toHaveBeenCalled()
    view.unmount()
  })

  it('waits for real dimensions by default and batches resizes into a frame', async () => {
    let width = 0
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
    let frame: FrameRequestCallback | undefined
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((cb: FrameRequestCallback) => {
        frame = cb
        return 1
      })
    )
    const cancel = vi.fn()
    vi.stubGlobal('cancelAnimationFrame', cancel)
    const flush = () => {
      const cb = frame
      frame = undefined
      cb?.(0)
    }
    const observers: { cb: ResizeObserverCallback; disconnect: ReturnType<typeof vi.fn> }[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        disconnect = vi.fn()
        observe = vi.fn()
        constructor(public cb: ResizeObserverCallback) {
          observers.push(this)
        }
      }
    )
    const fire = (size: number) => {
      width = size
      observers.at(-1)!.cb([{ contentRect: { width } } as ResizeObserverEntry], {} as never)
    }
    const render = vi.fn()
    const view = mount(Chart, { props: { source: [1], render } })
    await nextTick()
    expect(created).toHaveLength(0)
    expect(observers).toHaveLength(1)
    fire(0)
    flush()
    fire(1)
    flush()
    expect(created).toHaveLength(0)
    fire(300)
    flush()
    expect(created).toHaveLength(1)
    expect(render).toHaveBeenCalledTimes(1)
    fire(310)
    fire(320)
    expect(created[0].resize).not.toHaveBeenCalled()
    flush()
    expect(created).toHaveLength(1)
    expect(created[0].resize).toHaveBeenCalledTimes(1)
    expect(render).toHaveBeenCalledTimes(2)
    fire(0)
    flush()
    await view.setProps({ source: [2] })
    expect(render).toHaveBeenCalledTimes(2)
    expect(created[0].resize).toHaveBeenCalledTimes(1)
    fire(350)
    flush()
    expect(created[0].resize).toHaveBeenCalledTimes(2)
    expect(render).toHaveBeenCalledTimes(3)
    fire(360)
    view.unmount()
    expect(cancel).toHaveBeenCalled()
    flush()
    expect(created[0].resize).toHaveBeenCalledTimes(2)
    expect(created[0].dispose).toHaveBeenCalledTimes(1)
    expect(observers.every((o) => o.disconnect.mock.calls.length > 0)).toBe(true)
  })

  it('remeasures on workspace visibility events and removes its subscriptions', () => {
    const callbacks = new Map<string, () => void>()
    const workspace = {
      on: vi.fn((event: string, callback: () => void) => {
        callbacks.set(event, callback)
        return event
      }),
      offref: vi.fn(),
    }
    vi.spyOn(GlobalStore.getInstance(), 'app', 'get').mockReturnValue({ workspace } as never)
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    )
    let frame: FrameRequestCallback | undefined
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frame = cb
      return 1
    })
    const view = mount(Chart, { props: { source: [1], render: vi.fn() } })
    for (const event of ['layout-change', 'active-leaf-change']) {
      callbacks.get(event)!()
      frame!(0)
    }
    expect(created[0].resize).toHaveBeenCalledTimes(2)
    view.unmount()
    expect(workspace.offref.mock.calls).toEqual([['layout-change'], ['active-leaf-change']])
  })
})
