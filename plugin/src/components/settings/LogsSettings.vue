<template>
  <div class="abele-settings__logs">
    <Setting
      :name="t('settings.LogsSettings.logs_note_types.0793e6f2')"
      :desc="t('settings.LogsSettings.optional_comma_separated_list_of.8730c2d2')"
    >
      <Input
        :model-value="logsNotesTypes"
        :placeholder="
          t('settings.LogsSettings.e_g_journal_log_daily.a54faefe', {
            literal0: String('journal,log,daily'),
          })
        "
        @update:model-value="logsNotesTypesChanged"
      />
    </Setting>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { ref } from 'vue'
import Setting from '../obsidian/Setting.vue'
import Input from '../obsidian/Input.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { debounce } from 'obsidian'
import { parseCommaList } from '@/helpers/displayFormat'

const logsNotesTypes = ref(AbeleConfig.getInstance().logsNotesTypes.join(','))

const saveSettings = debounce(async () => {
  const config = AbeleConfig.getInstance()
  config.logsNotesTypes = parseCommaList(logsNotesTypes.value)

  await config.saveSettings()
}, 500)

const logsNotesTypesChanged = (value: string) => {
  logsNotesTypes.value = value
  saveSettings()
}
</script>
