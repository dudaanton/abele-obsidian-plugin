<template><div ref="element" /></template>
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { echartsInit, printChartWith, type EChartsType } from '@/bases/echarts'
import { isPrintMode } from '@/markdown/printMode'
import { GlobalStore } from '@/stores/GlobalStore'

const props = withDefaults(
  defineProps<{
    active?: boolean
    source: unknown
    render: (chart: EChartsType) => void
    created?: (chart: EChartsType) => void | (() => void)
  }>(),
  { active: true }
)
const element = ref<HTMLElement | null>(null)
let chart: EChartsType | null = null
let cleanupCreated: (() => void) | void
let observer: ResizeObserver | null = null
let frame: number | null = null
let gone = false
const chartWindow = () => element.value?.ownerDocument.defaultView ?? window
function scheduleResize() {
  if (gone || frame !== null) return
  frame = chartWindow().requestAnimationFrame(() => {
    frame = null
    render()
  })
}
function observe(el: HTMLElement) {
  if (observer) return
  observer = new ResizeObserver(scheduleResize)
  observer.observe(el)
}
function dispose() {
  if (frame !== null) chartWindow().cancelAnimationFrame(frame)
  frame = null
  observer?.disconnect()
  observer = null
  cleanupCreated?.()
  cleanupCreated = undefined
  chart?.dispose()
  chart = null
}
function render() {
  if (gone || !element.value) return
  if (isPrintMode(element.value)) {
    const el = element.value
    printChartWith(el, el.clientHeight || Number.parseFloat(el.style.height) || 300, props.render)
    return
  }
  observe(element.value)
  // Measure now, not from a previous observer entry: a hidden leaf may have changed again.
  if (props.active === false || element.value.clientWidth <= 1 || element.value.clientHeight <= 1)
    return
  if (!chart) {
    chart = echartsInit(element.value)
    cleanupCreated = props.created?.(chart)
  } else chart.resize()
  props.render(chart)
}
// Drawn inside the mount itself, so a chart mounted with `render()` or `app.mount()` is there
// (or watching for its width) before the call returns.
const workspace = GlobalStore.getInstance().app?.workspace
const layoutRefs: ReturnType<NonNullable<typeof workspace>['on']>[] = []
onMounted(() => {
  render()
  if (workspace) {
    layoutRefs.push(workspace.on('layout-change', scheduleResize))
    layoutRefs.push(workspace.on('active-leaf-change', scheduleResize))
  }
})
watch([() => props.source, () => props.active], render, { flush: 'post' })
watch(
  () => GlobalStore.getInstance().themeVersion.value,
  () => {
    dispose()
    render()
  },
  { flush: 'post' }
)
onBeforeUnmount(() => {
  gone = true
  for (const event of layoutRefs) workspace?.offref(event)
  dispose()
})
</script>
