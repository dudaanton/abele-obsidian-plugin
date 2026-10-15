<template><div ref="element" /></template>
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { echartsInit, type EChartsType } from '@/bases/echarts'
import { GlobalStore } from '@/stores/GlobalStore'

const props = withDefaults(
  defineProps<{
    active?: boolean
    source: unknown
    render: (chart: EChartsType) => void
    created?: (chart: EChartsType) => void
    /**
     * Starts the chart only once its element has a width — a block in a collapsed callout or a
     * note not yet laid out — instead of drawing it at zero size and resizing later.
     */
    waitForWidth?: boolean
  }>(),
  { active: true, waitForWidth: false }
)
const element = ref<HTMLElement | null>(null)
let chart: EChartsType | null = null
let observer: ResizeObserver | null = null
let sized = false
let gone = false
function observe(el: HTMLElement) {
  if (observer) return
  observer = new ResizeObserver((entries) => {
    if ((entries[0]?.contentRect.width ?? 0) > 0) sized = true
    if (props.active === false) return
    if (chart) chart.resize()
    else if (sized) render()
  })
  observer.observe(el)
}
function dispose() {
  observer?.disconnect()
  observer = null
  chart?.dispose()
  chart = null
}
function render() {
  if (gone || !element.value || props.active === false) return
  if (!chart) {
    if (props.waitForWidth && !sized) return observe(element.value)
    chart = echartsInit(element.value)
    observe(element.value)
    props.created?.(chart)
  }
  props.render(chart)
}
// Drawn inside the mount itself, so a chart mounted with `render()` or `app.mount()` is there
// (or watching for its width) before the call returns.
onMounted(render)
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
  dispose()
})
</script>
