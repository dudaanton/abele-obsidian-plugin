<template>
  <ObsidianModal title="Deleted files" size="tall" @close="emit('close')">
    <div class="abele-deleted-files">
      <p class="abele-deleted-files__desc">
        What has been deleted anywhere in this vault and not yet swept. Restoring one brings it back
        to the path it had, on every device.
      </p>

      <EmptyState v-if="notice !== null" :text="notice" />

      <CardGrid v-else stack>
        <Card v-for="item in items" :key="item.file_id" :title="item.path" :meta="metaOf(item)">
          <template #badges>
            <Badge :text="KIND_LABEL[item.kind]" />
          </template>

          <template #actions>
            <Button
              text="Restore"
              :disabled="busy !== null"
              tooltip="Bring this file back to the path it was deleted from"
              @click="restore(item)"
            />
          </template>
        </Card>
      </CardGrid>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
/**
 * The vault's trash: what has been deleted, and the way back.
 *
 * This is the server's trash and not Obsidian's. A file deleted on a phone is gone from every
 * device the moment they sync, and the only copy left is the one the server keeps until the
 * retention policy sweeps it — so this is the one screen that can undo a deletion somebody
 * made a week ago on a device they are not holding.
 *
 * Restoring is not destructive and is not asked about: it puts a file back where it was, and
 * a path that has since been taken is the server's business to answer. What it *is* is slow —
 * a commit and then a pull — so the row that was pressed says so and the rest are held.
 */
import { onMounted, ref } from 'vue'
import { Notice } from 'obsidian'
import type { VaultClient } from '@abele/sync-core'
import type { FileKind, TrashItem } from '@abele/sync-protocol'
import ObsidianModal from '../obsidian/Modal.vue'
import Card from '../obsidian/Card.vue'
import CardGrid from '../obsidian/CardGrid.vue'
import Badge from '../obsidian/Badge.vue'
import Button from '../obsidian/Button.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import { SyncService } from '@/sync/SyncService'
import { formatWhen, reasonOf } from '@/sync/format'
import { formatBytes } from '@/helpers/reduceImage'

const emit = defineEmits<{ (e: 'close'): void }>()

/** What each kind is called on a screen; the same words the usage card uses. */
const KIND_LABEL: Record<FileKind, string> = {
  note: 'Note',
  canvas: 'Canvas',
  attachment: 'Attachment',
  script: 'Script',
  settings: 'Obsidian settings',
}

/** What the screen says when there is nothing in the trash, which is the usual case. */
const EMPTY = 'Nothing has been deleted, or everything deleted has already been swept.'

const sync = SyncService.getInstance()

const items = ref<TrashItem[]>([])
const notice = ref<string | null>('Reading what has been deleted…')
/** The file id being restored, so its row can say so and the others can wait. */
const busy = ref<string | null>(null)

let client: VaultClient | null = null

/** When it went, and how much comes back with it. */
const metaOf = (item: TrashItem): string[] => [
  `Deleted ${formatWhen(item.deleted_at)}`,
  formatBytes(item.size),
]

async function restore(item: TrashItem): Promise<void> {
  if (client === null || busy.value !== null) return
  busy.value = item.file_id
  try {
    await client.restoreDeleted(item.file_id)
    sync.note(`restored ${item.path} from the trash`)
    // The file is back on the server; the pull is what puts it back in the vault.
    await sync.syncNow()
    new Notice(`${item.path} restored.`)
    // Off the list rather than re-read: the whole trash is a round trip, and the one thing
    // that changed is the row that was pressed.
    items.value = items.value.filter((held) => held.file_id !== item.file_id)
    if (items.value.length === 0) notice.value = EMPTY
  } catch (failure) {
    notice.value = `${item.path} could not be restored: ${reasonOf(failure)}`
  } finally {
    busy.value = null
  }
}

onMounted(async () => {
  client = sync.client()
  if (client === null) {
    notice.value = 'The trash is kept on the server, and this device is not connected to one.'
    return
  }
  try {
    const listed = await client.trash()
    // Newest first: what somebody came here to undo is what they deleted last.
    items.value = [...listed].sort((a, b) => b.deleted_at.localeCompare(a.deleted_at))
    notice.value = items.value.length === 0 ? EMPTY : null
  } catch (failure) {
    notice.value = `The trash could not be read: ${reasonOf(failure)}`
  }
})
</script>

<style lang="scss">
.abele-deleted-files__desc {
  margin: 0 0 var(--size-4-3);
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}

/** A path is the title here, and a path has no space to break at. */
.abele-deleted-files .abele-card__name {
  overflow-wrap: anywhere;
}
</style>
