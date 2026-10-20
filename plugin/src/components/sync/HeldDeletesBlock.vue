<template>
  <div class="abele-held-deletes">
    <p class="abele-held-deletes__lead">{{ lead }}</p>

    <div class="abele-held-deletes__paths">
      <TreeItem
        v-for="one in shown"
        :key="one.fileId"
        :text="one.path"
        :path="one.path"
        icon="file-x"
        plain
      />
    </div>
    <p v-if="more > 0" class="abele-held-deletes__more">
      {{ t('streamC.ebe5ad6c0e172a75', { v1: more }) }}
    </p>

    <p v-if="filedLine !== null" class="abele-held-deletes__filed">{{ filedLine }}</p>

    <p v-if="error !== null" class="abele-held-deletes__error">{{ error }}</p>

    <div class="abele-held-deletes__actions abele-modal__actions">
      <slot name="actions" :busy="busy" />
      <Button
        :text="t('streamC.f8a2cbdf0279acb8')"
        warning
        :disabled="busy"
        :tooltip="t('streamC.d429d4f6f384bcd0')"
        @click="askDelete"
      />
      <Button
        :text="t('streamC.aadf9df0b8f9e5a1')"
        accent
        :disabled="busy"
        :tooltip="t('streamC.43c434644e207d71')"
        @click="
          decide(
            'restore',
            held.map((one) => one.fileId)
          )
        "
      />
    </div>

    <ConfirmModal
      v-if="confirming"
      :title="t('streamC.d61cb10f33068f31', { v1: String(filesOf(asked.length)) })"
      :message="confirmMessage"
      :confirm-text="t('streamC.f8a2cbdf0279acb8')"
      :confirm-tooltip="t('streamC.43d47a1bdd449e6b')"
      :cancel-tooltip="t('streamC.9defaa833983d557')"
      @confirm="decide('confirm', asked)"
      @close="confirming = false"
    />
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'

/**
 * The files the engine holds back after many went at once on this device, and the two answers
 * (phase 3b, decision 8): delete them everywhere, or put them back. Shown in the dialog that asks
 * when a hold is found, and on the Sync tab for as long as it lasts.
 *
 * The decision names exactly the files shown — taken when the button is pressed, and for Delete
 * everywhere when its confirmation opens, whose title counts them — so a delete held since is not
 * decided by somebody who never saw it: it stays held, and is asked about next. On the Sync tab
 * `held` is the live hold and grows under an open confirmation; the confirmation keeps to what it
 * named (task-10 review, #1). Deleting is asked about first, as everything destructive is;
 * putting back destroys nothing and is not.
 *
 * An answer a sync has not carried out yet — sync paused, or the run after it failed — is said
 * here, and answering again replaces it (task-10 review, #4).
 */
import { computed, ref } from 'vue'
import { Notice } from 'obsidian'
import type { HeldDelete } from '@abele/sync-sdk/core'
import Button from '../obsidian/Button.vue'
import ConfirmModal from '../obsidian/ConfirmModal.vue'
import TreeItem from '../obsidian/TreeItem.vue'
import { TokenSettingsPort } from '@/sync/tokenSettingsPort'
import { decidedNotice } from '@/sync/heldDeletes'
import { reasonOf } from '@/sync/format'

/** How many paths are listed; the rest are counted. */
const LISTED = 20

const props = defineProps<{ held: HeldDelete[]; port?: TokenSettingsPort }>()

const emit = defineEmits<{
  /** A decision was taken and handed to sync; what came of it has been said. */
  (e: 'decided'): void
}>()

const sync = props.port ?? TokenSettingsPort.getInstance()

const busy = ref(false)
const confirming = ref(false)
const error = ref<string | null>(null)

const count = computed(() => props.held.length)
const filesOf = (n: number): string => t('streamC.files', { count: n })
/** The files the open confirmation names, fixed when it opened. */
const asked = ref<string[]>([])

/** Open the confirmation on the files shown now; it decides exactly those. */
function askDelete(): void {
  asked.value = props.held.map((one) => one.fileId)
  confirming.value = true
}

/** The answer waiting for a sync to carry it out, in words, or null when none waits. */
const filedLine = computed((): string | null => {
  const filed = sync.heldPrompt.decided.value
  if (filed === null) return null
  const what =
    filed.kind === 'confirm' ? t('streamC.d1fde4fc6876b769') : t('streamC.4e2963a97edfbd4f')
  const when =
    sync.status.value.state === 'paused'
      ? t('streamC.fe65403108c35eaa')
      : t('streamC.08afb9fff41772f4')
  return t('streamC.67a94b415a989c0a', { v1: what, v2: filesOf(filed.count), v3: when })
})
const shown = computed(() => props.held.slice(0, LISTED))
const more = computed(() => Math.max(0, count.value - LISTED))

const lead = computed(() => t('streamC.heldLead', { count: count.value }))

const confirmMessage = computed(() => t('streamC.heldConfirm', { count: asked.value.length }))

async function decide(kind: 'confirm' | 'restore', fileIds: string[]): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = null
  try {
    const result = await sync.decideDeletes(kind, fileIds)
    new Notice(decidedNotice(kind, result, sync.status.value.state))
    emit('decided')
  } catch (failure) {
    error.value = t('streamC.569af3e1a0bf7018', { v1: String(reasonOf(failure)) })
  } finally {
    busy.value = false
  }
}
</script>

<style lang="scss">
.abele-held-deletes {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
}

// In the tall dialog the paths, not the entire sheet, scroll. Otherwise a sticky answer row
// can float above paths still visible in the sheet below it at narrow phone widths.
.abele-modal_tall .abele-modal__body > .abele-held-deletes {
  flex: 1 1 auto;
  min-height: 0;
}

.abele-modal_tall .abele-held-deletes__paths {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.abele-held-deletes__lead,
.abele-held-deletes__more,
.abele-held-deletes__error {
  margin: 0;
  overflow-wrap: anywhere;
}

.abele-held-deletes__more,
.abele-held-deletes__filed {
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}

.abele-held-deletes__filed {
  margin: 0;
  overflow-wrap: anywhere;
}

.abele-held-deletes__error {
  color: var(--text-error);
}

.abele-held-deletes__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--size-4-2);
}
</style>
