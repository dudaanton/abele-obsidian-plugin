<template>
  <div class="abele-settings__time-tracking">
    <Setting
      name="Time entry path template"
      desc="Template for new time entry file paths. Variables: {{groups}}, {{start}}, {{end}}, {{date:FORMAT}}."
    >
      <Input
        :model-value="timeEntryPathTemplate"
        placeholder="e.g. Time/{{date:YYYY/MM}}/{{groups}} {{start}}"
        @update:model-value="timeEntryPathTemplateChanged"
      />
    </Setting>
    <Setting
      name="Trackable note types"
      desc="Comma-separated note types that show the timer button in header (e.g. task,project)."
    >
      <Input
        :model-value="timeTrackableNoteTypes"
        placeholder="e.g. task"
        @update:model-value="timeTrackableNoteTypesChanged"
      />
    </Setting>
    <Setting
      name="Track all notes"
      desc="Show the timer button in the header for all notes, regardless of type."
    >
      <Checkbox :is-enabled="timeTrackAllNotes" @toggle="timeTrackAllNotesChanged" />
    </Setting>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Setting from '../obsidian/Setting.vue'
import Input from '../obsidian/Input.vue'
import Checkbox from '../obsidian/Checkbox.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { debounce } from 'obsidian'

const timeEntryPathTemplate = ref(AbeleConfig.getInstance().timeEntryPathTemplate)
const timeTrackableNoteTypes = ref(AbeleConfig.getInstance().timeTrackableNoteTypes.join(','))
const timeTrackAllNotes = ref(AbeleConfig.getInstance().timeTrackAllNotes)

const saveSettings = debounce(async () => {
  const config = AbeleConfig.getInstance()
  config.timeEntryPathTemplate = timeEntryPathTemplate.value.trim()
  config.timeTrackableNoteTypes = timeTrackableNoteTypes.value
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
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
