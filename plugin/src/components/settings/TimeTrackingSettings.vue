<template>
  <div class="abele-settings__time-tracking">
    <Setting
      :name="t('settings.TimeTrackingSettings.time_entry_path_template.b06163ff')"
      :desc="
        t('settings.TimeTrackingSettings.template_for_new_time_entry.ef1556e8', {
          literalDate: '{{date:FORMAT}}',
          literal0: String('{{groups}}'),
          literal1: String('{{start}}'),
          literal2: String('{{end}}'),
        })
      "
    >
      <Input
        :model-value="timeEntryPathTemplate"
        :placeholder="
          t('settings.TimeTrackingSettings.e_g_time_date_yyyy.dfcd03ce', {
            literal2: String('Time/{{date:YYYY/MM}}/{{groups}} {{start}}'),
          })
        "
        @update:model-value="timeEntryPathTemplateChanged"
      />
    </Setting>
    <Setting
      :name="t('settings.TimeTrackingSettings.trackable_note_types.4b331926')"
      :desc="t('settings.TimeTrackingSettings.comma_separated_note_types_that.e5d132fd')"
    >
      <Input
        :model-value="timeTrackableNoteTypes"
        :placeholder="
          t('settings.TimeTrackingSettings.e_g_task.1c985447', { literal0: String('task') })
        "
        @update:model-value="timeTrackableNoteTypesChanged"
      />
    </Setting>
    <Setting
      :name="t('settings.TimeTrackingSettings.track_all_notes.41a2243c')"
      :desc="t('settings.TimeTrackingSettings.show_the_timer_button_in.983d0303')"
    >
      <Checkbox :is-enabled="timeTrackAllNotes" @toggle="timeTrackAllNotesChanged" />
    </Setting>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { ref } from 'vue'
import Setting from '../obsidian/Setting.vue'
import Input from '../obsidian/Input.vue'
import Checkbox from '../obsidian/Checkbox.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { debounce } from 'obsidian'
import { parseCommaList } from '@/helpers/displayFormat'

const timeEntryPathTemplate = ref(AbeleConfig.getInstance().timeEntryPathTemplate)
const timeTrackableNoteTypes = ref(AbeleConfig.getInstance().timeTrackableNoteTypes.join(','))
const timeTrackAllNotes = ref(AbeleConfig.getInstance().timeTrackAllNotes)

const saveSettings = debounce(async () => {
  const config = AbeleConfig.getInstance()
  config.timeEntryPathTemplate = timeEntryPathTemplate.value.trim()
  config.timeTrackableNoteTypes = parseCommaList(timeTrackableNoteTypes.value)
  config.timeTrackAllNotes = timeTrackAllNotes.value

  await config.saveSettings()
}, 500)

const timeEntryPathTemplateChanged = (value: string) => {
  timeEntryPathTemplate.value = value
  saveSettings()
}

const timeTrackableNoteTypesChanged = (value: string) => {
  timeTrackableNoteTypes.value = value
  saveSettings()
}

const timeTrackAllNotesChanged = () => {
  timeTrackAllNotes.value = !timeTrackAllNotes.value
  saveSettings()
}
</script>
