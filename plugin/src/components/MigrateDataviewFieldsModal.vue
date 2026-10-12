<template>
  <ObsidianModal title="Dataview fields to properties" @close="emit('close')">
    <div class="abele-migrate-dvf-modal">
      <Setting
        v-if="!running && !result"
        name="Try first"
        desc="Shows which notes would change and writes nothing. A note where a key repeats or is already a property is left as it is."
      >
        <Checkbox :is-enabled="dryRun" @toggle="dryRun = !dryRun" />
      </Setting>

      <RunReport
        v-if="running || result"
        class="abele-migrate-dvf-modal__report"
        :running="running"
        :finished="!!result"
        :status="status"
      >
        <p v-if="reportNote" class="abele-migrate-dvf-modal__note">{{ reportNote }}</p>
        <ShortList
          v-if="result?.migratedPaths.length"
          :heading="dryRunUsed ? 'Would change' : 'Changed'"
          :items="result.migratedPaths.map(asRow)"
        />
        <ShortList
          v-if="result?.skippedPaths.length"
          heading="Left as they are"
          :items="result.skippedPaths.map(asRow)"
        />
      </RunReport>
    </div>
    <template #footer>
      <template v-if="result && !running">
        <ObsidianButton
          v-if="dryRunUsed && result.migratedPaths.length"
          text="Move the fields"
          tooltip="Now move every inline field into its note's properties"
          accent
          @click="moveForReal"
        />
        <ObsidianButton
          v-else
          text="Done"
          tooltip="Close this window"
          accent
          @click="emit('close')"
        />
      </template>
      <ObsidianButton
        v-else
        :text="dryRun ? 'Try' : 'Move the fields'"
        :tooltip="
          dryRun
            ? 'See which notes would change, writing nothing'
            : 'Move every inline field into its note\'s properties'
        "
        accent
        :loading="running"
        :disabled="running"
        @click="run"
      />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import ObsidianModal from './obsidian/Modal.vue'
import ObsidianButton from './obsidian/Button.vue'
import Setting from './obsidian/Setting.vue'
import Checkbox from './obsidian/Checkbox.vue'
import RunReport from './obsidian/RunReport.vue'
import ShortList from './obsidian/ShortList.vue'
import {
  migrateDataviewFields,
  type MigrateDataviewFieldsResult,
} from '@/commands/migrateDataviewFields'

const emit = defineEmits<{ (e: 'close'): void }>()

const dryRun = ref(true)
const running = ref(false)
const result = ref<MigrateDataviewFieldsResult | null>(null)
const dryRunUsed = ref(true)

const status = computed(() => {
  if (running.value) return 'Reading the notes…'
  if (!result.value) return ''
  if (!result.value.migratedPaths.length && !result.value.skippedPaths.length)
    return 'No note has an inline Dataview field.'
  return dryRunUsed.value
    ? 'Nothing written yet: these notes would change'
    : 'Moved the fields into properties'
})

/** Where the run wrote down what it did, said under the outcome. */
const reportNote = computed(() =>
  result.value && (result.value.migratedPaths.length || result.value.skippedPaths.length)
    ? 'The full report is in dataview-migration-report.md.'
    : ''
)
const asRow = (path: string) => ({
  title: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
  meta: path.slice(0, Math.max(0, path.lastIndexOf('/'))) || undefined,
})

/** After a try, the same run with writing on. */
function moveForReal() {
  dryRun.value = false
  void run()
}

async function run() {
  running.value = true
  result.value = null
  dryRunUsed.value = dryRun.value

  try {
    result.value = await migrateDataviewFields(dryRun.value)
  } finally {
    running.value = false
  }
}
</script>

<style lang="scss">
.abele-migrate-dvf-modal__report {
  margin-top: var(--size-4-4);
}

.abele-migrate-dvf-modal__note {
  margin: calc(-1 * var(--size-4-2)) 0 0;
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}
</style>
