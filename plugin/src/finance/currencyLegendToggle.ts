import type { EChartsType } from '@/bases/echarts'

interface LegendEvent {
  componentType?: string
  value?: string
  event?: { event?: Event }
}

/** Requires legend.triggerEvent so ECharts identifies legend icons and labels. */
export function installCurrencyLegendToggle(chart: EChartsType): () => void {
  const dom = chart.getDom()
  const win = dom.ownerDocument.defaultView ?? window
  let timer: number | undefined
  let suppressUntil = 0
  let longPressed = false
  const cancel = () => {
    win.clearTimeout(timer)
    timer = undefined
  }
  const toggle = (name: string) => {
    const legend = (
      chart.getOption()?.legend as {
        data?: (string | { name: string })[]
        selected?: Record<string, boolean>
      }[]
    )?.[0]
    const names = legend?.data?.map((item) => (typeof item === 'string' ? item : item.name)) ?? []
    if (!names.includes(name)) return
    const selected = legend?.selected ?? {}
    const alone =
      selected[name] !== false && names.every((item) => item === name || selected[item] === false)
    for (const item of names) {
      const wanted = alone || item === name
      if ((selected[item] !== false) !== wanted)
        chart.dispatchAction({ type: 'legendToggleSelect', name: item })
    }
  }
  const contextmenu = (params: LegendEvent) => {
    if (params.componentType !== 'legend' || typeof params.value !== 'string') return
    params.event?.event?.preventDefault()
    params.event?.event?.stopPropagation()
    const pendingPress = timer !== undefined
    cancel()
    if (!longPressed && Date.now() >= suppressUntil) toggle(params.value)
    if (pendingPress) {
      longPressed = true
      suppressUntil = Date.now() + 1000
    }
  }
  const press = (params: LegendEvent) => {
    cancel()
    if (params.componentType !== 'legend' || typeof params.value !== 'string') return
    const native = params.event?.event
    if (
      !native ||
      !(
        native.type.startsWith('touch') ||
        ('pointerType' in native && native.pointerType === 'touch')
      )
    )
      return
    const name = params.value
    timer = win.setTimeout(() => {
      timer = undefined
      suppressUntil = Date.now() + 1000
      longPressed = true
      toggle(name)
    }, 500)
  }
  // ZRender synthesizes a click on touchend; intercept before it reaches the legend's toggle.
  const suppress = (event: Event) => {
    if (!longPressed && Date.now() >= suppressUntil) return
    longPressed = false
    suppressUntil = Date.now() + 1000
    event.preventDefault()
    event.stopImmediatePropagation()
    cancel()
  }
  const release = () => {
    cancel()
    if (longPressed) {
      longPressed = false
      suppressUntil = Date.now() + 1000
    }
  }
  const handlers = {
    contextmenu,
    mousedown: press,
    mouseup: release,
    mousemove: cancel,
    globalout: cancel,
  }
  for (const [name, handler] of Object.entries(handlers)) chart.on(name, handler)
  dom.addEventListener('touchend', suppress, true)
  dom.addEventListener('click', suppress, true)
  dom.addEventListener('touchcancel', release, true)
  dom.addEventListener('pointermove', cancel, true)
  dom.addEventListener('pointercancel', release, true)
  dom.addEventListener('pointerup', release, true)
  return () => {
    cancel()
    for (const [name, handler] of Object.entries(handlers)) chart.off(name, handler)
    dom.removeEventListener('touchend', suppress, true)
    dom.removeEventListener('click', suppress, true)
    dom.removeEventListener('touchcancel', release, true)
    dom.removeEventListener('pointermove', cancel, true)
    dom.removeEventListener('pointercancel', release, true)
    dom.removeEventListener('pointerup', release, true)
  }
}
