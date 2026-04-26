<template>
  <ObsidianModal title="Permissions" @close="emit('close')">
    <div class="abele-permissions">
      <Setting name="Web search" desc="Allow agent to search the web without asking.">
        <Checkbox :is-enabled="allowWebSearch" @toggle="toggle('allowWebSearch')" />
      </Setting>

      <Setting name="Fetch URL" desc="Allow agent to send HTTP requests without asking.">
        <Checkbox :is-enabled="allowFetch" @toggle="toggle('allowFetch')" />
      </Setting>

      <Setting name="Download files" desc="Allow agent to download files without asking.">
        <Checkbox :is-enabled="allowDownload" @toggle="toggle('allowDownload')" />
      </Setting>

      <Setting name="Wise model" desc="Allow agent to consult the wise model without asking.">
        <Checkbox :is-enabled="allowWiseModel" @toggle="toggle('allowWiseModel')" />
      </Setting>

      <Setting name="Image generation" desc="Allow agent to generate/edit images without asking.">
        <Checkbox :is-enabled="allowImageGeneration" @toggle="toggle('allowImageGeneration')" />
      </Setting>

      <Setting name="Eval JS" desc="Allow agent to execute JavaScript code without asking.">
        <Checkbox :is-enabled="allowEvalJs" @toggle="toggle('allowEvalJs')" />
      </Setting>

      <Setting name="Create files" desc="Allow agent to create new files without asking.">
        <Checkbox :is-enabled="allowCreateFiles" @toggle="toggle('allowCreateFiles')" />
      </Setting>

      <Setting name="Delegate" desc="Allow agent to delegate tasks to sub-agents without asking.">
        <Checkbox :is-enabled="allowDelegate" @toggle="toggle('allowDelegate')" />
      </Setting>

      <Setting name="Create scripts" desc="Allow agent to create new scripts without asking.">
        <Checkbox :is-enabled="allowCreateScript" @toggle="toggle('allowCreateScript')" />
      </Setting>

      <!-- Scripts -->
      <template v-if="scriptTools.length">
        <h4 class="abele-permissions__heading">Scripts</h4>

        <Setting name="All scripts" desc="Allow agent to run any script without asking.">
          <Checkbox :is-enabled="allowScripts" @toggle="toggle('allowScripts')" />
        </Setting>

        <template v-if="!allowScripts">
          <Setting v-for="s in scriptTools" :key="s.toolName" :name="s.name" :desc="s.description">
            <Checkbox
              :is-enabled="allowedScripts[s.toolName] ?? false"
              @toggle="toggleScript(s.toolName)"
            />
          </Setting>
        </template>
      </template>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import ObsidianModal from './obsidian/Modal.vue'
import Setting from './obsidian/Setting.vue'
import Checkbox from './obsidian/Checkbox.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { AgentService } from '@/ai/AgentService'
import { ScriptService } from '@/scripting/ScriptService'

const emit = defineEmits<{
  (e: 'close'): void
}>()

const agent = AgentService.getInstance()
const {
  allowWebSearch,
  allowFetch,
  allowDownload,
  allowWiseModel,
  allowImageGeneration,
  allowEvalJs,
  allowCreateFiles,
  allowDelegate,
  allowScripts,
  allowedScripts,
  allowCreateScript,
} = agent

const scriptTools = computed(() => {
  const config = AbeleConfig.getInstance().ai
  if (!config.scriptsEnabled) return []
  return ScriptService.getInstance()
    .getAll()
    .map((s) => ({
      toolName: `script_${s.meta.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')}`,
      name: s.meta.name,
      description: s.meta.description || s.path,
    }))
})

const toggle = (
  key:
    | 'allowWebSearch'
    | 'allowFetch'
    | 'allowDownload'
    | 'allowWiseModel'
    | 'allowImageGeneration'
    | 'allowEvalJs'
    | 'allowCreateFiles'
    | 'allowDelegate'
    | 'allowScripts'
    | 'allowCreateScript'
) => {
  agent[key].value = !agent[key].value
}

const toggleScript = (toolName: string) => {
  allowedScripts.value = {
    ...allowedScripts.value,
    [toolName]: !allowedScripts.value[toolName],
  }
}
</script>

<style lang="scss">
.modal:has(.abele-permissions) {
  width: 500px;
}

.abele-permissions {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);
  padding-top: var(--size-4-2);
}

.abele-permissions__heading {
  margin: var(--size-4-2) 0 0;
  padding-top: var(--size-4-2);
  border-top: 1px solid var(--background-modifier-border);
}
</style>
