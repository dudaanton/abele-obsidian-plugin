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
        <div v-if="result.error" role="alert">{{ result.error }}</div>
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
import { confirmAction } from '@/modal/confirm'
import ObsidianButton from './obsidian/Button.vue'
import ObsidianIcon from './obsidian/Icon.vue'
import { computed, ref, watch, type Ref } from 'vue'
import { ReplacementAction } from '@/entities/ReplacementAction'
import ReplacementActionView from './ReplacementAction.vue'
import Diff from './Diff.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { stringifyYaml, TFile } from 'obsidian'
import { getNoteBody } from '@/helpers/notesUtils'
import {
  applyReplacementPreview,
  replacementFrontmatter,
  type ReplacementPreview,
} from '@/helpers/bulkReplacement'
const useFilesInAgent = (
  ...args: Parameters<typeof import('@/helpers/useFilesInAgent').useFilesInAgent>
) => import('@/helpers/useFilesInAgent').then((m) => m.useFilesInAgent(...args))

const props = defineProps<{
  files: Ref<TFile[]>
}>()

const replacements = ref<ReplacementAction[]>([new ReplacementAction()])

type SearchResult = ReplacementPreview

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

async function preview() {
  const { app } = GlobalStore.getInstance()

  searchResults.value = []
  visibleCount.value = 50

  for (const note of props.files.value) {
    const sourceText = await app.vault.read(note)
    const sourceMtime = note.stat.mtime
    const frontmatter = replacementFrontmatter(sourceText)
    let content: string | null = null

    const value: SearchResult = {
      sourceText,
      sourceMtime,
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
          value.oldContent = getNoteBody(sourceText)
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
  await applyReplacementPreview(app, searchResult)
}

const replace = async () => {
  const results = [...searchResults.value]
  if (
    await confirmAction(GlobalStore.getInstance().app, {
      title: 'Apply changes',
      message: `Are you sure you want to apply the changes to ${results.length} notes?`,
      confirmText: 'Apply changes',
      confirmTooltip: 'Apply the previewed changes to these notes',
    })
  ) {
    for (const result of results) {
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
