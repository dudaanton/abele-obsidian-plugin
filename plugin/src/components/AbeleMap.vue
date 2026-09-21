<template>
  <div>
    <div
      v-show="!error"
      ref="target"
      class="abele-map"
      :style="{ height: `${config.height}px` }"
    ></div>
    <div v-if="error" class="abele-map-error">Map error: {{ error }}</div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { GlobalStore } from '@/stores/GlobalStore'
import type { MapConfig } from '@/helpers/mapConfig'
import { renderMap, type MapHandle } from '@/helpers/mapRender'

/**
 * A map inside the interface — a chat, a script view — as opposed to inside a note, which is
 * the `abele-map` block. Both end up in the same renderer.
 */
const props = defineProps<{ config: MapConfig }>()

const target = ref<HTMLElement>()
const error = ref('')
let handle: MapHandle | null = null
let generation = 0

const draw = async () => {
  const mine = ++generation
  handle?.destroy()
  handle = null
  error.value = ''
  if (!target.value) return

  try {
    const made = await renderMap(target.value, props.config)
    // Redrawn, or unmounted, while MapLibre was loading.
    if (mine !== generation) made.destroy()
    else handle = made
  } catch (reason) {
    if (mine !== generation) return
    error.value = reason instanceof Error ? reason.message : 'Unknown error'
  }
}

onMounted(() => void draw())

// A theme change swaps the style sheet the tiles are drawn with, which MapLibre only picks up
// on a fresh map.
watch(
  () => GlobalStore.getInstance().themeVersion.value,
  () => void draw()
)
watch(
  () => props.config,
  () => void draw()
)

onUnmounted(() => {
  generation++
  handle?.destroy()
  handle = null
})
</script>
