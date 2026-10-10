<template>
  <div class="abele-scope-editor">
    <!-- Full vault toggle -->
    <Setting name="Full vault access" desc="Give the agent access to all files in the vault.">
      <Checkbox
        :is-enabled="fullVaultAccess"
        @toggle="emit('update:fullVaultAccess', !fullVaultAccess)"
      />
    </Setting>

    <template v-if="!fullVaultAccess">
      <!-- Add file -->
      <Setting name="Add file">
        <Search
          model-value=""
          label="Add file"
          placeholder="Search for a file..."
          :make-suggest="suggestFile"
        />
        <Button
          v-if="showCurrentFile"
          :text="activeFilePath ? `Add current (${activeFileName})` : 'No file open'"
          :disabled="!activeFilePath"
          tooltip="Add the current file to this scope"
          @click="addCurrentFile"
        />
      </Setting>

      <!-- Add folder -->
      <Setting name="Add folder">
        <Search
          model-value=""
          label="Add folder"
          placeholder="Search for a folder..."
          :make-suggest="suggestFolder"
        />
      </Setting>

      <!-- Add group -->
      <Setting name="Add group">
        <Search
          model-value=""
          label="Add group"
          placeholder="Search for a group note..."
          :make-suggest="suggestGroup"
        />
      </Setting>

      <!-- Add pattern -->
      <Setting name="Add pattern">
        <Input
          v-model="patternInput"
          aria-label="Scope pattern"
          placeholder="e.g. Projects/**/*.md"
          @keydown.enter="addPattern"
        />
        <Button text="Add" tooltip="Add this pattern to the scope" @click="addPattern" />
      </Setting>

      <!-- Current scope entries -->
      <Section v-if="entries.length" title="Scope entries" class="abele-scope-mgr__entries">
        <div
          v-for="(entry, idx) in entries"
          :key="idx"
          class="abele-scope-mgr__entry"
          @click="togglePreview(entry)"
        >
          <Icon :icon="entryIcon(entry.type)" />
          <span class="abele-scope-mgr__entry-path">{{ entry.path }}</span>
          <span class="abele-scope-mgr__entry-type">{{ entry.type }}</span>
          <Icon
            icon="x"
            :tooltip="`Remove ${entry.path} from scope`"
            @click.stop="removeEntry(entry)"
          />
        </div>
        <!-- Preview for selected group -->
        <div v-if="previewEntry" class="abele-scope-mgr__preview">
          <div class="abele-scope-mgr__preview-header">
            {{ previewEntry.path }} ({{ previewPaths.length }} files)
          </div>
          <div v-for="p in previewPaths" :key="p" class="abele-scope-mgr__preview-item">
            {{ p }}
          </div>
        </div>
      </Section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import Search from './obsidian/Search.vue'
import Input from './obsidian/Input.vue'
import Section from './obsidian/Section.vue'
import Setting from './obsidian/Setting.vue'
import Button from './obsidian/Button.vue'
import Checkbox from './obsidian/Checkbox.vue'
import Icon from './obsidian/Icon.vue'
import { FileSuggest } from '@/helpers/suggesters/FileSuggester'
import { FolderSuggest } from '@/helpers/suggesters/FolderSuggester'
import { ScopeResolver } from '@/ai/ScopeResolver'
import type { ScopeEntry } from '@/ai/ScopeResolver'
import { GlobalStore } from '@/stores/GlobalStore'

const props = withDefaults(
  defineProps<{
    entries: ScopeEntry[]
    fullVaultAccess: boolean
    showCurrentFile?: boolean
  }>(),
  { showCurrentFile: false }
)

const emit = defineEmits<{
  (e: 'update:entries', entries: ScopeEntry[]): void
  (e: 'update:fullVaultAccess', value: boolean): void
}>()

const { app } = GlobalStore.getInstance()

const activeFilePath = computed(() => app.workspace.getActiveFile()?.path || '')
const activeFileName = computed(() => {
  const name = app.workspace.getActiveFile()?.name || ''
  return name.length > 30 ? name.slice(0, 27) + '...' : name
})

const addCurrentFile = () => {
  if (activeFilePath.value) {
    addEntry({ type: 'file', path: activeFilePath.value })
  }
}

const patternInput = ref('')
const previewEntry = ref<ScopeEntry | null>(null)

const addEntry = (entry: ScopeEntry) => {
  if (props.entries.some((e) => e.type === entry.type && e.path === entry.path)) return
  emit('update:entries', [...props.entries, entry])
}

const removeEntry = (entry: ScopeEntry) => {
  emit(
    'update:entries',
    props.entries.filter((e) => !(e.type === entry.type && e.path === entry.path))
  )
  if (previewEntry.value?.path === entry.path) previewEntry.value = null
}

const attachSuggester = (
  inputEl: HTMLInputElement,
  Suggester: typeof FileSuggest | typeof FolderSuggest,
  onSelect: (path: string) => void,
  options?: { allFileTypes?: boolean }
) => {
  const suggester =
    Suggester === FileSuggest ? new FileSuggest(app, inputEl, options) : new Suggester(app, inputEl)
  suggester.selectSuggestion = (item: any) => {
    const path = item.path as string
    onSelect(path)
    suggester.refresh()
  }
  return suggester
}

const suggestFile = (input: HTMLInputElement) =>
  attachSuggester(input, FileSuggest, (path) => addEntry({ type: 'file', path }), {
    allFileTypes: true,
  })
const suggestFolder = (input: HTMLInputElement) =>
  attachSuggester(input, FolderSuggest, (path) => addEntry({ type: 'folder', path }))
const suggestGroup = (input: HTMLInputElement) =>
  attachSuggester(input, FileSuggest, (path) => addEntry({ type: 'group', path }))

const entryIcon = (type: string) => {
  switch (type) {
    case 'file':
      return 'file-text'
    case 'folder':
      return 'folder'
    case 'group':
      return 'users'
    default:
      return 'regex'
  }
}

const previewPaths = computed(() => {
  if (!previewEntry.value || previewEntry.value.type !== 'group') return []
  return ScopeResolver.getInstance().resolveGroupPaths(previewEntry.value.path)
})

const togglePreview = (entry: ScopeEntry) => {
  if (entry.type !== 'group') {
    previewEntry.value = null
    return
  }
  previewEntry.value = previewEntry.value?.path === entry.path ? null : entry
}

const addPattern = () => {
  const p = patternInput.value.trim()
  if (p) {
    addEntry({ type: 'pattern', path: p })
    patternInput.value = ''
  }
}
</script>

<style lang="scss">
.abele-scope-editor {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);
}

.abele-scope-mgr__entries {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
}

.abele-scope-mgr__entry {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
  padding: var(--size-4-1) var(--size-4-2);
  border-radius: var(--radius-s);
  font-size: var(--font-small);

  &:hover {
    background-color: var(--background-modifier-hover);
  }
}

.abele-scope-mgr__entry-path {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.abele-scope-mgr__entry-type {
  color: var(--text-faint);
  font-size: var(--font-smaller);
}

.abele-scope-mgr__preview {
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s);
  padding: var(--size-4-2);
  font-size: var(--font-smaller);
}

.abele-scope-mgr__preview-header {
  font-weight: 600;
  margin-bottom: var(--size-4-1);
  color: var(--text-muted);
}

.abele-scope-mgr__preview-item {
  padding: 1px 0;
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
