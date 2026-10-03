import { afterEach, describe, expect, it, vi } from 'vitest'
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
afterEach(() => {
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
})
