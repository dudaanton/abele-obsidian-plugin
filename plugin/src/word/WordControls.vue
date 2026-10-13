<template>
  <Modal title="Word paragraph controls" size="tall" @close="emit('close')">
    <div ref="host" />
  </Modal>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import Modal from '@/components/obsidian/Modal.vue'
import { mountWordEditor, type DesktopEditHost } from './desktopEditor'
import type { WordPackage, WordParagraph } from './package'

const props = defineProps<{
  doc: WordPackage
  paragraph: WordParagraph
  editor: DesktopEditHost
}>()
const emit = defineEmits<{ close: [] }>()
const host = ref<HTMLElement>()
let dispose: (() => void) | undefined
onMounted(async () => {
  await nextTick()
  if (host.value) dispose = mountWordEditor(host.value, props.doc, props.paragraph, props.editor)
})
onBeforeUnmount(() => dispose?.())
</script>
