<template>
  <ObsidianModal title="Import from Toggl" @close="emit('close')">
    <div class="abele-migrate-toggl-modal">
      <!-- What to import, until it is imported: then the window is the report alone. -->
      <template v-if="!migrating && !completed">
        <Setting name="API token" desc="In Toggl: Profile settings, then API token.">
          <Input v-model="apiToken" password placeholder="Toggl API token" />
        </Setting>
        <Setting name="Period" desc="Time entries in these dates are imported.">
          <PeriodSelector v-model:start="periodStart" v-model:end="periodEnd" />
        </Setting>
      </template>

      <RunReport
        v-if="migrating || completed"
        class="abele-migrate-toggl-modal__report"
        :running="migrating"
        :finished="completed"
        :status="statusText"
        :percent="progressPercent"
        :facts="facts"
        :errors="result.errors"
      />
    </div>
    <template #footer>
      <template v-if="completed">
        <ObsidianButton
          text="Back"
          tooltip="Change the token or the dates and import again"
          @click="completed = false"
        />
        <ObsidianButton text="Done" tooltip="Close this window" accent @click="emit('close')" />
      </template>
      <ObsidianButton
        v-else
        text="Import"
        tooltip="Read the time entries from Toggl and write them into the vault"
        accent
        :loading="migrating"
        :disabled="migrating || !apiToken"
        @click="startMigration"
      />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import ObsidianModal from './obsidian/Modal.vue'
import ObsidianButton from './obsidian/Button.vue'
import Setting from './obsidian/Setting.vue'
import Input from './obsidian/Input.vue'
import PeriodSelector from './obsidian/PeriodSelector.vue'
import RunReport from './obsidian/RunReport.vue'
import { computed, ref } from 'vue'
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

const facts = computed(() =>
  [
    { label: 'Time entries', value: result.value.entriesCreated },
    { label: 'Notes', value: result.value.notesCreated },
    { label: 'Skipped', value: result.value.skipped },
  ].filter((fact) => fact.value)
)

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
  statusText.value = result.value.errors.length
    ? `Imported, with ${result.value.errors.length} ${result.value.errors.length === 1 ? 'error' : 'errors'}`
    : 'Imported from Toggl'
  progressPercent.value = 100
}
</script>

<style lang="scss">
.abele-migrate-toggl-modal__report {
  margin-top: var(--size-4-4);
}
</style>
