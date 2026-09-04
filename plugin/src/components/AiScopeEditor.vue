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
      <div class="abele-scope-mgr__section">
        <div class="abele-scope-mgr__label">Add file</div>
        <input ref="fileInputEl" type="text" placeholder="Search for a file..." />
        <Button
          v-if="showCurrentFile"
          :text="activeFilePath ? `Add current (${activeFileName})` : 'No file open'"
          :disabled="!activeFilePath"
          @click="addCurrentFile"
        />
      </div>

      <!-- Add folder -->
      <div class="abele-scope-mgr__section">
        <div class="abele-scope-mgr__label">Add folder</div>
        <input ref="folderInputEl" type="text" placeholder="Search for a folder..." />
      </div>

      <!-- Add group -->
      <div class="abele-scope-mgr__section">
        <div class="abele-scope-mgr__label">Add group</div>
        <input ref="groupInputEl" type="text" placeholder="Search for a group note..." />
      </div>

      <!-- Add pattern -->
      <div class="abele-scope-mgr__section">
        <div class="abele-scope-mgr__label">Add pattern</div>
        <div class="abele-scope-mgr__pattern-row">
          <input
            type="text"
            :value="patternInput"
            placeholder="e.g. Projects/**/*.md"
            @input="patternInput = ($event.target as HTMLInputElement).value"
            @keydown.enter="addPattern"
          />
          <Button text="Add" @click="addPattern" />
        </div>
      </div>

      <!-- Current scope entries -->
      <div v-if="entries.length" class="abele-scope-mgr__entries">
        <div class="abele-scope-mgr__label">Scope entries</div>
        <div
          v-for="(entry, idx) in entries"
          :key="idx"
          class="abele-scope-mgr__entry"
          @click="togglePreview(entry)"
        >
          <Icon :icon="entryIcon(entry.type)" />
          <span class="abele-scope-mgr__entry-path">{{ entry.path }}</span>
          <span class="abele-scope-mgr__entry-type">{{ entry.type }}</span>
          <Icon icon="x" @click.stop="removeEntry(entry)" />
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
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { AbstractInputSuggest } from 'obsidian'
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

const fileInputEl = ref<HTMLInputElement | null>(null)
const folderInputEl = ref<HTMLInputElement | null>(null)
const groupInputEl = ref<HTMLInputElement | null>(null)
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

const suggesters: AbstractInputSuggest<unknown>[] = []

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
  suggesters.push(suggester)
}

onMounted(() => {
  if (fileInputEl.value) {
    attachSuggester(fileInputEl.value, FileSuggest, (path) => addEntry({ type: 'file', path }), {
      allFileTypes: true,
    })
  }
  if (folderInputEl.value) {
    attachSuggester(folderInputEl.value, FolderSuggest, (path) =>
      addEntry({ type: 'folder', path })
    )
  }
  if (groupInputEl.value) {
    attachSuggester(groupInputEl.value, FileSuggest, (path) => addEntry({ type: 'group', path }))
  }
})

onUnmounted(() => {
  for (const s of suggesters) s.close()
})

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

.abele-scope-mgr__section {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
}

.abele-scope-mgr__label {
  font-size: var(--font-small);
  color: var(--text-muted);
}

.abele-scope-mgr__pattern-row {
  display: flex;
  gap: var(--size-4-1);

  input {
    flex: 1;
  }
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
