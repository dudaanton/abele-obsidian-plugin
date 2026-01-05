<template>
  <div class="abele-settings__logs">
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
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Setting from '../obsidian/Setting.vue'
import Input from '../obsidian/Input.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { debounce } from 'obsidian'

const logsNotesTypes = ref(AbeleConfig.getInstance().logsNotesTypes.join(','))

const saveSettings = debounce(async () => {
  const config = AbeleConfig.getInstance()
  config.logsNotesTypes = logsNotesTypes.value
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)

  await config.saveSettings()
}, 500)

const logsNotesTypesChanged = (value: string) => {
  logsNotesTypes.value = value
  saveSettings()
}
</script>
