<template>
  <ObsidianModal
    size="wide"
    title="Find and replace"
    @close="emit('close')"
    @expose-id="setScrollContainer"
  >
    <div class="abele-sar-fm-modal">
      <Setting
        heading
        name="Which notes"
        desc="Notes that match every condition. Lists are separated by semicolons."
      />
      <div class="abele-sar-fm-modal__criteria">
        <CriterionView
          v-for="criterion in criteria"
          :key="criterion.id"
          :criterion="criterion"
          @remove="removeCriterion(criterion.id)"
        />
        <ObsidianButton
          quiet
          icon="plus"
          text="Add a condition"
          tooltip="Another condition every note found must meet"
          class="abele-sar-fm-modal__add-button"
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
        :inline-actions="false"
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
    <template #footer>
      <ObsidianButton
        quiet
        text="Use in AI"
        tooltip="Hand the notes found to a chat with the agent"
        :disabled="!searchResults.length"
        @click="sendToAgent"
      />
      <ObsidianButton
        text="Search"
        tooltip="Find the notes and show what would change in each"
        :accent="!searchResults.length"
        @click="search"
      />
      <ObsidianButton
        v-if="searchResults.length"
        :text="`Replace in ${searchResults.length} ${searchResults.length === 1 ? 'note' : 'notes'}`"
        tooltip="Make the changes in every note listed"
        accent
        @click="replace"
      />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { TFile } from 'obsidian'
import { Criterion } from '@/entities/Criterion'
import { GlobalStore } from '@/stores/GlobalStore'
import { useReplacementPreview } from '@/composables/useReplacementPreview'
import ObsidianModal from './obsidian/Modal.vue'
import ObsidianButton from './obsidian/Button.vue'
import Setting from './obsidian/Setting.vue'
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
.abele-sar-fm-modal__criteria {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  margin-bottom: var(--size-4-6);
}

.abele-sar-fm-modal .abele-sar-fm-modal__add-button {
  align-self: flex-start;
  margin-top: var(--size-2-2);
}
</style>
