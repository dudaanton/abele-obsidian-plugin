<template>
  <Modal :title="title" size="tall" @close="emit('close')">
    <div ref="host" />
  </Modal>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import Modal from '@/components/obsidian/Modal.vue'
import { mountWordEditor, type DesktopEditHost } from './desktopEditor'
import type { WordPackage, WordParagraph } from './package'
import { wordControlsTitle } from './controlsTitle'

const props = defineProps<{
  doc: WordPackage
  paragraph: WordParagraph
  editor: DesktopEditHost
}>()
const emit = defineEmits<{ close: [] }>()
const title = computed(() =>
  wordControlsTitle(
    props.paragraph.number,
    props.doc.images.some((image) => image.paragraph === props.paragraph.number),
    !!props.paragraph.table
  )
)
const host = ref<HTMLElement>()
let dispose: (() => void) | undefined
onMounted(async () => {
  await nextTick()
  if (host.value) dispose = mountWordEditor(host.value, props.doc, props.paragraph, props.editor)
})
onBeforeUnmount(() => dispose?.())
</script>
