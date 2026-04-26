<template>
  <ObsidianModal title="Workspace Scope" @close="emit('close')">
    <div class="abele-scope-mgr">
      <AiScopeEditor
        :entries="scopeEntries"
        :full-vault-access="scope.fullVaultAccess.value"
        :show-current-file="true"
        @update:entries="onEntriesUpdate"
        @update:full-vault-access="scope.setFullVaultAccess($event)"
      />

      <Setting name="Permission mode" desc="Controls which file operations require your approval.">
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
import { ref, computed } from 'vue'
import ObsidianModal from './obsidian/Modal.vue'
import Setting from './obsidian/Setting.vue'
import Dropdown from './obsidian/Dropdown.vue'
import AiScopeEditor from './AiScopeEditor.vue'
import { ScopeResolver } from '@/ai/ScopeResolver'
import type { ScopeEntry } from '@/ai/ScopeResolver'
import { AbeleConfig } from '@/services/AbeleConfig'
import type { PermissionMode } from '@/ai/types'

const emit = defineEmits<{
  (e: 'close'): void
}>()

const scope = ScopeResolver.getInstance()
const permissionMode = ref(AbeleConfig.getInstance().ai.permissionMode)
const scopeEntries = computed(() => scope.entries.value)

const onEntriesUpdate = (entries: ScopeEntry[]) => {
  scope.entries.value = entries
  scope.invalidate()
}

const permissionOptions = [
  { value: 'confirm-all', display: 'Confirm all writes' },
  { value: 'allow-edit', display: 'Allow read + edit' },
  { value: 'allow-all', display: 'Full freedom' },
]

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
</style>
