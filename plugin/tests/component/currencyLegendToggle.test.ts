import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import Chart from '@/components/obsidian/Chart.vue'
import { installCurrencyLegendToggle } from '@/finance/currencyLegendToggle'

const state = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown) => void>(),
  selected: {} as Record<string, boolean>,
  dom: undefined as HTMLElement | undefined,
  dispatch: vi.fn(),
}))
vi.mock('@/bases/echarts', () => ({
  echartsInit: (dom: HTMLElement) => {
    state.dom = dom
    return {
      on: (name: string, fn: (event: unknown) => void) => state.handlers.set(name, fn),
      off: (name: string) => state.handlers.delete(name),
      getDom: () => dom,
      getOption: () => ({ legend: [{ data: ['EUR', 'USD', 'GBP'], selected: state.selected }] }),
      dispatchAction: state.dispatch,
      dispose: vi.fn(),
      resize: vi.fn(),
    }
  },
}))
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  state.handlers.clear()
})

function show() {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200)
  state.selected = {}
  state.dispatch.mockImplementation(({ name }: { name: string }) => {
    state.selected[name] = state.selected[name] === false
  })
  state.dispatch.mockClear()
  return mount(Chart, {
    props: { source: [], render: vi.fn(), created: installCurrencyLegendToggle },
  })
}
function event(name: string, native = new MouseEvent('contextmenu', { cancelable: true })) {
  state.handlers.get(name)?.({ componentType: 'legend', value: 'USD', event: { event: native } })
  return native
}

describe('currency legend gestures', () => {
  it('isolates on right click, restores all on the next, and leaves left click alone', () => {
    const view = show()
    event('click')
    expect(state.dispatch).not.toHaveBeenCalled()
    expect(event('contextmenu').defaultPrevented).toBe(true)
    expect(state.selected).toEqual({ EUR: false, GBP: false })
    event('contextmenu')
    expect(state.selected).toEqual({ EUR: true, GBP: true })
    view.unmount()
  })

  it.each(['touchstart', 'pointerdown'])(
    'long-presses through %s without a duplicate click/menu',
    (type) => {
      vi.useFakeTimers()
      const view = show()
      const down =
        type === 'touchstart'
          ? new TouchEvent(type, { cancelable: true })
          : Object.assign(new Event(type, { cancelable: true }), { pointerType: 'touch' })
      event('mousedown', down)
      vi.advanceTimersByTime(600)
      expect(state.selected).toEqual({ EUR: false, GBP: false })
      event('contextmenu')
      expect(state.selected.EUR).toBe(false)
      const click = new MouseEvent('click', { bubbles: true, cancelable: true })
      state.dom!.dispatchEvent(click)
      expect(click.defaultPrevented).toBe(true)
      vi.advanceTimersByTime(1000)
      event('mousedown', down)
      event('mousemove')
      vi.advanceTimersByTime(600)
      expect(state.selected.EUR).toBe(false)
      event('mousedown', down)
      vi.advanceTimersByTime(600)
      expect(state.selected.EUR).toBe(true)
      view.unmount()
    }
  )

  it('ignores chart data and cancels pending presses on unmount', () => {
    vi.useFakeTimers()
    const view = show()
    state.handlers.get('contextmenu')?.({ componentType: 'series', value: 'USD' })
    expect(state.dispatch).not.toHaveBeenCalled()
    event('mousedown', new TouchEvent('touchstart'))
    view.unmount()
    vi.advanceTimersByTime(1000)
    expect(state.dispatch).not.toHaveBeenCalled()
    expect(state.handlers.size).toBe(0)
  })

  it('handles a native long-press menu arriving before the timer without a second toggle', () => {
    vi.useFakeTimers()
    const view = show()
    event('mousedown', new TouchEvent('touchstart'))
    event('contextmenu')
    expect(state.selected).toEqual({ EUR: false, GBP: false })
    const end = new TouchEvent('touchend', { cancelable: true })
    state.dom!.dispatchEvent(end)
    expect(end.defaultPrevented).toBe(true)
    vi.advanceTimersByTime(600)
    expect(state.dispatch).toHaveBeenCalledTimes(2)
    view.unmount()
  })
})
