<template>
  <div class="abele-settings__tasks">
    <Setting
      :name="t('settings.TasksSettings.tasks_folder.9c703cd1')"
      :desc="t('settings.TasksSettings.optional_folder_path_to_store.68deedd3')"
    >
      <Search
        :model-value="tasksFolder"
        :placeholder="t('settings.TasksSettings.enter_tasks_folder_path.685fec4a')"
        :suggester="FolderSuggest"
        @update:model-value="tasksFolderChanged"
      />
    </Setting>
    <Setting
      :name="t('settings.TasksSettings.tasks_time_choices.97d2bb52')"
      :desc="t('settings.TasksSettings.optional_comma_separated_list_of.352a5929')"
    >
      <Input
        :model-value="tasksTimeChoices"
        :placeholder="
          t('settings.TasksSettings.e_g.4c04e29e', { literal0: String('09:00,12:00,18:00') })
        "
        @update:model-value="tasksTimeChoicesChanged"
      />
    </Setting>
    <Setting
      :name="t('settings.TasksSettings.tasks_date_choices.56987dbf')"
      :desc="t('settings.TasksSettings.optional_comma_separated_list_of.8d60bd5e')"
    >
      <Input
        :model-value="tasksDateChoices"
        :placeholder="
          t('settings.TasksSettings.e_g_today_tomorrow_next.675fc3c0', {
            literal0: String('Today,Tomorrow,Next Week'),
          })
        "
        @update:model-value="tasksDateChoicesChanged"
      />
    </Setting>
    <Setting
      :name="t('settings.TasksSettings.tasks_recurrence_choices.5933e491')"
      :desc="t('settings.TasksSettings.optional_comma_separated_list_of.f364b641')"
    >
      <Input
        :model-value="tasksRecurrenceChoices"
        :placeholder="
          t('settings.TasksSettings.e_g_daily_weekly_monthly.1a1c72f3', {
            literal0: String('Daily,Weekly,Monthly'),
          })
        "
        @update:model-value="tasksRecurrenceChoicesChanged"
      />
    </Setting>
    <Setting
      :name="t('settings.TasksSettings.busy_day_threshold.ebd745bf')"
      :desc="t('settings.TasksSettings.number_of_tasks_in_a.def227ff')"
    >
      <Input
        :model-value="busyDayThreshold"
        type="number"
        :placeholder="t('settings.TasksSettings.e_g.8c2fb766', { literal0: String('3') })"
        @update:model-value="busyDayThresholdChanged"
      />
    </Setting>
    <Setting
      :name="t('settings.TasksSettings.week_starts_on_monday.1e6c3ee3')"
      :desc="t('settings.TasksSettings.set_the_first_day_of.0426b53c')"
    >
      <Checkbox :is-enabled="weekStartsOnMonday" @toggle="weekStartsOnMondayChanged" />
    </Setting>
    <Setting
      :name="t('settings.TasksSettings.birth_date.5164b245')"
      :desc="t('settings.TasksSettings.where_the_life_layout_of.291ea708')"
    >
      <Input type="date" :model-value="birthDate" @update:model-value="birthDateChanged" />
    </Setting>
    <Setting
      :name="t('settings.TasksSettings.life_expectancy.da8e9e4d')"
      :desc="t('settings.TasksSettings.the_years_the_life_layout.4cd598a4')"
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
import { t } from '@/i18n'
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
