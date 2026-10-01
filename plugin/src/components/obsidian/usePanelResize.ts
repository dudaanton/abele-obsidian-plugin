/** Device-local widths for an in-view panel; narrow views keep their drawer layout. */
import { computed, ref, type Ref } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import { GlobalStore } from '@/stores/GlobalStore'

export function usePanelResize(layout: Ref<HTMLElement | undefined>, key: string, defaultEm = 18) {
  const app = GlobalStore.getInstance().app
  const stored: unknown = app.loadLocalStorage(key)
  const width = ref<number | null>(
    typeof stored === 'number' && Number.isFinite(stored) && stored > 0 ? stored : null
  )
  const available = ref(0)
  const em = ref(14)
  const narrow = computed(() => available.value <= 640)
  const max = computed(() => Math.min(available.value * 0.4, em.value * 36))
  const min = computed(() => Math.min(em.value * 12, max.value))
  const clamp = (value: number) => Math.max(min.value, Math.min(max.value, value))
  const current = computed(() => clamp(width.value ?? em.value * defaultEm))
  const drag = ref<{ id: number; x: number; width: number; direction: number } | null>(null)

  useResizeObserver(layout, ([entry]) => {
    available.value = entry.contentRect.width
    em.value = parseFloat(getComputedStyle(entry.target).fontSize) || 14
  })

  function start(event: PointerEvent): void {
    if (narrow.value || event.button !== 0 || drag.value) return
    const handle = event.currentTarget as HTMLElement
    drag.value = {
      id: event.pointerId,
      x: event.clientX,
      width: current.value,
      direction: getComputedStyle(handle).direction === 'rtl' ? -1 : 1,
    }
    handle.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  function move(event: PointerEvent): void {
    const from = drag.value
    if (!from || from.id !== event.pointerId || narrow.value) return
    width.value = clamp(from.width + (event.clientX - from.x) * from.direction)
  }

  function finish(event: PointerEvent): void {
    if (!drag.value || drag.value.id !== event.pointerId) return
    drag.value = null
    app.saveLocalStorage(key, width.value)
    const handle = event.currentTarget as HTMLElement
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId)
  }

  function reset(event?: Event): void {
    if (narrow.value) return
    event?.preventDefault()
    width.value = null
    app.saveLocalStorage(key, null)
  }

  function resizeKey(event: KeyboardEvent): void {
    if (narrow.value) return
    const rtl = getComputedStyle(event.currentTarget as HTMLElement).direction === 'rtl'
    const step = (event.shiftKey ? 5 : 1) * em.value
    if (event.key === 'ArrowLeft') width.value = clamp(current.value + (rtl ? step : -step))
    else if (event.key === 'ArrowRight') width.value = clamp(current.value + (rtl ? -step : step))
    else if (event.key === 'Home') width.value = min.value
    else if (event.key === 'End') width.value = max.value
    else if (event.key === 'Enter') reset()
    else return
    event.preventDefault()
    app.saveLocalStorage(key, width.value)
  }

  return {
    style: computed(() => ({
      '--abele-panel-width': width.value === null ? `${defaultEm}em` : `${width.value}px`,
    })),
    divider: computed(() => ({
      narrow: narrow.value,
      min: min.value,
      max: max.value,
      current: current.value,
      active: drag.value !== null,
      onPointerdown: start,
      onPointermove: move,
      onPointerup: finish,
      onPointercancel: finish,
      onLostpointercapture: finish,
      onDblclick: reset,
      onKeydown: resizeKey,
    })),
  }
}
