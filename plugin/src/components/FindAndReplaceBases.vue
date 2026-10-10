<template>
  <div class="abele-far-bases">
    <ReplacementPreviewPanel
      class-prefix="abele-far-bases"
      :replacements="replacements"
      :results="searchResults"
      preview-label="Preview"
      :use-in-ai-disabled="!props.files.value.length"
      @add-replacement="addReplacement"
      @remove-replacement="removeReplacement"
      @preview="preview"
      @replace="replace"
      @send-to-agent="sendToAgent"
      @go-to-note="goToNote"
      @replace-one="replaceOne"
      @remove-result="removeSearchResult"
    />
  </div>
</template>

<script setup lang="ts">
import { watch, type Ref } from 'vue'
import { TFile } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { useReplacementPreview } from '@/composables/useReplacementPreview'
import ReplacementPreviewPanel from './ReplacementPreviewPanel.vue'

const props = defineProps<{ files: Ref<TFile[]> }>()
const {
  replacements,
  searchResults,
  addReplacement,
  removeReplacement,
  previewFiles,
  replaceOne,
  replace,
  removeSearchResult,
} = useReplacementPreview()
const preview = () => previewFiles(props.files.value)
watch(() => props.files.value, preview, { immediate: true })

const goToNote = (path: string) => {
  const { app } = GlobalStore.getInstance()
  const file = app.vault.getAbstractFileByPath(path)
  if (file instanceof TFile) void app.workspace.getLeaf().openFile(file)
}
const sendToAgent = () => {
  void import('@/helpers/useFilesInAgent').then((module) =>
    module.useFilesInAgent(props.files.value)
  )
}
</script>

<style lang="scss">
.abele-far-bases {
  padding: var(--size-4-2);
}
</style>
