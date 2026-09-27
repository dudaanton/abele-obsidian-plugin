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
      />
    </div>
    <p v-if="more > 0" class="abele-held-deletes__more">and {{ more }} more</p>

    <p v-if="error !== null" class="abele-held-deletes__error">{{ error }}</p>

    <div class="abele-held-deletes__actions">
      <slot name="actions" :busy="busy" />
      <Button
        text="Delete everywhere"
        warning
        :disabled="busy"
        tooltip="Send these deletions to every device; the files go to the server's trash"
        @click="confirming = true"
      />
      <Button
        text="Put them back"
        accent
        :disabled="busy"
        tooltip="Bring these files back to this device from the server"
        @click="decide('restore')"
      />
    </div>

    <ConfirmModal
      v-if="confirming"
      :title="`Delete ${files} everywhere?`"
      :message="confirmMessage"
      confirm-text="Delete everywhere"
      confirm-tooltip="Send these deletions to every device"
      cancel-tooltip="Close this; the files stay held"
      @confirm="decide('confirm')"
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
 * The decision names exactly the files shown here — `held` as it was handed in — so a delete
 * held since the list was drawn is not decided by somebody who never saw it: it stays held, and
 * is asked about next. Deleting is asked about first, as everything destructive is; putting
 * back destroys nothing and is not.
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
const files = computed(() => (count.value === 1 ? '1 file' : `${count.value} files`))
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
    `${count.value === 1 ? 'It goes' : 'They go'} to the server's trash and disappear from every ` +
    'device. Until the trash is swept, Deleted files can bring them back.'
)

async function decide(kind: 'confirm' | 'restore'): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = null
  try {
    const result = await sync.decideDeletes(
      kind,
      props.held.map((one) => one.fileId)
    )
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

.abele-held-deletes__more {
  color: var(--text-muted);
  font-size: var(--font-ui-small);
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
