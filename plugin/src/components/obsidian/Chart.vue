<template><div ref="element" /></template>
<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { echartsInit, type EChartsType } from '@/bases/echarts'
import { GlobalStore } from '@/stores/GlobalStore'

const props = defineProps<{
  source: unknown
  render: (chart: EChartsType) => void
  created?: (chart: EChartsType) => void
}>()
const element = ref<HTMLElement | null>(null)
let chart: EChartsType | null = null
let observer: ResizeObserver | null = null
function dispose() {
  observer?.disconnect()
  observer = null
  chart?.dispose()
  chart = null
}
function render() {
  if (!element.value) return
  if (!chart) {
    chart = echartsInit(element.value)
    observer = new ResizeObserver(() => chart?.resize())
    observer.observe(element.value)
    props.created?.(chart)
  }
  props.render(chart)
}
watch([() => props.source, element], render, { flush: 'post' })
watch(
  () => GlobalStore.getInstance().themeVersion.value,
  () => {
    dispose()
    render()
  },
  { flush: 'post' }
)
onBeforeUnmount(dispose)
</script>
