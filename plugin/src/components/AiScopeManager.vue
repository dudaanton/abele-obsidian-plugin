<template>
  <div class="abele-scope-mgr">
    <AgentOverrideNotice
      field="scope"
      from-agent="Scope comes from this chat's agent."
      overridden="Scope is overridden for this chat."
    />
    <AiScopeEditor
      :entries="scopeEntries"
      :full-vault-access="scope?.fullVaultAccess.value ?? false"
      :show-current-file="true"
      @update:entries="onEntriesUpdate"
      @update:full-vault-access="scope?.setFullVaultAccess($event)"
    />

    <AgentOverrideNotice
      field="permissionMode"
      from-agent="Permission mode comes from this chat's agent."
      overridden="Permission mode is overridden for this chat."
    />

    <Setting name="Permission mode" desc="Controls which file operations require your approval.">
      <Dropdown
        :model-value="permissionMode"
        :options="permissionOptions"
        @update:model-value="onPermissionChange"
      />
    </Setting>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Setting from './obsidian/Setting.vue'
import Dropdown from './obsidian/Dropdown.vue'
import AiScopeEditor from './AiScopeEditor.vue'
import AgentOverrideNotice from './AgentOverrideNotice.vue'
import type { ScopeEntry } from '@/ai/ScopeResolver'
import { ChatService } from '@/ai/ChatService'
import type { PermissionMode } from '@/ai/types'

const session = computed(() => ChatService.getInstance().activeSession.value)
const scope = computed(() => session.value?.scopeResolver)
const permissionMode = computed(() => session.value?.permissionMode.value ?? 'confirm-all')
const scopeEntries = computed(() => scope.value?.entries.value ?? [])

const onEntriesUpdate = (entries: ScopeEntry[]) => {
  if (!scope.value) return
  scope.value.entries.value = entries
  scope.value.invalidate()
}

const permissionOptions = [
  { value: 'confirm-all', display: 'Confirm all writes' },
  { value: 'allow-edit', display: 'Allow read + edit' },
  { value: 'allow-all', display: 'Full freedom' },
]

const onPermissionChange = (value: string) => {
  if (!session.value) return
  session.value.permissionMode.value = value as PermissionMode
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
