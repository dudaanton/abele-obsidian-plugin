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

      <Setting name="Download files" desc="Allow agent to download files without asking.">
        <Checkbox :is-enabled="allowDownload" @toggle="toggleSetting('allowDownload')" />
      </Setting>

      <Setting name="Wise model" desc="Allow agent to consult the wise model without asking.">
        <Checkbox :is-enabled="allowWiseModel" @toggle="toggleSetting('allowWiseModel')" />
      </Setting>

      <Setting name="Image generation" desc="Allow agent to generate/edit images without asking.">
        <Checkbox
          :is-enabled="allowImageGeneration"
          @toggle="toggleSetting('allowImageGeneration')"
        />
      </Setting>

      <Setting name="Eval JS" desc="Allow agent to execute JavaScript code without asking.">
        <Checkbox :is-enabled="allowEvalJs" @toggle="toggleSetting('allowEvalJs')" />
      </Setting>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import ObsidianModal from './obsidian/Modal.vue'
import Setting from './obsidian/Setting.vue'
import Checkbox from './obsidian/Checkbox.vue'
import Dropdown from './obsidian/Dropdown.vue'
import AiScopeEditor from './AiScopeEditor.vue'
import { ScopeResolver } from '@/ai/ScopeResolver'
import type { ScopeEntry } from '@/ai/ScopeResolver'
import { AbeleConfig } from '@/services/AbeleConfig'
import { AgentService } from '@/ai/AgentService'
import type { PermissionMode } from '@/ai/types'

const emit = defineEmits<{
  (e: 'close'): void
}>()

const scope = ScopeResolver.getInstance()
const agent = AgentService.getInstance()
const permissionMode = ref(AbeleConfig.getInstance().ai.permissionMode)
const {
  allowWebSearch,
  allowFetch,
  allowDownload,
  allowWiseModel,
  allowImageGeneration,
  allowEvalJs,
} = agent

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

const toggleSetting = (
  key:
    | 'allowWebSearch'
    | 'allowFetch'
    | 'allowDownload'
    | 'allowWiseModel'
    | 'allowImageGeneration'
    | 'allowEvalJs'
) => {
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
</style>
