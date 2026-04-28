<template>
  <div class="abele-settings__scripts">
    <Setting
      name="Enable scripts"
      desc="Allow JavaScript scripts stored in a vault folder to be registered as commands and AI tools."
    >
      <Checkbox :is-enabled="scriptsEnabled" @toggle="toggleScriptsEnabled" />
    </Setting>

    <template v-if="scriptsEnabled">
      <Setting name="Scripts folder" desc="Vault folder containing .js script files.">
        <Search
          :model-value="scriptsFolder"
          :suggester="FolderSuggest"
          placeholder="e.g. System/Scripts"
          @update:model-value="updateScriptsFolder"
        />
      </Setting>

      <p v-if="discoveredScripts.length" class="setting-item-description">
        {{ discoveredScripts.length }} scripts discovered. Configure tool modes in
        <strong>AI Agent → Default Tool Modes</strong> or per-chat in the permissions modal.
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { debounce } from 'obsidian'
import Setting from '../obsidian/Setting.vue'
import Checkbox from '../obsidian/Checkbox.vue'
import Search from '../obsidian/Search.vue'
import { FolderSuggest } from '@/helpers/suggesters/FolderSuggester'
import { AbeleConfig } from '@/services/AbeleConfig'
import { ScriptService } from '@/scripting/ScriptService'

const config = AbeleConfig.getInstance()

const scriptsEnabled = ref(config.ai.scriptsEnabled ?? false)
const scriptsFolder = ref(config.ai.scriptsFolder ?? '')

const discoveredScripts = computed(() => {
  if (!scriptsEnabled.value) return []
  return ScriptService.getInstance()
    .getAll()
    .filter((s) => s.meta.enabled !== false)
})

const save = debounce(async () => {
  config.ai.scriptsEnabled = scriptsEnabled.value
  config.ai.scriptsFolder = scriptsFolder.value
  await config.saveSettings()
}, 500)

const toggleScriptsEnabled = () => {
  scriptsEnabled.value = !scriptsEnabled.value
  if (scriptsEnabled.value && scriptsFolder.value) {
    ScriptService.getInstance().init()
  } else if (!scriptsEnabled.value) {
    ScriptService.destroy()
  }
  save()
}

const updateScriptsFolder = (value: string) => {
  scriptsFolder.value = value
  save()
}
</script>
