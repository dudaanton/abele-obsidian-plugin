<template>
  <div class="abele-scripts-general">
    <Setting
      :name="t('settings.scripts.ScriptsGeneral.enable_scripts.4fe25ff6')"
      :desc="t('settings.scripts.ScriptsGeneral.allow_javascript_scripts_stored_in.1e5b4bf9')"
    >
      <Checkbox :is-enabled="scriptsEnabled" @toggle="toggleScriptsEnabled" />
    </Setting>

    <template v-if="scriptsEnabled">
      <Setting
        :name="t('settings.scripts.ScriptsGeneral.synced_script_policy.a4d283f1')"
        :desc="t('settings.scripts.ScriptsGeneral.personal_sync_until_confirmed_on.6340833f')"
      />
      <Setting
        :name="t('settings.scripts.ScriptsGeneral.scripts_folder.fd88dd8d')"
        :desc="t('settings.scripts.ScriptsGeneral.vault_folder_containing_js_script.d5c97d89')"
      >
        <Search
          :model-value="scriptsFolder"
          :suggester="FolderSuggest"
          :placeholder="
            t('settings.scripts.ScriptsGeneral.e_g_system_scripts.f729b48b', {
              literal0: String('System/Scripts'),
            })
          "
          @update:model-value="updateScriptsFolder"
        />
      </Setting>

      <Setting
        class="abele-confirm-foreign-scripts"
        :name="t('settings.scripts.ScriptsGeneral.confirm_scripts_from_other_devices.ba3bb6ea')"
        :desc="CONFIRM_FOREIGN_DESC"
      >
        <Checkbox :is-enabled="confirmForeign" @toggle="toggleConfirmForeign" />
      </Setting>

      <p v-if="waitingCount" class="setting-item-description abele-scripts-waiting">
        {{
          waitingCount === 1
            ? t('settings.scripts.ScriptsGeneral.script_waits_to_be_confirmed.97d74aac')
            : t('settings.scripts.ScriptsGeneral.value_scripts_wait_to_be.7d9d81b9', {
                value0: String(waitingCount),
              })
        }}
        <a href="#" @click.prevent="reviewWaiting">{{
          t('settings.scripts.ScriptsGeneral.review.aff0766a')
        }}</a>
      </p>

      <p v-if="discoveredScripts.length" class="setting-item-description">
        <I18nText
          :text="t('settings.rich.82dd523dc663e313', { slot0: '⟪slot0⟫', slot1: '⟪slot1⟫' })"
          ><template #slot0>{{ discoveredScripts.length }}</template
          ><template #slot1
            ><strong>{{
              t('settings.scripts.ScriptsGeneral.ai_agent_default_tool_modes.18eb6e27')
            }}</strong></template
          ></I18nText
        >
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import I18nText from '@/components/obsidian/I18nText.vue'
import { t } from '@/i18n'
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

const CONFIRM_FOREIGN_DESC = t('settings.scripts.ScriptsGeneral.a_script_that_appears_or.cef15a6e')

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
