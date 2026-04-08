<template>
  <ObsidianModal title="Workspace Scope" @close="emit('close')">
    <div class="abele-scope-mgr">
      <!-- Full vault toggle -->
      <Setting name="Full vault access" desc="Give the agent access to all files in the vault.">
        <Checkbox :is-enabled="scope.fullVaultAccess.value" @toggle="toggleFullVault" />
      </Setting>

      <template v-if="!scope.fullVaultAccess.value">
        <!-- Add file -->
        <div class="abele-scope-mgr__section">
          <div class="abele-scope-mgr__label">Add file</div>
          <input ref="fileInputEl" type="text" placeholder="Search for a file..." />
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
        <div v-if="scope.entries.value.length" class="abele-scope-mgr__entries">
          <div class="abele-scope-mgr__label">Current scope ({{ resolvedCount }} files)</div>
          <div
            v-for="(entry, idx) in scope.entries.value"
            :key="idx"
            class="abele-scope-mgr__entry"
            @click="togglePreview(entry)"
          >
            <Icon :icon="entryIcon(entry.type)" />
            <span class="abele-scope-mgr__entry-path">{{ entry.path }}</span>
            <span class="abele-scope-mgr__entry-type">{{ entry.type }}</span>
            <span v-if="entry.type === 'group'" class="abele-scope-mgr__entry-count">
              {{ scope.resolveGroupPaths(entry.path).length }}
            </span>
            <Icon icon="x" @click.stop="scope.remove(entry)" />
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

      <!-- Permissions -->
      <Setting name="Permission mode" desc="Controls which file operations require your approval.">
        <Dropdown
          :model-value="permissionMode"
          :options="permissionOptions"
          @update:model-value="onPermissionChange"
        />
      </Setting>

      <Setting name="Web search" desc="Allow agent to search the web without asking.">
        <Checkbox :is-enabled="allowWebSearch" @toggle="toggleSetting('allowWebSearch')" />
      </Setting>

      <Setting name="Fetch URL" desc="Allow agent to send HTTP requests without asking.">
        <Checkbox :is-enabled="allowFetch" @toggle="toggleSetting('allowFetch')" />
      </Setting>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { AbstractInputSuggest } from 'obsidian'
import ObsidianModal from './obsidian/Modal.vue'
import Setting from './obsidian/Setting.vue'
import Button from './obsidian/Button.vue'
import Checkbox from './obsidian/Checkbox.vue'
import Dropdown from './obsidian/Dropdown.vue'
import Icon from './obsidian/Icon.vue'
import { FileSuggest } from '@/helpers/suggesters/FileSuggester'
import { FolderSuggest } from '@/helpers/suggesters/FolderSuggester'
import { ScopeResolver } from '@/ai/ScopeResolver'
import type { ScopeEntry } from '@/ai/ScopeResolver'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { AgentService } from '@/ai/AgentService'
import type { PermissionMode } from '@/ai/types'

const emit = defineEmits<{
  (e: 'close'): void
}>()

const { app } = GlobalStore.getInstance()
const scope = ScopeResolver.getInstance()

const fileInputEl = ref<HTMLInputElement | null>(null)
const folderInputEl = ref<HTMLInputElement | null>(null)
const groupInputEl = ref<HTMLInputElement | null>(null)
const patternInput = ref('')
const agent = AgentService.getInstance()
const permissionMode = ref(AbeleConfig.getInstance().ai.permissionMode)
const { allowWebSearch, allowFetch } = agent
const previewEntry = ref<ScopeEntry | null>(null)

const resolvedCount = computed(() => scope.resolve().size)

const suggesters: AbstractInputSuggest<unknown>[] = []

/**
 * Create a suggester that adds to scope on selection, then clears and re-attaches.
 */
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
    // Keep input and re-trigger suggestions so user can select more
    suggester.onInputChanged()
  }
  suggesters.push(suggester)
}

onMounted(() => {
  if (fileInputEl.value) {
    attachSuggester(fileInputEl.value, FileSuggest, (path) => scope.addFile(path), {
      allFileTypes: true,
    })
  }
  if (folderInputEl.value) {
    attachSuggester(folderInputEl.value, FolderSuggest, (path) => scope.addFolder(path))
  }
  if (groupInputEl.value) {
    attachSuggester(groupInputEl.value, FileSuggest, (path) => scope.addGroup(path))
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
  if (!previewEntry.value) return []
  if (previewEntry.value.type === 'group') {
    return scope.resolveGroupPaths(previewEntry.value.path)
  }
  return []
})

const togglePreview = (entry: ScopeEntry) => {
  if (entry.type !== 'group') {
    previewEntry.value = null
    return
  }
  previewEntry.value = previewEntry.value?.path === entry.path ? null : entry
}

const permissionOptions = [
  { value: 'confirm-all', display: 'Confirm all writes' },
  { value: 'allow-edit', display: 'Allow read + edit' },
  { value: 'allow-all', display: 'Full freedom' },
]

const toggleFullVault = () => {
  scope.setFullVaultAccess(!scope.fullVaultAccess.value)
}

const addPattern = () => {
  const p = patternInput.value.trim()
  if (p) {
    scope.addPattern(p)
    patternInput.value = ''
  }
}

const onPermissionChange = (value: string) => {
  permissionMode.value = value as PermissionMode
  const config = AbeleConfig.getInstance()
  config.ai.permissionMode = value as PermissionMode
  config.saveSettings()
}

const toggleSetting = (key: 'allowWebSearch' | 'allowFetch') => {
  agent[key].value = !agent[key].value
}
</script>

<style lang="scss">
.modal:has(.abele-scope-mgr) {
  width: 500px;
}

.abele-scope-mgr {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);
  padding-top: var(--size-4-2);
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
  max-height: 250px;
  overflow-y: auto;
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

.abele-scope-mgr__entry-count {
  font-size: var(--font-smaller);
  color: var(--text-accent);
}

.abele-scope-mgr__preview {
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s);
  padding: var(--size-4-2);
  max-height: 150px;
  overflow-y: auto;
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
