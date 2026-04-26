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

      <h3>Default Permissions</h3>

      <Setting
        name="Allow scripts"
        desc="Default for new chats. Allow agent to run user scripts without asking."
      >
        <Checkbox :is-enabled="allowScripts" @toggle="toggleAllow('allowScripts')" />
      </Setting>

      <Setting
        name="Allow create_script"
        desc="Default for new chats. Allow agent to create new scripts without asking."
      >
        <Checkbox :is-enabled="allowCreateScript" @toggle="toggleAllow('allowCreateScript')" />
      </Setting>

      <template v-if="discoveredScripts.length">
        <h3>Script Tools</h3>
        <p class="setting-item-description">
          Allow agent to run individual scripts without asking.
        </p>
        <Setting
          v-for="script in discoveredScripts"
          :key="script.path"
          :name="script.meta.name"
          :desc="script.meta.description || script.path"
        >
          <Checkbox
            :is-enabled="!!scriptToolToggles[script.path]"
            @toggle="toggleScriptTool(script.path)"
          />
        </Setting>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
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
const allowScripts = ref(config.ai.allowScripts ?? false)
const allowCreateScript = ref(config.ai.allowCreateScript ?? false)
const scriptToolToggles = reactive<Record<string, boolean>>({
  ...(config.ai.scriptToolToggles || {}),
})

const discoveredScripts = computed(() => {
  if (!scriptsEnabled.value) return []
  return ScriptService.getInstance().scriptList.value
})

const save = debounce(async () => {
  config.ai.scriptsEnabled = scriptsEnabled.value
  config.ai.scriptsFolder = scriptsFolder.value
  config.ai.allowScripts = allowScripts.value
  config.ai.allowCreateScript = allowCreateScript.value
  config.ai.scriptToolToggles = { ...scriptToolToggles }
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

const toggleAllow = (key: 'allowScripts' | 'allowCreateScript') => {
  if (key === 'allowScripts') allowScripts.value = !allowScripts.value
  if (key === 'allowCreateScript') allowCreateScript.value = !allowCreateScript.value
  save()
}

const toggleScriptTool = (path: string) => {
  scriptToolToggles[path] = !scriptToolToggles[path]
  save()
}
</script>
