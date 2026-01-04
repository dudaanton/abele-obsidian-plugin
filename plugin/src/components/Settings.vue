<template>
  <div class="abele-settings">
    <h2>Abele settings</h2>
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
      name="Logs note types"
      desc="Optional comma-separated list of note types to consider as log notes."
    >
      <Input
        :model-value="logsNotesTypes"
        placeholder="e.g. journal,log,daily"
        @update:model-value="logsNotesTypesChanged"
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
    <h2>Journals configuration</h2>
    <div v-for="(journal, id) of journals" :key="id">
      <div class="setting-item">
        <div class="setting-item-info abele-settings__journal-info">
          <div class="abele-settings__journal-heading">
            <div class="setting-item-name">
              {{ journal.name ? `${journal.name} journal` : `Journal #${id + 1}` }}
            </div>
            <Icon icon="cross" @click="removeJournal(id)" />
          </div>
          <Setting name="Default journal">
            <Checkbox :is-enabled="journal.isDefault" @toggle="toggleJournalDefault(journal)" />
          </Setting>
          <Setting name="Journal name">
            <Input v-model="journal.name" placeholder="Journal name" />
          </Setting>
          <Setting name="Journal type property value or filename RegExp">
            <Input v-model="journal.type" placeholder="Type or RegExp" />
          </Setting>
          <Setting name="Date property name" desc="Optional">
            <Input v-model="journal.dateProperty" placeholder="Date property name" />
          </Setting>
          <Setting name="New journal note path template" desc="Optional">
            <Input v-model="journal.newPathTemplate" placeholder="Path template" />
          </Setting>
          <Setting
            name="Day of reccurence period, when note is created"
            desc="Optional. Default to 'first'."
          >
            <Input
              :model-value="
                typeof journal.dayOfPeriod === 'number'
                  ? journal.dayOfPeriod.toString()
                  : journal.dayOfPeriod
              "
              placeholder="Path template"
              @update:model-value="journal.dayOfPeriod = $event as Journal['dayOfPeriod']"
            />
          </Setting>
          <Setting name="Template note path" desc="Optional">
            <Search
              :model-value="journal.templatePath"
              placeholder="Template note path"
              :suggester="FileSuggest"
              @update:model-value="journal.templatePath = $event"
            />
          </Setting>
          <Setting name="Journal reccurence">
            <Dropdown
              :model-value="journal.recurrence"
              :options="journalReccurenceOptions"
              @update:model-value="
                changeJournalReccurence(journal, $event as Journal['recurrence'])
              "
            />
          </Setting>
        </div>
      </div>
    </div>
    <Button text="Add journal" @click="addJournal" />
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import Setting from './obsidian/Setting.vue'
import Search from './obsidian/Search.vue'
import Input from './obsidian/Input.vue'
import { FolderSuggest } from '@/helpers/suggesters/FolderSuggester'
import { AbeleConfig } from '@/services/AbeleConfig'
import Button from './obsidian/Button.vue'
import Dropdown from './obsidian/Dropdown.vue'
import Icon from './obsidian/Icon.vue'
import Checkbox from './obsidian/Checkbox.vue'
import dayjs from 'dayjs'
import { GlobalStore } from '@/stores/GlobalStore'
import { FileSuggest } from '@/helpers/suggesters/FileSuggester'
import { debounce } from 'obsidian'
import { Journal } from '@/entities/Journal'
import { nanoid } from 'nanoid'

const tasksFolder = ref(AbeleConfig.getInstance().tasksFolder)
const logsNotesTypes = ref(AbeleConfig.getInstance().logsNotesTypes.join(','))
const tasksTimeChoices = ref(AbeleConfig.getInstance().tasksTimeChoices.join(','))
const tasksDateChoices = ref(AbeleConfig.getInstance().tasksDateChoices.join(','))
const tasksRecurrenceChoices = ref(AbeleConfig.getInstance().tasksRecurrenceChoices.join(','))
const weekStartsOnMonday = ref(AbeleConfig.getInstance().weekStartsOnMonday)
const journals = reactive([...AbeleConfig.getInstance().journals])
const busyDayThreshold = ref(AbeleConfig.getInstance().busyDayThreshold.toString())

const journalReccurenceOptions = [
  { value: 'daily', display: 'Daily' },
  { value: 'weekly', display: 'Weekly' },
  { value: 'monthly', display: 'Monthly' },
  { value: 'yearly', display: 'Yearly' },
]

const saveSettings = debounce(async () => {
  const config = AbeleConfig.getInstance()
  config.journals = journals.map((j) => new Journal(j))
  config.tasksFolder = tasksFolder.value.endsWith('/')
    ? tasksFolder.value.slice(0, -1).trim()
    : tasksFolder.value.trim()
  config.logsNotesTypes = logsNotesTypes.value
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
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

  await AbeleConfig.getInstance().saveSettings()
}, 500)

const tasksFolderChanged = async (value: string) => {
  tasksFolder.value = value.trim()
  saveSettings()
}

const logsNotesTypesChanged = async (value: string) => {
  logsNotesTypes.value = value
  saveSettings()
}

const tasksTimeChoicesChanged = async (value: string) => {
  tasksTimeChoices.value = value
  saveSettings()
}

const tasksDateChoicesChanged = async (value: string) => {
  tasksDateChoices.value = value
  saveSettings()
}

const tasksRecurrenceChoicesChanged = async (value: string) => {
  tasksRecurrenceChoices.value = value
  saveSettings()
}

const weekStartsOnMondayChanged = async () => {
  weekStartsOnMonday.value = !weekStartsOnMonday.value

  dayjs.updateLocale('en', {
    weekStart: weekStartsOnMonday.value ? 1 : 0,
  })

  GlobalStore.getInstance().weekStartsOnMonday.value = weekStartsOnMonday.value

  saveSettings()
}

const busyDayThresholdChanged = async (value: string) => {
  const num = parseInt(value, 10)
  if (!isNaN(num) && num >= 0) {
    AbeleConfig.getInstance().busyDayThreshold = num
    await AbeleConfig.getInstance().saveSettings()
  }
}

watch(journals, saveSettings, { deep: true })

const removeJournal = async (id: number) => {
  journals.splice(id, 1)
}

const addJournal = () => {
  const hasDefault = journals.some((j) => j.isDefault)

  journals.push(
    new Journal({
      id: nanoid(),
      name: '',
      type: '',
      isDefault: !hasDefault,
      dateProperty: '',
      templatePath: '',
      newPathTemplate: '',
      recurrence: 'daily',
      dayOfPeriod: 'first',
    })
  )
}

const toggleJournalDefault = (journal: Journal) => {
  if (journal.recurrence !== 'daily') return

  journals.forEach((j) => {
    j.isDefault = false
  })
  journal.isDefault = true
}

const changeJournalReccurence = (journal: Journal, value: Journal['recurrence']) => {
  if (journal.isDefault && value !== 'daily') return

  journal.recurrence = value
}
</script>

<style lang="scss">
.abele-settings__input-group {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--size-4-2);
}

.abele-settings__journal-heading {
  margin-bottom: var(--size-4-2);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.abele-settings__journal-info {
  display: flex;
  flex-direction: column;
  margin-bottom: var(--p-spacing);
}

.abele-settings__caption {
  font-size: var(--font-small);
  color: var(--text-muted);
}
</style>
