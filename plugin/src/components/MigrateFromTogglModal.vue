<template>
  <ObsidianModal title="Migrate from Toggl" @close="emit('close')">
    <div class="abele-migrate-toggl-modal">
      <Setting name="API Token" desc="Find it in Toggl → Profile Settings → API Token.">
        <Input v-model="apiToken" placeholder="Enter your Toggl API token" />
      </Setting>

      <Setting name="Period" desc="Date range to import time entries from.">
        <PeriodSelector v-model:start="periodStart" v-model:end="periodEnd" />
      </Setting>

      <div class="abele-migrate-toggl-modal__buttons">
        <ObsidianButton
          text="Import"
          accent
          :disabled="migrating || !apiToken"
          @click="startMigration"
        />
      </div>

      <div v-if="migrating || completed" class="abele-migrate-toggl-modal__progress">
        <div class="abele-migrate-toggl-modal__status">{{ statusText }}</div>
        <div class="abele-migrate-toggl-modal__bar-container">
          <div class="abele-migrate-toggl-modal__bar" :style="{ width: progressPercent + '%' }" />
        </div>
        <div class="abele-migrate-toggl-modal__counts">
          <span v-if="result.entriesCreated">Entries: {{ result.entriesCreated }}</span>
          <span v-if="result.notesCreated">Notes: {{ result.notesCreated }}</span>
          <span v-if="result.skipped">Skipped: {{ result.skipped }}</span>
        </div>
      </div>

      <div v-if="result.errors.length > 0" class="abele-migrate-toggl-modal__errors">
        <h4>Errors ({{ result.errors.length }})</h4>
        <div
          v-for="(err, i) in result.errors.slice(0, 20)"
          :key="i"
          class="abele-migrate-toggl-modal__error"
        >
          {{ err }}
        </div>
        <div v-if="result.errors.length > 20">...and {{ result.errors.length - 20 }} more</div>
      </div>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import ObsidianModal from './obsidian/Modal.vue'
import ObsidianButton from './obsidian/Button.vue'
import Setting from './obsidian/Setting.vue'
import Input from './obsidian/Input.vue'
import PeriodSelector from './obsidian/PeriodSelector.vue'
import { ref } from 'vue'
import { migrateFromToggl, type TogglMigrationResult } from '@/commands/migrateFromToggl'
import dayjs from 'dayjs'

const emit = defineEmits<{
  (e: 'close'): void
}>()

const apiToken = ref('')
const periodStart = ref<dayjs.Dayjs>(dayjs().startOf('month'))
const periodEnd = ref<dayjs.Dayjs>(dayjs().endOf('month'))

const migrating = ref(false)
const completed = ref(false)
const statusText = ref('')
const progressPercent = ref(0)

const result = ref<TogglMigrationResult>({
  entriesCreated: 0,
  notesCreated: 0,
  skipped: 0,
  errors: [],
})

const startMigration = async () => {
  migrating.value = true
  completed.value = false
  statusText.value = 'Starting...'
  progressPercent.value = 0
  result.value = { entriesCreated: 0, notesCreated: 0, skipped: 0, errors: [] }

  result.value = await migrateFromToggl(
    apiToken.value.trim(),
    periodStart.value,
    periodEnd.value,
    (progress) => {
      statusText.value = progress.stage
      progressPercent.value = progress.percent
      result.value = { ...progress.result }
    }
  )

  migrating.value = false
  completed.value = true
  statusText.value = 'Import complete'
  progressPercent.value = 100
}
</script>

<style lang="scss">
.modal:has(.abele-migrate-toggl-modal) {
  width: 600px;
}

.abele-migrate-toggl-modal {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
}

.abele-migrate-toggl-modal__buttons {
  display: flex;
  gap: var(--size-4-2);
  margin-top: var(--size-4-2);
}

.abele-migrate-toggl-modal__progress {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
  margin-top: var(--size-4-2);
}

.abele-migrate-toggl-modal__status {
  font-size: var(--font-ui-small);
  color: var(--text-muted);
}

.abele-migrate-toggl-modal__bar-container {
  width: 100%;
  height: 6px;
  background-color: var(--background-modifier-border);
  border-radius: 3px;
  overflow: hidden;
}

.abele-migrate-toggl-modal__bar {
  height: 100%;
  background-color: var(--interactive-accent);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.abele-migrate-toggl-modal__counts {
  display: flex;
  gap: var(--size-4-4);
  font-size: var(--font-ui-small);
  color: var(--text-muted);
}

.abele-migrate-toggl-modal__errors {
  margin-top: var(--size-4-2);

  h4 {
    margin: 0 0 var(--size-4-1) 0;
    color: var(--text-error);
  }
}

.abele-migrate-toggl-modal__error {
  font-size: var(--font-ui-small);
  color: var(--text-muted);
  padding: var(--size-2-1) 0;
  border-bottom: 1px solid var(--background-modifier-border);
}
</style>
