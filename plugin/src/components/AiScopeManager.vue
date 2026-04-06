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
          <Search
            :model-value="fileInput"
            placeholder="Search for a file..."
            :suggester="FileSuggest"
            @update:model-value="onFileInput"
          />
        </div>

        <!-- Add folder -->
        <div class="abele-scope-mgr__section">
          <div class="abele-scope-mgr__label">Add folder</div>
          <Search
            :model-value="folderInput"
            placeholder="Search for a folder..."
            :suggester="FolderSuggest"
            @update:model-value="onFolderInput"
          />
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
          >
            <Icon
              :icon="
                entry.type === 'file' ? 'file-text' : entry.type === 'folder' ? 'folder' : 'regex'
              "
            />
            <span class="abele-scope-mgr__entry-path">{{ entry.path }}</span>
            <span class="abele-scope-mgr__entry-type">{{ entry.type }}</span>
            <Icon icon="x" @click="scope.remove(entry)" />
          </div>
        </div>
      </template>

      <!-- Permission mode -->
      <Setting name="Permission mode" desc="Controls which operations require your approval.">
        <Dropdown
          :model-value="permissionMode"
          :options="permissionOptions"
          @update:model-value="onPermissionChange"
        />
      </Setting>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import ObsidianModal from './obsidian/Modal.vue'
import Setting from './obsidian/Setting.vue'
import Search from './obsidian/Search.vue'
import Button from './obsidian/Button.vue'
import Checkbox from './obsidian/Checkbox.vue'
import Dropdown from './obsidian/Dropdown.vue'
import Icon from './obsidian/Icon.vue'
import { FileSuggest } from '@/helpers/suggesters/FileSuggester'
import { FolderSuggest } from '@/helpers/suggesters/FolderSuggester'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { AbeleConfig } from '@/services/AbeleConfig'
import type { PermissionMode } from '@/ai/types'

const emit = defineEmits<{
  (e: 'close'): void
}>()

const scope = ScopeResolver.getInstance()

const fileInput = ref('')
const folderInput = ref('')
const patternInput = ref('')
const permissionMode = ref(AbeleConfig.getInstance().ai.permissionMode)

const resolvedCount = computed(() => scope.resolve().size)

const permissionOptions = [
  { value: 'confirm-all', display: 'Confirm all writes' },
  { value: 'allow-edit', display: 'Allow read + edit' },
  { value: 'allow-all', display: 'Full freedom' },
]

const toggleFullVault = () => {
  scope.setFullVaultAccess(!scope.fullVaultAccess.value)
}

const onFileInput = (value: string) => {
  if (value) {
    scope.addFile(value)
    // Reset after adding — nextTick ensures the Search component re-renders
    nextTick(() => {
      fileInput.value = ''
    })
    return
  }
  fileInput.value = value
}

const onFolderInput = (value: string) => {
  if (value) {
    scope.addFolder(value)
    nextTick(() => {
      folderInput.value = ''
    })
    return
  }
  folderInput.value = value
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
</style>
