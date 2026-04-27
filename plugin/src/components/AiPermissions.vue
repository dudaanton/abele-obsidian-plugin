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

      <h4 class="abele-permissions__heading">Vault data</h4>

      <Setting name="Read logs" desc="Allow agent to read log entries of notes.">
        <Checkbox :is-enabled="allowReadLogs" @toggle="toggle('allowReadLogs')" />
      </Setting>

      <Setting name="Read backlinks" desc="Allow agent to read group-based backlinks of notes.">
        <Checkbox :is-enabled="allowReadBacklinks" @toggle="toggle('allowReadBacklinks')" />
      </Setting>

      <Setting name="Read transactions" desc="Allow agent to read financial transactions.">
        <Checkbox :is-enabled="allowReadTransactions" @toggle="toggle('allowReadTransactions')" />
      </Setting>

      <Setting name="Read tasks" desc="Allow agent to read tasks.">
        <Checkbox :is-enabled="allowReadTasks" @toggle="toggle('allowReadTasks')" />
      </Setting>

      <Setting name="Open files" desc="Allow agent to open files in the editor.">
        <Checkbox :is-enabled="allowOpenFile" @toggle="toggle('allowOpenFile')" />
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

const session = computed(() => AgentService.getInstance().activeSession.value)

const allowWebSearch = computed(() => session.value?.allowWebSearch.value ?? true)
const allowFetch = computed(() => session.value?.allowFetch.value ?? false)
const allowDownload = computed(() => session.value?.allowDownload.value ?? false)
const allowWiseModel = computed(() => session.value?.allowWiseModel.value ?? false)
const allowImageGeneration = computed(() => session.value?.allowImageGeneration.value ?? false)
const allowEvalJs = computed(() => session.value?.allowEvalJs.value ?? false)
const allowCreateFiles = computed(() => session.value?.allowCreateFiles.value ?? true)
const allowDelegate = computed(() => session.value?.allowDelegate.value ?? false)
const allowScripts = computed(() => session.value?.allowScripts.value ?? false)
const allowedScripts = computed(() => session.value?.allowedScripts.value ?? {})
const allowCreateScript = computed(() => session.value?.allowCreateScript.value ?? false)
const allowReadLogs = computed(() => session.value?.allowReadLogs.value ?? false)
const allowReadBacklinks = computed(() => session.value?.allowReadBacklinks.value ?? false)
const allowReadTransactions = computed(() => session.value?.allowReadTransactions.value ?? false)
const allowReadTasks = computed(() => session.value?.allowReadTasks.value ?? false)
const allowOpenFile = computed(() => session.value?.allowOpenFile.value ?? false)

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
    | 'allowReadLogs'
    | 'allowReadBacklinks'
    | 'allowReadTransactions'
    | 'allowReadTasks'
    | 'allowOpenFile'
) => {
  const s = session.value
  if (s) s[key].value = !s[key].value
}

const toggleScript = (toolName: string) => {
  const s = session.value
  if (!s) return
  s.allowedScripts.value = {
    ...s.allowedScripts.value,
    [toolName]: !s.allowedScripts.value[toolName],
  }
}
</script>

<style lang="scss">
.modal:has(.abele-permissions) {
  width: min(500px, 90vw);
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
