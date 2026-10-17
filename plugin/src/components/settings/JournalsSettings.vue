<template>
  <div class="abele-settings__journals">
    <div v-for="(journal, id) of journals" :key="id">
      <div class="setting-item">
        <div class="setting-item-info abele-settings__journal">
          <div class="abele-settings__journal-header">
            <div class="setting-item-name">
              {{
                journal.name
                  ? t('settings.JournalsSettings.value_journal.cc8a4dd5', {
                      value0: String(journal.name),
                    })
                  : t('settings.JournalsSettings.journal_value.06b87038', {
                      value0: String(id + 1),
                    })
              }}
            </div>
            <Icon
              icon="cross"
              :tooltip="t('settings.JournalsSettings.remove_this_journal.c3a84c0a')"
              @click="removeJournal(id)"
            />
          </div>
          <Setting :name="t('settings.JournalsSettings.default_journal.b54bf1fd')">
            <Checkbox :is-enabled="journal.isDefault" @toggle="toggleJournalDefault(journal)" />
          </Setting>
          <Setting :name="t('settings.JournalsSettings.journal_name.4a021433')">
            <Input
              v-model="journal.name"
              :placeholder="t('settings.JournalsSettings.journal_name.4a021433')"
            />
          </Setting>
          <Setting :name="t('settings.JournalsSettings.journal_type_property_value_or.04441eaf')">
            <Input
              v-model="journal.type"
              :placeholder="t('settings.JournalsSettings.type_or_regexp.241a5ad0')"
            />
          </Setting>
          <Setting
            :name="t('settings.JournalsSettings.date_property_name.8e90965d')"
            :desc="t('settings.JournalsSettings.optional.59be7133')"
          >
            <Input
              v-model="journal.dateProperty"
              :placeholder="t('settings.JournalsSettings.date_property_name.8e90965d')"
            />
          </Setting>
          <Setting
            :name="t('settings.JournalsSettings.new_journal_note_path_template.862462e1')"
            :desc="t('settings.JournalsSettings.optional.59be7133')"
          >
            <Input
              v-model="journal.newPathTemplate"
              :placeholder="t('settings.JournalsSettings.path_template.ec234daf')"
            />
          </Setting>
          <Setting
            :name="t('settings.JournalsSettings.day_of_reccurence_period_when.ae1517a9')"
            :desc="t('settings.JournalsSettings.optional_default_to_first.e58c831d')"
          >
            <Input
              :model-value="
                typeof journal.dayOfPeriod === 'number'
                  ? journal.dayOfPeriod.toString()
                  : journal.dayOfPeriod
              "
              :placeholder="t('settings.JournalsSettings.path_template.ec234daf')"
              @update:model-value="journal.dayOfPeriod = $event as Journal['dayOfPeriod']"
            />
          </Setting>
          <Setting
            :name="t('settings.JournalsSettings.template_note_path.de4db36f')"
            :desc="t('settings.JournalsSettings.optional.59be7133')"
          >
            <Search
              :model-value="journal.templatePath"
              :placeholder="t('settings.JournalsSettings.template_note_path.de4db36f')"
              :suggester="FileSuggest"
              @update:model-value="journal.templatePath = $event"
            />
          </Setting>
          <Setting :name="t('settings.JournalsSettings.journal_reccurence.8957b0f1')">
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
    <Button
      :text="t('settings.JournalsSettings.add_journal.f49ae75e')"
      :tooltip="t('settings.JournalsSettings.add_another_journal.0d345224')"
      @click="addJournal"
    />
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
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
  { value: 'daily', display: t('settings.JournalsSettings.daily.b36c2611') },
  { value: 'weekly', display: t('settings.JournalsSettings.weekly.29751324') },
  { value: 'monthly', display: t('settings.JournalsSettings.monthly.9b11f6b7') },
  { value: 'yearly', display: t('settings.JournalsSettings.yearly.6e69b59e') },
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
