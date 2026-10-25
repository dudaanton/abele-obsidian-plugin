<template>
  <div class="abele-scope-mgr">
    <AgentOverrideNotice field="scope" from-agent="Scope comes from this chat's agent." />
    <AiScopeEditor
      :entries="scopeEntries"
      :full-vault-access="scope?.fullVaultAccess.value ?? false"
      @update:entries="onEntriesUpdate"
      @update:full-vault-access="scope?.setFullVaultAccess($event)"
    />

    <AiNodeScopeEditor v-if="session" :key="session.id" :session="session" />

    <div class="abele-scope-mgr__group">
      <AgentOverrideNotice
        field="permissionMode"
        from-agent="Permission mode comes from this chat's agent."
      />
      <Setting
        :name="t('streamB.permissionMode.c7a8e6')"
        :desc="t('chatTree.permissionNodes')"
      >
        <Dropdown
          :model-value="permissionMode"
          :options="PERMISSION_OPTIONS"
          @update:model-value="onPermissionChange"
        />
      </Setting>
    </div>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { computed } from 'vue'
import Setting from './obsidian/Setting.vue'
import Dropdown from './obsidian/Dropdown.vue'
import AiScopeEditor from './AiScopeEditor.vue'
import AiNodeScopeEditor from './AiNodeScopeEditor.vue'
import AgentOverrideNotice from './AgentOverrideNotice.vue'
import type { ScopeEntry } from '@/ai/ScopeResolver'
import { ChatService } from '@/ai/ChatService'
import type { PermissionMode } from '@/ai/types'
import { PERMISSION_OPTIONS } from './settings/ai/options'

const session = computed(() => ChatService.getInstance().activeSession.value)
const scope = computed(() => session.value?.scopeResolver)
const permissionMode = computed(() => session.value?.permissionMode.value ?? 'confirm-all')
const scopeEntries = computed(() => scope.value?.entries.value ?? [])

const onEntriesUpdate = (entries: ScopeEntry[]) => {
  if (!scope.value) return
  scope.value.entries.value = entries
  scope.value.invalidate()
}

const onPermissionChange = (value: string) => {
  if (!session.value) return
  session.value.permissionMode.value = value as PermissionMode
}
</script>

<style lang="scss">
.abele-scope-mgr {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);
  padding-top: var(--size-4-2);
}

/* The vault, the nodes and the approval as three groups, a rule between them as between
   Obsidian's own rows; inside a group its rows follow without one. */
.abele-scope-mgr__group,
.abele-scope-mgr > .abele-node-scope-editor {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  padding-top: var(--size-4-4);
  border-top: var(--border-width) solid var(--background-modifier-border);

  > .setting-item {
    padding-top: 0;
    border-top: none;
  }
}
</style>
