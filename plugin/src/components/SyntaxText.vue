<template>
  <template v-for="(line, i) in painted" :key="i"
    ><template v-if="i">{{ '\n' }}</template
    ><template v-for="(part, j) in line" :key="j"
      ><span v-if="part.cls" :class="part.cls">{{ part.text }}</span
      ><template v-else>{{ part.text }}</template></template
    ></template
  >
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { loadedPrism, prism, lineTokens } from './codeSyntax'
import { paint, MAX_HIGHLIGHTED } from './diffSyntax'
const props = defineProps<{ text: string; path?: string }>()
void loadedPrism().catch(console.debug)
const painted = computed(() => {
  const tokens =
    prism.value && props.text.length <= MAX_HIGHLIGHTED
      ? lineTokens(prism.value, props.text, props.path)
      : null
  return props.text
    .split('\n')
    .map((text, i) => paint([{ text, changed: false }], tokens?.[i])[0].parts)
})
</script>
