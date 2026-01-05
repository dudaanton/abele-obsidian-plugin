<template>
  <div class="abele-settings__journals">
    <div v-for="(journal, id) of journals" :key="id">
      <div class="setting-item">
        <div class="setting-item-info abele-settings__journal">
          <div class="abele-settings__journal-header">
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
              @update:model-value="changeJournalReccurence(journal, $event as Journal['recurrence'])"
            />
          </Setting>
        </div>
      </div>
    </div>
    <Button text="Add journal" @click="addJournal" />
  </div>
</template>

<script setup lang="ts">
import { reactive, watch } from 'vue'
import Setting from '../obsidian/Setting.vue'
import Search from '../obsidian/Search.vue'
import Input from '../obsidian/Input.vue'
import Button from '../obsidian/Button.vue'
import Dropdown from '../obsidian/Dropdown.vue'
import Icon from '../obsidian/Icon.vue'
import Checkbox from '../obsidian/Checkbox.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { FileSuggest } from '@/helpers/suggesters/FileSuggester'
import { debounce } from 'obsidian'
import { Journal } from '@/entities/Journal'
import { nanoid } from 'nanoid'

const journals = reactive([...AbeleConfig.getInstance().journals])

const journalReccurenceOptions = [
  { value: 'daily', display: 'Daily' },
  { value: 'weekly', display: 'Weekly' },
  { value: 'monthly', display: 'Monthly' },
  { value: 'yearly', display: 'Yearly' },
]

const saveSettings = debounce(async () => {
  const config = AbeleConfig.getInstance()
  config.journals = journals.map((j) => new Journal(j))
  await config.saveSettings()
}, 500)

watch(journals, saveSettings, { deep: true })

const removeJournal = (id: number) => {
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
.abele-settings__journal {
  display: flex;
  flex-direction: column;
  margin-bottom: var(--p-spacing);
}

.abele-settings__journal-header {
  margin-bottom: var(--size-4-2);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
</style>
