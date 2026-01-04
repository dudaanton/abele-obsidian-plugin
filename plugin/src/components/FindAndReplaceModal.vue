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
      <h4>Replacement</h4>
      <div class="abele-sar-fm-modal__replacements">
        <ReplacementActionView
          v-for="action in replacements"
          :key="action.id"
          :action="action"
          @remove="removeReplacement(action.id)"
        />
        <ObsidianIcon
          icon="plus"
          class="abele-sar-fm-modal__add-button"
          text-right="Add replacement"
          @click="addReplacement"
        />
      </div>

      <h4>Results</h4>
      <div class="abele-sar-fm-modal__buttons">
        <ObsidianButton text="Search" accent @click="search" />
        <ObsidianButton text="Replace all" :disabled="!searchResults.length" @click="replace" />
        <div class="abele-sar-fm-modal__count">{{ searchResults.length }} results</div>
      </div>
      <div class="abele-sar-fm-modal__results">
        <div
          v-for="result of searchResultsToShow"
          :key="result.oldPath"
          class="abele-sar-fm-modal__result"
        >
          <a @click="goToNote(result.oldPath)">{{ result.oldPath }}</a>
          <Diff :text-left="result.oldRaw" :text-right="result.newRaw" />
          <ObsidianIcon
            v-if="result.oldRaw !== result.newRaw"
            icon="replace"
            class="abele-sar-fm-modal__add-button"
            text-right="Apply changes to this note"
            @click="replaceOne(result)"
          />
          <ObsidianIcon
            v-if="result.oldRaw !== result.newRaw"
            icon="cross"
            class="abele-sar-fm-modal__add-button"
            text-right="Remove from results"
            @click="removeSearchResult(result)"
          />
        </div>
      </div>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import ObsidianModal from './obsidian/Modal.vue'
import ObsidianButton from './obsidian/Button.vue'
import ObsidianIcon from './obsidian/Icon.vue'
import { computed, ref } from 'vue'
import { Criterion } from '@/entities/Criterion'
import { ReplacementAction } from '@/entities/ReplacementAction'
import CriterionView from './Criterion.vue'
import ReplacementActionView from './ReplacementAction.vue'
import Diff from './Diff.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { stringifyYaml, TFile } from 'obsidian'
import { useInfiniteScroll } from '@vueuse/core'
import { getEditorForFile } from '@/helpers/vaultUtils'
import { getNoteBody, replaceNoteBody } from '@/helpers/notesUtils'

const scrollContainer = ref<HTMLElement | null>(null)
const setScrollContainer = (id: string) => {
  scrollContainer.value = document.querySelector(`.modal-content:has(#${id})`)?.parentElement
}

const resultsBatchSize = 10
const searchResultsToShowCount = ref(resultsBatchSize)

useInfiniteScroll(
  scrollContainer,
  () => {
    if (searchResultsToShowCount.value < searchResults.value.length) {
      searchResultsToShowCount.value += resultsBatchSize
    }
  },
  {
    distance: resultsBatchSize,
    canLoadMore: () => {
      return searchResultsToShowCount.value < searchResults.value.length
    },
  }
)

const criteria = ref<Criterion[]>([new Criterion()])
const replacements = ref<ReplacementAction[]>([new ReplacementAction()])

interface SearchResult {
  oldPath: string
  newPath: string
  oldFrontmatter: Record<string, any>
  newFrontmatter: Record<string, any>
  oldRaw: string
  newRaw: string
  oldContent: string | null
  newContent: string | null
}

const searchResults = ref<SearchResult[]>([])
const searchResultsToShow = computed(() =>
  searchResults.value.slice(0, searchResultsToShowCount.value)
)

const addCriterion = () => {
  criteria.value.push(new Criterion())
}
const removeCriterion = (id: string) => {
  criteria.value = criteria.value.filter((c) => c.id !== id)
}

const addReplacement = () => {
  replacements.value.push(new ReplacementAction())
}
const removeReplacement = (id: string) => {
  replacements.value = replacements.value.filter((r) => r.id !== id)
}

const search = async () => {
  const { app } = GlobalStore.getInstance()

  searchResults.value = []
  searchResultsToShowCount.value = resultsBatchSize

  const notes = app.vault.getMarkdownFiles()

  for (const note of notes) {
    const path = note.path
    const name = note.name.replace(/\.md$/, '')
    const frontmatter = app.metadataCache.getFileCache(note)?.frontmatter

    let content: string | null = null
    let matchesAllCriteria = true
    for (const criterion of criteria.value.filter((c) => c.isValid())) {
      if (criterion.type === 'path' && !criterion.checkPathCriterion(path)) {
        matchesAllCriteria = false
        break
      }
      if (criterion.type === 'name' && !criterion.checkPathCriterion(name)) {
        matchesAllCriteria = false
        break
      }
      if (
        criterion.type === 'property' &&
        (!frontmatter || !criterion.checkPropertyCriterion(frontmatter))
      ) {
        matchesAllCriteria = false
        break
      }
      if (criterion.type === 'content') {
        content = await app.vault.read(note)
        content = getNoteBody(content)

        if (!criterion.checkContentCriterion(content)) {
          matchesAllCriteria = false
          break
        }
      }
    }

    if (!matchesAllCriteria) {
      continue
    }

    const value = {
      oldPath: note.path,
      newPath: note.path,
      oldFrontmatter: frontmatter,
      newFrontmatter: frontmatter,
      oldRaw: '',
      newRaw: '',
      oldContent: content,
      newContent: content,
    }

    for (const replacement of replacements.value.filter((r) => r.isValid())) {
      value.newFrontmatter = replacement.applyPropertyReplacement(value.newFrontmatter)
      value.newFrontmatter = replacement.applyPropertyContentReplacement(value.newFrontmatter)
      value.newPath = replacement.applyPathReplacement(value.newPath)
      if (replacement.type === 'replace-in-content') {
        if (value.oldContent === null) {
          value.oldContent = await app.vault.read(note)
          value.oldContent = getNoteBody(value.oldContent)
          value.newContent = value.oldContent
        }
        value.newContent = replacement.applyContentReplacement(value.newContent)
      }
    }

    value.oldRaw = `path: ${value.oldPath}\n---\n${stringifyYaml(value.oldFrontmatter ?? {})}\n${value.oldContent ?? ''}`
    value.newRaw = `path: ${value.newPath}\n---\n${stringifyYaml(value.newFrontmatter ?? {})}\n${value.newContent ?? ''}`

    searchResults.value.push(value)
  }
}

const replaceOne = async (searchResult: SearchResult) => {
  const { app } = GlobalStore.getInstance()
  const file = app.vault.getAbstractFileByPath(searchResult.oldPath)
  if (file && file instanceof TFile) {
    app.fileManager.processFrontMatter(file, (frontmatter) => {
      for (const [key, value] of Object.entries(searchResult.newFrontmatter)) {
        frontmatter[key] = value
      }
      for (const key of Object.keys(frontmatter || {})) {
        if (!(key in searchResult.newFrontmatter)) {
          console.log('Deleting key', key)
          delete frontmatter[key]
        }
      }
    })

    if (searchResult.oldContent !== searchResult.newContent && searchResult.newContent !== null) {
      const oldContent = await app.vault.read(file)
      const newContent = replaceNoteBody(oldContent, searchResult.newContent)
      await app.vault.modify(file, newContent)
    }

    // If there is editor, it might have already written old content,
    // so we can update its state without losing user changes.
    const editor = getEditorForFile(file)
    if (editor) {
      const newValue = await app.vault.read(file)
      editor.setValue(newValue)
    }

    if (searchResult.oldPath !== searchResult.newPath) {
      app.fileManager.renameFile(file, searchResult.newPath)
    }
    searchResult.oldFrontmatter = searchResult.newFrontmatter
    searchResult.oldPath = searchResult.newPath
    searchResult.oldRaw = searchResult.newRaw
  }
}

const replace = async () => {
  if (
    confirm(`Are you sure you want to apply the changes to ${searchResults.value.length} notes?`)
  ) {
    for (const result of searchResults.value) {
      await replaceOne(result)
    }
  }
}

const goToNote = (path: string) => {
  const { app } = GlobalStore.getInstance()
  const file = app.vault.getAbstractFileByPath(path)
  if (file && file instanceof TFile) {
    app.workspace.getLeaf().openFile(file)
    emit('close')
  }
}

const removeSearchResult = (result: SearchResult) => {
  searchResults.value = searchResults.value.filter((r) => r !== result)
}

const emit = defineEmits<{
  (e: 'close'): void
}>()
</script>

<style lang="scss">
.modal:has(.abele-sar-fm-modal) {
  width: 700px;
}

.abele-sar-fm-modal__description {
  margin-top: calc(var(--p-spacing));
  margin-bottom: calc(var(--p-spacing) * 1.5);
}

.abele-sar-fm-modal__criteria,
.abele-sar-fm-modal__replacements {
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
  .abele-sar-fm-modal__criteria,
  .abele-sar-fm-modal__replacements {
    gap: calc(var(--p-spacing));
  }
}

.abele-sar-fm-modal__buttons {
  display: flex;
  gap: calc(var(--p-spacing) / 4);
}

.abele-sar-fm-modal__results {
  margin-top: calc(var(--p-spacing));
  display: flex;
  flex-direction: column;
  gap: calc(var(--p-spacing));
}

.abele-sar-fm-modal__result {
  display: flex;
  flex-direction: column;
  gap: calc(var(--p-spacing) / 2);
  padding: calc(var(--p-spacing) / 2);
  border: var(--border-width) solid var(--background-modifier-border);
  border-radius: var(--radius-s);

  p {
    margin: 0;
  }

  .cm-gutters.cm-gutters-before {
    background-color: transparent;
  }

  .cm-mergeViewEditor:first-child {
    .cm-gutters.cm-gutters-before {
      border: none;
    }
  }
}

.abele-sar-fm-modal__count {
  margin-left: calc(var(--p-spacing) / 2);
  align-self: center;
  color: var(--text-muted);
}
</style>
