<template>
  <ObsidianModal title="Find and replace" @close="emit('close')" @expose-id="setScrollContainer">
    <div class="abele-sar-fm-modal">
      <div class="abele-sar-fm-modal__description">
        Enter note search conditions. Lists are separated by semicolons. Only notes matching all of
        the following conditions will be found.
      </div>
      <div class="abele-sar-fm-modal__criteria">
        <CriterionView
          v-for="criterion in criteria"
          :key="criterion.id"
          :criterion="criterion"
          @remove="removeCriterion(criterion.id)"
        />
        <ObsidianIcon
          icon="plus"
          class="abele-sar-fm-modal__add-button"
          text-right="Add criterion"
          @click="addCriterion"
        />
      </div>
      <ReplacementPreviewPanel
        class-prefix="abele-sar-fm-modal"
        :replacements="replacements"
        :results="searchResults"
        preview-label="Search"
        :use-in-ai-disabled="!searchResults.length"
        :scroll-container="scrollContainer"
        @add-replacement="addReplacement"
        @remove-replacement="removeReplacement"
        @preview="search"
        @replace="replace"
        @send-to-agent="sendToAgent"
        @go-to-note="goToNote"
        @replace-one="replaceOne"
        @remove-result="removeSearchResult"
      />
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { TFile } from 'obsidian'
import { Criterion } from '@/entities/Criterion'
import { GlobalStore } from '@/stores/GlobalStore'
import { useReplacementPreview } from '@/composables/useReplacementPreview'
import ObsidianModal from './obsidian/Modal.vue'
import ObsidianIcon from './obsidian/Icon.vue'
import CriterionView from './Criterion.vue'
import ReplacementPreviewPanel from './ReplacementPreviewPanel.vue'

const emit = defineEmits<{ close: [] }>()
const scrollContainer = ref<HTMLElement | null>(null)
const setScrollContainer = (id: string) => {
  scrollContainer.value = document.querySelector(`.modal-content:has(#${id})`)?.parentElement
}
const criteria = ref<Criterion[]>([new Criterion()])
const addCriterion = () => criteria.value.push(new Criterion())
const removeCriterion = (id: string) => {
  criteria.value = criteria.value.filter((criterion) => criterion.id !== id)
}
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
const search = () =>
  previewFiles(GlobalStore.getInstance().app.vault.getMarkdownFiles(), criteria.value)

const sendToAgent = () => {
  const { app } = GlobalStore.getInstance()
  const files = searchResults.value
    .map((result) => app.vault.getAbstractFileByPath(result.oldPath))
    .filter((file): file is TFile => file instanceof TFile)
  void import('@/helpers/useFilesInAgent').then((module) => module.useFilesInAgent(files))
  emit('close')
}
const goToNote = (path: string) => {
  const { app } = GlobalStore.getInstance()
  const file = app.vault.getAbstractFileByPath(path)
  if (file instanceof TFile) {
    void app.workspace.getLeaf().openFile(file)
    emit('close')
  }
}
</script>

<style lang="scss">
.modal:has(.abele-sar-fm-modal) {
  width: 700px;
}
.abele-sar-fm-modal__description {
  margin-top: var(--p-spacing);
  margin-bottom: calc(var(--p-spacing) * 1.5);
}
.abele-sar-fm-modal__criteria {
  display: flex;
  flex-direction: column;
  gap: calc(var(--p-spacing) / 2);
  margin-bottom: calc(var(--p-spacing) * 1.5);
}
.abele-sar-fm-modal__add-button {
  width: fit-content;
  align-self: flex-start;
}
@media (max-width: 845px) {
  .abele-sar-fm-modal__criteria {
    gap: var(--p-spacing);
  }
}
</style>
