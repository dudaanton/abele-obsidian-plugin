<template><div ref="host" class="abele-node-debug-file" /></template>
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import type { DebugSourceContext } from '@/debugger/sourceExtension'
import { mountNodePathDebugSource } from '@/node/NodePathDebugSource'
const props = defineProps<{ context: DebugSourceContext }>()
const emit = defineEmits<{ reveal: [line: number] }>()
const host = ref<HTMLElement>()
let extension: ReturnType<typeof mountNodePathDebugSource> | undefined
onMounted(() => {
  if (host.value)
    extension = mountNodePathDebugSource(host.value, props.context, (line) => emit('reveal', line))
})
watch(
  () => props.context.text,
  (text) => extension?.update(text)
)
onBeforeUnmount(() => extension?.destroy())
</script>
