<template>
  <div class="abele-staged-settings">
    <p class="abele-staged-settings__lead">{{ lead }}</p>
    <p class="abele-staged-settings__note">{{ from }}</p>
    <p class="abele-staged-settings__note">
      Changing settings here before reloading keeps this device's version everywhere.
    </p>
    <p class="abele-staged-settings__note">
      Keep this device's sends this device's files to the other devices instead; a file only the
      other device has is left there.
    </p>

    <p v-if="error !== null" class="abele-staged-settings__error">{{ error }}</p>

    <div class="abele-staged-settings__actions">
      <slot name="actions" :busy="busy" />
      <Button
        text="Keep this device's"
        :disabled="busy"
        tooltip="Send this device's settings to the other devices over the ones that arrived"
        @click="keep"
      />
      <Button
        :text="reloadable ? applyText : 'Apply'"
        accent
        :disabled="busy"
        :tooltip="
          reloadable
            ? 'Write the settings that arrived and reload Obsidian to use them'
            : 'Write the settings that arrived; restart Obsidian to use them'
        "
        @click="apply"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Obsidian settings changed on another device, staged rather than written, and the two answers
 * (phase 3b, decision 11): apply them and reload, or keep this device's. Shown in the dialog that
 * asks once per new batch, and on the Sync tab for as long as anything waits.
 *
 * Keep names exactly the changes shown here, so one staged since the list was drawn is asked
 * about next rather than decided by somebody who never saw it. Apply writes everything staged:
 * a reload reads every settings file anyway, and one left behind would be read by nothing.
 *
 * Neither answer destroys anything, so neither is asked about first: applying replaces a file
 * the server keeps the old version of, and keeping sends this device's as a new version.
 */
import { computed, ref } from 'vue'
import { Notice } from 'obsidian'
import type { ChangeItem } from '@abele/sync-protocol'
import Button from '../obsidian/Button.vue'
import { SyncService } from '@/sync/SyncService'
import {
  appliedNotice,
  groupStaged,
  keptNotice,
  listed,
  stagedSummary,
} from '@/sync/stagedSettings'
import { reasonOf } from '@/sync/format'

const props = withDefaults(
  defineProps<{
    changes: ChangeItem[]
    /** Plugin names by folder, where this device has the plugin's manifest. */
    names: Record<string, string>
    /** What the apply button says where Obsidian can reload itself. */
    applyText?: string
  }>(),
  { applyText: 'Reload now' }
)

const emit = defineEmits<{
  /** An answer was taken; what came of it has been said. */
  (e: 'decided'): void
}>()

const sync = SyncService.getInstance()

const busy = ref(false)
const error = ref<string | null>(null)

/** Whether Obsidian here has a reload command: a phone's may not, and is asked to restart. */
const reloadable = sync.settingsPrompt.reloader.available()

const groups = computed(() => groupStaged(props.changes, props.names))

const lead = computed(
  () =>
    `Obsidian settings changed on another device: ${stagedSummary(groups.value)}. ` +
    (reloadable
      ? 'Reload Obsidian to apply them.'
      : 'Apply them, then restart Obsidian to use them.')
)

const from = computed(() => `From ${listed(groups.value.sources)}.`)

async function run(work: () => Promise<string>): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = null
  try {
    new Notice(await work())
    emit('decided')
  } catch (failure) {
    error.value = `Nothing was changed: ${reasonOf(failure)}`
  } finally {
    busy.value = false
  }
}

const apply = (): Promise<void> =>
  run(async () => appliedNotice(await sync.applySettingsAndReload()))

const keep = (): Promise<void> =>
  run(async () =>
    keptNotice(await sync.keepLocalSettings(props.changes.map((change) => change.path)))
  )
</script>

<style lang="scss">
.abele-staged-settings {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
}

.abele-staged-settings__lead,
.abele-staged-settings__note,
.abele-staged-settings__error {
  margin: 0;
  overflow-wrap: anywhere;
}

.abele-staged-settings__note {
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}

.abele-staged-settings__error {
  color: var(--text-error);
}

.abele-staged-settings__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--size-4-2);
}
</style>
