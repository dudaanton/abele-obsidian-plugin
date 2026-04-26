<template>
  <div class="abele-far-bases">
    <h4>Replacement</h4>
    <div class="abele-far-bases__replacements">
      <ReplacementActionView
        v-for="action in replacements"
        :key="action.id"
        :action="action"
        @remove="removeReplacement(action.id)"
      />
      <ObsidianIcon
        icon="plus"
        class="abele-far-bases__add-button"
        text-right="Add replacement"
        @click="addReplacement"
      />
    </div>

    <h4>Results</h4>
    <div class="abele-far-bases__buttons">
      <ObsidianButton text="Preview" accent @click="preview" />
      <ObsidianButton text="Replace all" :disabled="!searchResults.length" @click="replace" />
      <ObsidianButton text="Use in AI" :disabled="!props.files.value.length" @click="sendToAgent" />
      <div class="abele-far-bases__count">{{ searchResults.length }} results</div>
    </div>
    <div class="abele-far-bases__results">
      <div
        v-for="result of searchResultsToShow"
        :key="result.oldPath"
        class="abele-far-bases__result"
      >
        <a @click="goToNote(result.oldPath)">{{ result.oldPath }}</a>
        <Diff :text-left="result.oldRaw" :text-right="result.newRaw" />
        <ObsidianIcon
          v-if="result.oldRaw !== result.newRaw"
          icon="replace"
          class="abele-far-bases__add-button"
          text-right="Apply changes to this note"
          @click="replaceOne(result)"
        />
        <ObsidianIcon
          v-if="result.oldRaw !== result.newRaw"
          icon="cross"
          class="abele-far-bases__add-button"
          text-right="Remove from results"
          @click="removeSearchResult(result)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import ObsidianButton from './obsidian/Button.vue'
import ObsidianIcon from './obsidian/Icon.vue'
import { computed, ref, watch, type Ref } from 'vue'
import { ReplacementAction } from '@/entities/ReplacementAction'
import ReplacementActionView from './ReplacementAction.vue'
import Diff from './Diff.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { stringifyYaml, TFile } from 'obsidian'
import { getEditorForFile } from '@/helpers/vaultUtils'
import { getNoteBody, replaceNoteBody } from '@/helpers/notesUtils'
import { useFilesInAgent } from '@/helpers/useFilesInAgent'

const props = defineProps<{
  files: Ref<TFile[]>
}>()

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
const visibleCount = ref(50)
const searchResultsToShow = computed(() => searchResults.value.slice(0, visibleCount.value))

watch(
  () => props.files.value,
  () => preview(),
  { immediate: true }
)

const addReplacement = () => {
  replacements.value.push(new ReplacementAction())
}
const removeReplacement = (id: string) => {
  replacements.value = replacements.value.filter((r) => r.id !== id)
}

const preview = async () => {
  const { app } = GlobalStore.getInstance()

  searchResults.value = []
  visibleCount.value = 50

  for (const note of props.files.value) {
    const frontmatter = app.metadataCache.getFileCache(note)?.frontmatter
    let content: string | null = null

    const value: SearchResult = {
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
          delete frontmatter[key]
        }
      }
    })

    if (searchResult.oldContent !== searchResult.newContent && searchResult.newContent !== null) {
      const oldContent = await app.vault.read(file)
      const newContent = replaceNoteBody(oldContent, searchResult.newContent)
      await app.vault.modify(file, newContent)
    }

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
  }
}

const sendToAgent = () => {
  useFilesInAgent(props.files.value)
}

const removeSearchResult = (result: SearchResult) => {
  searchResults.value = searchResults.value.filter((r) => r !== result)
}
</script>

<style lang="scss">
.abele-far-bases {
  padding: var(--size-4-2);
}

.abele-far-bases__replacements {
  display: flex;
  flex-direction: column;
  gap: calc(var(--p-spacing) / 2);
  margin-bottom: calc(var(--p-spacing) * 1.5);
}

.abele-far-bases__add-button {
  width: fit-content;
  align-self: flex-start;
}

.abele-far-bases__buttons {
  display: flex;
  gap: calc(var(--p-spacing) / 4);
}

.abele-far-bases__results {
  margin-top: calc(var(--p-spacing));
  display: flex;
  flex-direction: column;
  gap: calc(var(--p-spacing));
}

.abele-far-bases__result {
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

.abele-far-bases__count {
  margin-left: calc(var(--p-spacing) / 2);
  align-self: center;
  color: var(--text-muted);
}
</style>
