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

      <Setting
        class="abele-confirm-foreign-scripts"
        name="Confirm scripts from other devices"
        :desc="CONFIRM_FOREIGN_DESC"
      >
        <Checkbox :is-enabled="confirmForeign" @toggle="toggleConfirmForeign" />
      </Setting>

      <p v-if="waitingCount" class="setting-item-description abele-scripts-waiting">
        {{
          waitingCount === 1
            ? '1 script waits to be confirmed on this device.'
            : `${waitingCount} scripts wait to be confirmed on this device.`
        }}
        <a href="#" @click.prevent="reviewWaiting">Review</a>
      </p>

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
import { ScriptTrust } from '@/scripting/ScriptTrust'
import { useSettingsSave } from '@/composables/useSettingsSave'

const config = AbeleConfig.getInstance()
const trust = ScriptTrust.getInstance()

const CONFIRM_FOREIGN_DESC =
  'A script that appears or changes without being written on this device — through Obsidian Sync, iCloud, Syncthing, git — waits until you look at it and confirm it here. Until then buttons, automations, startup and agents do not run it. Scripts you write on this device, in the editor or through Abele, count as confirmed. Switching this on accepts every script in the folder as it is now. Confirmations are kept on this device only; switching it off here forgets them, and only for this device.'

// Looking arms a device the settings ask to, the same as a run would — once, here, rather than
// inside a computed that would change what it depends on.
ScriptService.getInstance().waitingScripts()

/** Whether this device checks: its own state, not the settings file, which syncs. */
const switched = ref(0)
const confirmForeign = computed(() => {
  void trust.version.value
  void switched.value
  return trust.active() || trust.willArm()
})

const waitingCount = computed(() => {
  void trust.version.value
  void ScriptService.getInstance().scriptList.value
  if (!confirmForeign.value) return 0
  return ScriptService.getInstance().waitingScripts().length
})

const toggleConfirmForeign = () => {
  const on = !confirmForeign.value
  ScriptService.getInstance().setConfirmForeign(on)
  config.ai = { ...config.ai, confirmForeignScripts: on }
  void config.saveSettings()
  switched.value++
}

const reviewWaiting = () => {
  void ScriptService.getInstance().reviewWaiting()
}

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
  // Saving goes through the plugin's single lifetime owner for scripts and automations.
  save()
}

const updateScriptsFolder = (value: string) => {
  scriptsFolder.value = value
  save()
}
</script>
