<template>
  <EmptyState v-if="failure" class="abele-chart-error" variant="error" :text="failure" />
  <Chart
    v-else
    class="abele-chart-container"
    :style="{ height: `${config?.height || 300}px` }"
    :source="built.option"
    :render="draw"
  />
</template>

<script setup lang="ts">
// An `abele-chart` code block: the kit chart drawn from the block's config, or what is wrong
// with the block in its place. The kit chart owns ECharts — waiting for a width, resizing,
// drawing again in the new colours when the theme changes, and disposing on unmount.
import { computed, ref } from 'vue'
import type { EChartsType } from '@/bases/echarts'
import Chart from '@/components/obsidian/Chart.vue'
import EmptyState from '@/components/obsidian/EmptyState.vue'
import { buildEchartsOption, type ChartConfig } from '@/editor/chartOption'

const props = defineProps<{ config?: ChartConfig; error?: string }>()

const chartError = (e: unknown) => `Chart error: ${e instanceof Error ? e.message : String(e)}`

const built = computed<{ option?: Record<string, unknown>; error?: string }>(() => {
  if (props.error || !props.config) return { error: props.error ?? 'No series defined' }
  try {
    return { option: buildEchartsOption(props.config) }
  } catch (e) {
    return { error: chartError(e) }
  }
})
const drawError = ref<string | null>(null)
const failure = computed(() => drawError.value ?? built.value.error ?? null)

function draw(chart: EChartsType) {
  try {
    chart.setOption(built.value.option ?? {}, true)
  } catch (e) {
    drawError.value = chartError(e)
  }
}
</script>
