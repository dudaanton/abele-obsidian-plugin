<template>
  <div class="abele-scripts-general">
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
import Setting from '../../obsidian/Setting.vue'
import Checkbox from '../../obsidian/Checkbox.vue'
import Search from '../../obsidian/Search.vue'
import { FolderSuggest } from '@/helpers/suggesters/FolderSuggester'
import { AbeleConfig } from '@/services/AbeleConfig'
import { ScriptService } from '@/scripting/ScriptService'
import { useSettingsSave } from '@/composables/useSettingsSave'

const config = AbeleConfig.getInstance()

const scriptsEnabled = ref(config.ai.scriptsEnabled ?? false)
const scriptsFolder = ref(config.ai.scriptsFolder ?? '')

// From the reactive list, not from `getAll()`: a computed over a plain map settles once, at
// the first render, and this screen used to show whatever the index held at that moment —
// nothing, when it was opened before the folder had been read — and never catch up.
const discoveredScripts = computed(() => {
  if (!scriptsEnabled.value) return []
  return ScriptService.getInstance().scriptList.value.filter((s) => s.meta.enabled !== false)
})

const { save } = useSettingsSave(
  () => {
    config.ai.scriptsEnabled = scriptsEnabled.value
    config.ai.scriptsFolder = scriptsFolder.value
  },
  () => {
    scriptsEnabled.value = config.ai.scriptsEnabled ?? false
    scriptsFolder.value = config.ai.scriptsFolder ?? ''
  }
)

const toggleScriptsEnabled = () => {
  scriptsEnabled.value = !scriptsEnabled.value
  // First, so the index that starts below reads the setting it was started for.
  save()
  if (scriptsEnabled.value && scriptsFolder.value) {
    ScriptService.getInstance().init()
  } else if (!scriptsEnabled.value) {
    ScriptService.destroy()
  }
}

const updateScriptsFolder = (value: string) => {
  scriptsFolder.value = value
  save()
}
</script>
