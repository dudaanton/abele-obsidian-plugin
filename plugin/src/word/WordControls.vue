<template>
  <Modal
    :title="title"
    :size="editor.readOnly ? undefined : 'tall'"
    :phone-sheet="!!editor.readOnly"
    @close="emit('close')"
  >
    <div v-if="editor.readOnly" class="abele-word-read-only">
      <div class="setting-item-description">{{ t('streamC.a924951db88cd81f') }}</div>
      <WordPageLine v-if="preview" :paragraph="preview" :editing="false" :read-only="true" />
      <figure v-for="picture in pictures" :key="picture.number" class="abele-word-page__image">
        <img
          :src="picture.src"
          :alt="picture.alt"
          :width="picture.width"
          :height="picture.height"
        />
      </figure>
    </div>
    <div v-else ref="host" />
  </Modal>
</template>

<script setup lang="ts">
import { t } from '@/i18n'

import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import Modal from '@/components/obsidian/Modal.vue'
import { mountWordEditor, type DesktopEditHost } from './desktopEditor'
import type { WordPackage, WordParagraph } from './package'
import { wordControlsTitle } from './controlsTitle'
import WordPageLine from './WordPageLine.vue'
import { wordPageModel } from './pageAdapter'
import { allParagraphs, type WordPageParagraph, type WordPageImage } from './pageModel'

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
const preview = shallowRef<WordPageParagraph>()
const pictures = shallowRef<WordPageImage[]>([])
let dispose: (() => void) | undefined
onMounted(async () => {
  if (props.editor.readOnly) {
    const model = await wordPageModel(props.doc)
    preview.value = allParagraphs(model).find((p) => p.number === props.paragraph.number)
    pictures.value =
      preview.value?.images ??
      model.blocks.filter(
        (block): block is WordPageImage =>
          block.kind === 'image' && block.paragraph === props.paragraph.number
      )
    return
  }
  await nextTick()
  if (host.value) dispose = mountWordEditor(host.value, props.doc, props.paragraph, props.editor)
})
onBeforeUnmount(() => dispose?.())
</script>
