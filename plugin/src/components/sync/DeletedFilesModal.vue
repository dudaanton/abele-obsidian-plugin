<template>
  <ObsidianModal title="Deleted files" size="tall" @close="emit('close')">
    <div ref="root" class="abele-deleted-files">
      <div class="abele-deleted-files__head">
        <p class="abele-deleted-files__desc">
          What has been deleted anywhere in this vault and not yet swept. Restoring one brings it
          back to the path it had, on every device.
        </p>
        <!--
          A failure is a line above the list, not a replacement for it: one file the server
          would not bring back leaves every other one on the list and still restorable.
        -->
        <p v-if="error !== null" class="abele-deleted-files__error">{{ error }}</p>
      </div>

      <div class="abele-deleted-files__list">
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
 * Restoring is not destructive and is not asked about: it puts a file back where it was. What
 * it *is* is slow — a commit and then a pull — so the row that was pressed holds the rest. And
 * a restore can be refused without failing: the server answers a 200 carrying `rejected`, and
 * it may also answer `applied` at a *different* path when the old one has since been taken, so
 * what is announced is the path the server gives back rather than the one that was asked for.
 */
import { onMounted, ref, useTemplateRef } from 'vue'
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
/** What the list says when there is no list: reading, unreachable, or an empty trash. */
const notice = ref<string | null>('Reading what has been deleted…')
/** What went wrong, said above the list without taking it away. */
const error = ref<string | null>(null)
/** The file id being restored, so its row can say so and the others can wait. */
const busy = ref<string | null>(null)

const root = useTemplateRef<HTMLElement>('root')

let client: VaultClient | null = null

/** When it went, and how much comes back with it. */
const metaOf = (item: TrashItem): string[] => [
  `Deleted ${formatWhen(item.deleted_at)}`,
  formatBytes(item.size),
]

/**
 * A key for one restore.
 *
 * Minted from the element's own window: settings can open in a window of their own, and the
 * `crypto` a dialog there should use is that window's. A restore retried under the key it was
 * first sent with is the first answer again rather than a second copy of the file.
 */
const idempotencyKey = (): string => (root.value?.win ?? window).crypto.randomUUID()

async function restore(item: TrashItem): Promise<void> {
  if (client === null || busy.value !== null) return
  busy.value = item.file_id
  error.value = null
  try {
    const result = await client.restoreDeleted(item.file_id, idempotencyKey())
    // A refusal is a 200, not a throw. Announcing it as a restore is how a dialog lies, and
    // the file stays on the list because it is still in the trash.
    if (result.status === 'rejected') {
      error.value = `${item.path} was not restored: ${result.message}`
      return
    }
    sync.note(`restored ${result.path} from the trash`)
    // The file is back on the server; the pull is what puts it back in the vault.
    await sync.syncNow()
    // The server's path, not the one that was asked for: the old name may have been taken
    // since, and then the file comes back beside it under the next free one.
    new Notice(`${result.path} restored.`)
    // Off the list rather than re-read: the whole trash is a round trip, and the one thing
    // that changed is the row that was pressed.
    items.value = items.value.filter((held) => held.file_id !== item.file_id)
    if (items.value.length === 0) notice.value = EMPTY
  } catch (failure) {
    error.value = `${item.path} could not be restored: ${reasonOf(failure)}`
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
    notice.value = null
    error.value = `The trash could not be read: ${reasonOf(failure)}`
  }
})
</script>

<style lang="scss">
/**
 * A column, because the dialog is one: `.abele-modal_tall` is a flex column with
 * `overflow: hidden`, so whatever it holds has to take the scrolling on itself. A body that
 * grew instead would push a long trash past the bottom of the sheet, where nothing can reach
 * it.
 */
.abele-deleted-files {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}

.abele-deleted-files__head {
  flex: 0 0 auto;
  margin-bottom: var(--size-4-3);
}

/**
 * The list is the one scroller here, and it scrolls one way only: a card wraps, so there is
 * never anything to reach sideways for.
 */
.abele-deleted-files__list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.abele-deleted-files__desc {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}

.abele-deleted-files__error {
  margin: var(--size-4-2) 0 0;
  color: var(--text-error);
  font-size: var(--font-ui-small);
  overflow-wrap: anywhere;
}

/** A path is the title here, and a path has no space to break at. */
.abele-deleted-files .abele-card__name {
  overflow-wrap: anywhere;
}
</style>
