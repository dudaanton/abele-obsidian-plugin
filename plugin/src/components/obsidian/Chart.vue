<template><div ref="element" /></template>
<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { echartsInit, type EChartsType } from '@/bases/echarts'
import { GlobalStore } from '@/stores/GlobalStore'

const props = withDefaults(
  defineProps<{
    active?: boolean
    source: unknown
    render: (chart: EChartsType) => void
    created?: (chart: EChartsType) => void
  }>(),
  { active: true }
)
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
  if (!element.value || props.active === false) return
  if (!chart) {
    chart = echartsInit(element.value)
    observer = new ResizeObserver(() => {
      if (props.active !== false) chart?.resize()
    })
    observer.observe(element.value)
    props.created?.(chart)
  }
  props.render(chart)
}
watch([() => props.source, () => props.active, element], render, { flush: 'post' })
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
