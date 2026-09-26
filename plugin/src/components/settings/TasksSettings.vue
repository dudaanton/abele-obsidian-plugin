<template>
  <div class="abele-settings__tasks">
    <Setting
      name="Tasks folder"
      desc='Optional folder path to store task files (default: "Tasks").'
    >
      <Search
        :model-value="tasksFolder"
        placeholder="Enter tasks folder path"
        :suggester="FolderSuggest"
        @update:model-value="tasksFolderChanged"
      />
    </Setting>
    <Setting
      name="Tasks time choices"
      desc='Optional comma-separated list of time choices for tasks (e.g. "09:00,12:00,18:00").'
    >
      <Input
        :model-value="tasksTimeChoices"
        placeholder="e.g. 09:00,12:00,18:00"
        @update:model-value="tasksTimeChoicesChanged"
      />
    </Setting>
    <Setting
      name="Tasks date choices"
      desc='Optional comma-separated list of date choices for tasks (e.g. "Today,Tomorrow,Next Week").'
    >
      <Input
        :model-value="tasksDateChoices"
        placeholder="e.g. Today,Tomorrow,Next Week"
        @update:model-value="tasksDateChoicesChanged"
      />
    </Setting>
    <Setting
      name="Tasks recurrence choices"
      desc='Optional comma-separated list of recurrence choices for tasks (e.g. "Daily,Weekly,Monthly").'
    >
      <Input
        :model-value="tasksRecurrenceChoices"
        placeholder="e.g. Daily,Weekly,Monthly"
        @update:model-value="tasksRecurrenceChoicesChanged"
      />
    </Setting>
    <Setting
      name="Busy day threshold"
      desc='Number of tasks in a day to consider it as a "busy day".'
    >
      <Input
        :model-value="busyDayThreshold"
        type="number"
        placeholder="e.g. 3"
        @update:model-value="busyDayThresholdChanged"
      />
    </Setting>
    <Setting
      name="Week starts on Monday"
      desc="Set the first day of the week for date calculations."
    >
      <Checkbox :is-enabled="weekStartsOnMonday" @toggle="weekStartsOnMondayChanged" />
    </Setting>
    <Setting
      name="Birth date"
      desc="Where the Life layout of a calendar base starts counting your weeks. Used by every base."
    >
      <Input type="date" :model-value="birthDate" @update:model-value="birthDateChanged" />
    </Setting>
    <Setting
      name="Life expectancy"
      desc="The years the Life layout draws. A calendar base can ask for its own in the view's options."
    >
      <Input
        :model-value="lifeExpectancy"
        type="number"
        :placeholder="String(DEFAULT_LIFE_YEARS)"
        @update:model-value="lifeExpectancyChanged"
      />
    </Setting>
    <TaskLabelsSettings />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Setting from '../obsidian/Setting.vue'
import Search from '../obsidian/Search.vue'
import Input from '../obsidian/Input.vue'
import Checkbox from '../obsidian/Checkbox.vue'
import TaskLabelsSettings from './TaskLabelsSettings.vue'
import { FolderSuggest } from '@/helpers/suggesters/FolderSuggester'
import { AbeleConfig } from '@/services/AbeleConfig'
import { debounce } from 'obsidian'
import dayjs from 'dayjs'
import { GlobalStore } from '@/stores/GlobalStore'
import { DEFAULT_LIFE_YEARS, isBirthDate, lifeYears } from '@/bases/lifeWeeks'

const tasksFolder = ref(AbeleConfig.getInstance().tasksFolder)
const tasksTimeChoices = ref(AbeleConfig.getInstance().tasksTimeChoices.join(','))
const tasksDateChoices = ref(AbeleConfig.getInstance().tasksDateChoices.join(','))
const tasksRecurrenceChoices = ref(AbeleConfig.getInstance().tasksRecurrenceChoices.join(','))
const busyDayThreshold = ref(AbeleConfig.getInstance().busyDayThreshold.toString())
const weekStartsOnMonday = ref(AbeleConfig.getInstance().weekStartsOnMonday)
const birthDate = ref(AbeleConfig.getInstance().birthDate)
const lifeExpectancy = ref(String(AbeleConfig.getInstance().lifeExpectancy))

const saveSettings = debounce(async () => {
  const config = AbeleConfig.getInstance()
  config.tasksFolder = tasksFolder.value.endsWith('/')
    ? tasksFolder.value.slice(0, -1).trim()
    : tasksFolder.value.trim()
  config.tasksTimeChoices = tasksTimeChoices.value
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.match(/^\d{2}:\d{2}$/))
  config.tasksDateChoices = tasksDateChoices.value
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
  config.tasksRecurrenceChoices = tasksRecurrenceChoices.value
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
  config.weekStartsOnMonday = weekStartsOnMonday.value

  await config.saveSettings()
}, 500)

const tasksFolderChanged = (value: string) => {
  tasksFolder.value = value.trim()
  saveSettings()
}

const tasksTimeChoicesChanged = (value: string) => {
  tasksTimeChoices.value = value
  saveSettings()
}

const tasksDateChoicesChanged = (value: string) => {
  tasksDateChoices.value = value
  saveSettings()
}

const tasksRecurrenceChoicesChanged = (value: string) => {
  tasksRecurrenceChoices.value = value
  saveSettings()
}

const busyDayThresholdChanged = async (value: string) => {
  const num = parseInt(value, 10)
  if (!isNaN(num) && num >= 0) {
    busyDayThreshold.value = value
    AbeleConfig.getInstance().busyDayThreshold = num
    await AbeleConfig.getInstance().saveSettings()
  }
}

const weekStartsOnMondayChanged = () => {
  weekStartsOnMonday.value = !weekStartsOnMonday.value

  dayjs.updateLocale('en', {
    weekStart: weekStartsOnMonday.value ? 1 : 0,
  })

  GlobalStore.getInstance().weekStartsOnMonday.value = weekStartsOnMonday.value

  saveSettings()
}

/** A date the field has finished with, or none at all to take it away. */
const birthDateChanged = async (value: string) => {
  birthDate.value = value
  if (value && !isBirthDate(value)) return
  AbeleConfig.getInstance().birthDate = value
  await AbeleConfig.getInstance().saveSettings()
}

const lifeExpectancyChanged = async (value: string) => {
  lifeExpectancy.value = value
  const years = lifeYears(value, 0)
  if (!years) return
  AbeleConfig.getInstance().lifeExpectancy = years
  await AbeleConfig.getInstance().saveSettings()
}
</script>
