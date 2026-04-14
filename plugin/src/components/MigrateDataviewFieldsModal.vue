<template>
  <ObsidianModal title="Migrate from dataview fields" @close="emit('close')">
    <div class="abele-migrate-dvf-modal">
      <p class="abele-migrate-dvf-modal__desc">
        Scans all notes for inline dataview fields (<code>[key:: value]</code>) and moves them into
        frontmatter. The field is removed from the line; surrounding content is preserved. Notes
        with duplicate keys or frontmatter conflicts are skipped.
      </p>

      <Setting name="Dry run" desc="Preview changes without modifying any files.">
        <Checkbox :is-enabled="dryRun" @toggle="dryRun = !dryRun" />
      </Setting>

      <div class="abele-migrate-dvf-modal__buttons">
        <ObsidianButton
          :text="dryRun ? 'Run preview' : 'Start migration'"
          accent
          :disabled="running"
          @click="run"
        />
      </div>

      <div v-if="running" class="abele-migrate-dvf-modal__status">Processing...</div>

      <template v-if="result">
        <div class="abele-migrate-dvf-modal__status">
          {{ dryRunUsed ? 'Preview complete' : 'Migration complete' }}. Report saved to
          <code>dataview-migration-report.md</code>
        </div>

        <div v-if="result.migratedPaths.length" class="abele-migrate-dvf-modal__section">
          <h4>
            {{ dryRunUsed ? 'Will migrate' : 'Migrated' }} ({{ result.migratedPaths.length }})
          </h4>
          <div
            v-for="path in result.migratedPaths"
            :key="path"
            class="abele-migrate-dvf-modal__item"
          >
            {{ path }}
          </div>
        </div>

        <div v-if="result.skippedPaths.length" class="abele-migrate-dvf-modal__section">
          <h4>Skipped ({{ result.skippedPaths.length }})</h4>
          <div
            v-for="path in result.skippedPaths"
            :key="path"
            class="abele-migrate-dvf-modal__item"
          >
            {{ path }}
          </div>
        </div>

        <div
          v-if="!result.migratedPaths.length && !result.skippedPaths.length"
          class="abele-migrate-dvf-modal__status"
        >
          No dataview fields found.
        </div>
      </template>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import ObsidianModal from './obsidian/Modal.vue'
import ObsidianButton from './obsidian/Button.vue'
import Setting from './obsidian/Setting.vue'
import Checkbox from './obsidian/Checkbox.vue'
import {
  migrateDataviewFields,
  type MigrateDataviewFieldsResult,
} from '@/commands/migrateDataviewFields'

const emit = defineEmits<{ (e: 'close'): void }>()

const dryRun = ref(true)
const running = ref(false)
const result = ref<MigrateDataviewFieldsResult | null>(null)
const dryRunUsed = ref(true)

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
.abele-migrate-dvf-modal {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
}

.abele-migrate-dvf-modal__desc {
  color: var(--text-muted);
  font-size: var(--font-ui-small);
  margin: 0;

  code {
    font-size: var(--font-ui-smaller);
  }
}

.abele-migrate-dvf-modal__buttons {
  display: flex;
  gap: var(--size-4-2);
  align-items: center;
}

.abele-migrate-dvf-modal__status {
  font-size: var(--font-ui-small);
  color: var(--text-muted);

  code {
    font-size: var(--font-ui-smaller);
  }
}

.abele-migrate-dvf-modal__section {
  h4 {
    font-size: var(--font-ui-small);
    font-weight: var(--font-semibold);
    margin: var(--size-4-2) 0 var(--size-4-1) 0;
  }
}

.abele-migrate-dvf-modal__item {
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
  padding: 2px 0;
  word-break: break-all;
}
</style>
