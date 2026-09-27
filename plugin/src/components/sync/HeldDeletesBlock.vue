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
    <p v-if="more > 0" class="abele-held-deletes__more">and {{ more }} more</p>

    <p v-if="filedLine !== null" class="abele-held-deletes__filed">{{ filedLine }}</p>

    <p v-if="error !== null" class="abele-held-deletes__error">{{ error }}</p>

    <div class="abele-held-deletes__actions">
      <slot name="actions" :busy="busy" />
      <Button
        text="Delete everywhere"
        warning
        :disabled="busy"
        tooltip="Send these deletions to every device; the files go to the server's trash"
        @click="askDelete"
      />
      <Button
        text="Put them back"
        accent
        :disabled="busy"
        tooltip="Bring these files back to this device from the server"
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
      :title="`Delete ${filesOf(asked.length)} everywhere?`"
      :message="confirmMessage"
      confirm-text="Delete everywhere"
      confirm-tooltip="Send these deletions to every device"
      cancel-tooltip="Close this; the files stay held"
      @confirm="decide('confirm', asked)"
      @close="confirming = false"
    />
  </div>
</template>

<script setup lang="ts">
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
import type { HeldDelete } from '@abele/sync-core'
import Button from '../obsidian/Button.vue'
import ConfirmModal from '../obsidian/ConfirmModal.vue'
import TreeItem from '../obsidian/TreeItem.vue'
import { SyncService } from '@/sync/SyncService'
import { decidedNotice } from '@/sync/heldDeletes'
import { reasonOf } from '@/sync/format'

/** How many paths are listed; the rest are counted. */
const LISTED = 20

const props = defineProps<{ held: HeldDelete[] }>()

const emit = defineEmits<{
  /** A decision was taken and handed to sync; what came of it has been said. */
  (e: 'decided'): void
}>()

const sync = SyncService.getInstance()

const busy = ref(false)
const confirming = ref(false)
const error = ref<string | null>(null)

const count = computed(() => props.held.length)
const filesOf = (n: number): string => (n === 1 ? '1 file' : `${n} files`)
const files = computed(() => filesOf(count.value))
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
  const what = filed.kind === 'confirm' ? 'delete everywhere' : 'put them back'
  const when =
    sync.status.value.state === 'paused'
      ? 'when sync is resumed'
      : 'at the next sync that gets through'
  return (
    `Decided: ${what} (${filesOf(filed.count)}), carried out ${when}. ` +
    'Answering again replaces it.'
  )
})
const shown = computed(() => props.held.slice(0, LISTED))
const more = computed(() => Math.max(0, count.value - LISTED))

const lead = computed(
  () =>
    `${files.value} ${count.value === 1 ? 'was' : 'were'} deleted on this device at once, so ` +
    `${count.value === 1 ? 'it is' : 'they are'} held back: the other devices still have ` +
    `${count.value === 1 ? 'it' : 'them'}. Delete everywhere, or put ` +
    `${count.value === 1 ? 'it' : 'them'} back here.`
)

const confirmMessage = computed(
  () =>
    `${asked.value.length === 1 ? 'It goes' : 'They go'} to the server's trash and disappear ` +
    'from every device. Until the trash is swept, Deleted files can bring them back.'
)

async function decide(kind: 'confirm' | 'restore', fileIds: string[]): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = null
  try {
    const result = await sync.decideDeletes(kind, fileIds)
    new Notice(decidedNotice(kind, result, sync.status.value.state))
    emit('decided')
  } catch (failure) {
    error.value = `Nothing was decided: ${reasonOf(failure)}`
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
