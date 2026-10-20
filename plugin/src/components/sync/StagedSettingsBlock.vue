<template>
  <div class="abele-staged-settings">
    <p v-if="changes.length" class="abele-staged-settings__lead">{{ lead }}</p>
    <p v-if="changes.length" class="abele-staged-settings__note">{{ from }}</p>
    <p class="abele-staged-settings__note">{{ t('streamC.8a13443f6c08ad45') }}</p>
    <p class="abele-staged-settings__note">{{ t('streamC.6da382df69a482c3') }}</p>

    <p v-if="written.length" class="abele-staged-settings__note">
      {{ t('streamC.656c1efb53fc7225', { v1: written.join(', ') }) }}
    </p>
    <p v-if="error !== null" class="abele-staged-settings__error">{{ error }}</p>

    <div class="abele-staged-settings__actions">
      <slot name="actions" :busy="busy" />
      <Button
        v-if="written.length && reloadable"
        :text="t('streamC.3f57306bd7ae3d04')"
        :disabled="busy"
        :tooltip="t('streamC.2cb1129b9a96e4c6')"
        @click="reloadWritten"
      />
      <Button
        v-if="changes.length"
        :text="t('streamC.01c9fdc2a64e1160')"
        :disabled="busy"
        :tooltip="busy ? t('streamC.54c5c791d4635615') : t('streamC.4f5523d292d1c309')"
        @click="keep"
      />
      <Button
        v-if="changes.length"
        :text="reloadable ? applyText : t('settings.transfer.TransferScanModal.apply.31e392d1')"
        accent
        :disabled="busy"
        :tooltip="
          busy
            ? t('streamC.54c5c791d4635615')
            : reloadable
              ? t('streamC.f1ce22cc91505612')
              : t('streamC.6550735a28c92865')
        "
        @click="apply"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'

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
import type { ChangeItem } from '@abele/sync-sdk/protocol'
import Button from '../obsidian/Button.vue'
import { TokenSettingsPort } from '@/sync/tokenSettingsPort'
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
    port?: TokenSettingsPort
    /** Plugin names by folder, where this device has the plugin's manifest. */
    names: Record<string, string>
    /** What the apply button says where Obsidian can reload itself. */
    applyText?: string
  }>(),
  { applyText: () => t('streamC.401ed5e6c7b026d9'), port: undefined }
)

const emit = defineEmits<{
  /** An answer was taken; what came of it has been said. */
  (e: 'decided'): void
}>()

const sync = props.port ?? TokenSettingsPort.getInstance()

const busy = ref(false)
const error = ref<string | null>(null)

/** Whether Obsidian here has a reload command: a phone's may not, and is asked to restart. */
const reloadable = sync.settingsPrompt.reloader.available()
const written = computed(() => sync.settingsPrompt.appliedWaiting?.value ?? [])

const groups = computed(() => groupStaged(props.changes, props.names))

const lead = computed(() =>
  t('streamC.a192183a87b1e0e9', {
    v1: stagedSummary(groups.value),
    v2: reloadable ? t('streamC.c4f80b852f3d70cb') : t('streamC.31130f5e44df1411'),
  })
)

const from = computed(() => t('streamC.00b0b93fb888f1c6', { v1: listed(groups.value.sources) }))

async function run(work: () => Promise<string>): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = null
  try {
    new Notice(await work())
    emit('decided')
  } catch (failure) {
    error.value = t('streamC.b3f2d4a032e619ee', { v1: String(reasonOf(failure)) })
  } finally {
    busy.value = false
  }
}

const reloadWritten = (): Promise<void> =>
  run(async () =>
    (await sync.reloadAppliedSettings())
      ? t('streamC.c0aa1f3308f0d99b')
      : t('streamC.b535e9d3b8614a16')
  )

/** The versions this block shows: what either answer is for, and nothing staged since. */
const shownVersions = (): string[] => props.changes.map((change) => change.version_id)

const apply = (): Promise<void> =>
  run(async () => appliedNotice(await sync.applySettingsAndReload(shownVersions())))

const keep = (): Promise<void> =>
  run(async () =>
    keptNotice(
      await sync.keepLocalSettings(
        props.changes.map((change) => change.path),
        shownVersions()
      )
    )
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
