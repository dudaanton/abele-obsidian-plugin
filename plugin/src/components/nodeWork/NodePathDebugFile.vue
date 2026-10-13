<template><div ref="host" class="abele-node-debug-file" /></template>
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import type { Selected } from '../obsidian/SelectionBar.vue'
import type { DebugSourceContext } from '@/debugger/sourceExtension'
import { mountNodePathDebugSource } from '@/node/NodePathDebugSource'
const props = defineProps<{ context: DebugSourceContext }>()
const emit = defineEmits<{
  reveal: [line: number]
  selection: [action: 'ask' | 'add' | 'note', selected: Selected & { path: string }]
}>()
const host = ref<HTMLElement>()
let extension: ReturnType<typeof mountNodePathDebugSource> | undefined
onMounted(() => {
  if (host.value)
    extension = mountNodePathDebugSource(
      host.value,
      props.context,
      (line) => emit('reveal', line),
      (action, selected) => emit('selection', action, selected)
    )
})
watch(
  () => props.context.text,
  (text) => extension?.update(text)
)
onBeforeUnmount(() => extension?.destroy())
</script>
