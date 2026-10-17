<template>
  <template v-for="(part, index) in parts" :key="index">
    <slot v-if="part.slot" :name="part.slot" />
    <template v-else>{{ part.text }}</template>
  </template>
</template>
<script setup lang="ts">
import { computed } from 'vue'

/** The caller supplies token markers to t(); only these markers can become inline slots. */
const props = defineProps<{ text: string }>()
const parts = computed(() => {
  const result: { text?: string; slot?: string }[] = []
  let offset = 0
  for (const match of props.text.matchAll(/⟪(\w+)⟫/g)) {
    if (match.index > offset) result.push({ text: props.text.slice(offset, match.index) })
    result.push({ slot: match[1] })
    offset = match.index + match[0].length
  }
  if (offset < props.text.length) result.push({ text: props.text.slice(offset) })
  return result
})
</script>
