<template>
  <ObsidianModal
    :title="t('settings.SyncSettings.deleted_files.5352e2e9')"
    size="tall"
    @close="emit('close')"
  >
    <div ref="root" class="abele-deleted-files">
      <div class="abele-deleted-files__head">
        <p class="abele-deleted-files__desc">{{ t('streamC.9bec2fb48e4c199b') }}</p>
        <!--
          A failure is a line above the list, not a replacement for it: one file the server
          would not bring back leaves every other one on the list and still restorable.
        -->
        <p v-if="error !== null" class="abele-deleted-files__error">{{ error }}</p>
        <RestoreSince v-if="items.length > 0" :items="items" @restored="dropRestored" />
      </div>

      <div class="abele-deleted-files__list">
        <EmptyState v-if="notice !== null" :text="notice" />

        <!--
          A deleted file as a row, the way the file list shows one: its kind as a glyph, its name,
          and where it was, when and by whom as quiet facts. Bringing it back is a glyph at the
          row's end, with the whole sentence in its tooltip.
        -->
        <div v-else role="list">
          <EntryRow
            v-for="item in items"
            :key="item.file_id"
            role="listitem"
            class="abele-deleted-files__row"
            :data-path="item.path"
          >
            <template #leading>
              <Icon
                :icon="KIND_ICON[item.kind]"
                :interactive="false"
                :tooltip="KIND_LABEL[item.kind]"
              />
            </template>
            {{ nameOf(item.path) }}
            <template #meta>
              <span v-for="(fact, i) in metaOf(item)" :key="i">{{ fact }}</span>
            </template>
            <template #actions>
              <Icon
                :icon="
                  busy === item.file_id
                    ? 'loader'
                    : waiting.has(item.file_id)
                      ? 'clock'
                      : 'rotate-ccw'
                "
                :tooltip="buttonTooltip(item)"
                :disabled="waiting.has(item.file_id)"
                @click="restore(item)"
              />
            </template>
          </EntryRow>
        </div>
      </div>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { t } from '@/i18n'

/**
 * The vault's trash: what has been deleted, and the way back.
 *
 * This is the server's trash and not Obsidian's. A file deleted on a phone is gone from every
 * device the moment they sync, and the only copy left is the one the server keeps until the
 * retention policy sweeps it — so this is the one screen that can undo a deletion somebody
 * made a week ago on a device they are not holding.
 *
 * Restoring is not destructive and is not asked about: it puts a file back where it was. What
 * it *is* is slow — a commit and then a pull — so restores run one at a time, in the order they
 * were pressed: a row pressed while another runs says *Queued* and goes next, rather than the
 * press going nowhere. And
 * a restore can be refused without failing: the server answers a 200 carrying `rejected`, and
 * it may also answer `applied` at a *different* path when the old one has since been taken, so
 * what is announced is the path the server gives back rather than the one that was asked for.
 */
import { onMounted, ref, useTemplateRef } from 'vue'
import { Notice } from 'obsidian'
import type { V2EngineClient } from '@abele/sync-sdk/core'
import type { FileKind, TrashItem } from '@abele/sync-sdk/protocol'
import ObsidianModal from '../obsidian/Modal.vue'
import EntryRow from '../obsidian/EntryRow.vue'
import Icon from '../obsidian/Icon.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import RestoreSince from './RestoreSince.vue'
import { tokenHistory } from '@/sync/tokenHistory'
import { formatWhen, reasonOf, restoredNotice } from '@/sync/format'
import { formatBytes } from '@/helpers/reduceImage'

const emit = defineEmits<{ (e: 'close'): void }>()

/** What each kind is called on a screen; the same words the usage card uses. */
const KIND_LABEL: Record<FileKind, string> = {
  note: t('streamC.d8da2c49df39d91d'),
  canvas: t('streamC.3824a9f4dafe92c6'),
  attachment: t('streamC.040d2b3689dd1d4c'),
  script: t('streamC.102acc10e67a297d'),
  settings: t('streamC.b13708140e4bb421'),
}

/** The kind of a file as the glyph Obsidian draws it with. */
const KIND_ICON: Record<FileKind, string> = {
  note: 'file-text',
  canvas: 'layout-dashboard',
  attachment: 'file-image',
  script: 'file-code',
  settings: 'settings',
}

/** A path's last part; the folder goes to the quiet line. */
const nameOf = (path: string) => path.split('/').pop() ?? path

/** What the screen says when there is nothing in the trash, which is the usual case. */
const EMPTY = t('streamC.664ef22bb3b2ad3e')

const sync = tokenHistory()

const items = ref<TrashItem[]>([])
/** What the list says when there is no list: reading, unreachable, or an empty trash. */
const notice = ref<string | null>(t('streamC.ea69ff21d9ee12b7'))
/** What went wrong, said above the list without taking it away. */
const error = ref<string | null>(null)
/** The file id being restored, so its row can say so. */
const busy = ref<string | null>(null)
/** Every file id pressed and not yet done, the one running included: those rows are not pressable. */
const waiting = ref(new Set<string>())
/** The restores, one after another; each press joins the end. */
let line: Promise<void> = Promise.resolve()

const root = useTemplateRef<HTMLElement>('root')

let client: V2EngineClient | null = null

/** When it went, and how much comes back with it. */
const metaOf = (item: TrashItem): string[] => {
  const folder = item.path.includes('/') ? item.path.slice(0, item.path.lastIndexOf('/')) : ''
  return [
    ...(folder ? [folder] : []),
    t('streamC.0f37e8a15480928a', { v1: formatWhen(item.deleted_at) }),
    ...(item.deleted_by ? [t('streamC.5c799fb78f547006', { v1: item.deleted_by.name })] : []),
    formatBytes(item.size),
  ]
}

/**
 * A key for one restore.
 *
 * Minted from the element's own window: settings can open in a window of their own, and the
 * `crypto` a dialog there should use is that window's. A restore retried under the key it was
 * first sent with is the first answer again rather than a second copy of the file.
 */
const idempotencyKey = (): string => (root.value?.win ?? window).crypto.randomUUID()

const buttonTooltip = (item: TrashItem): string => {
  if (busy.value === item.file_id) return t('streamC.3417ab5bcd980d61')
  if (waiting.value.has(item.file_id)) return t('streamC.dc0cafe58bc581a0')
  return t('streamC.da366e68d4cdebc9')
}

/**
 * Put a press in line. A second press of a row already in line does nothing — it is on its way.
 * A press into an empty line starts a fresh account of what went wrong.
 */
function restore(item: TrashItem): Promise<void> {
  if (client === null || waiting.value.has(item.file_id)) return line
  if (waiting.value.size === 0) error.value = null
  waiting.value.add(item.file_id)
  line = line.then(() => restoreOne(item))
  return line
}

async function restoreOne(item: TrashItem): Promise<void> {
  if (client === null) return
  busy.value = item.file_id
  try {
    const result = await client.restoreDeleted(item.file_id, idempotencyKey())
    // A refusal is a 200, not a throw. Announcing it as a restore is how a dialog lies, and
    // the file stays on the list because it is still in the trash.
    if (result.status === 'rejected') {
      error.value = t('streamC.d4db346ac512b8e0', {
        v1: String(item.path),
        v2: String(result.message),
      })
      return
    }
    sync.note(`restored ${result.path} from the trash`)
    // The file is back on the server; the pull is what puts it back in the vault.
    await sync.syncNow()
    // The server's path, not the one that was asked for: the old name may have been taken
    // since, and then the file comes back beside it under the next free one.
    new Notice(
      restoredNotice(
        sync.status.value.state,
        t('streamC.70be0bef773b3912', { v1: String(result.path) }),
        t('streamC.89e923bafc4dfd29', { v1: String(result.path) })
      )
    )
    // Off the list rather than re-read: the whole trash is a round trip, and the one thing
    // that changed is the row that was pressed.
    items.value = items.value.filter((held) => held.file_id !== item.file_id)
    if (items.value.length === 0) notice.value = EMPTY
  } catch (failure) {
    error.value = t('streamC.237e7ed9588681a4', {
      v1: String(item.path),
      v2: String(reasonOf(failure)),
    })
  } finally {
    busy.value = null
    waiting.value.delete(item.file_id)
  }
}

/** Files a bulk restore took out of the trash leave the list, as a single restore's row does. */
function dropRestored(fileIds: string[]): void {
  const gone = new Set(fileIds)
  items.value = items.value.filter((held) => !gone.has(held.file_id))
  if (items.value.length === 0) notice.value = EMPTY
}

onMounted(async () => {
  client = sync.client()
  if (client === null) {
    notice.value = t('streamC.ebcf4e46c56fc5c5')
    return
  }
  try {
    const listed = await client.trash()
    // Newest first: what somebody came here to undo is what they deleted last.
    items.value = [...listed].sort((a, b) => b.deleted_at.localeCompare(a.deleted_at))
    notice.value = items.value.length === 0 ? EMPTY : null
  } catch (failure) {
    notice.value = null
    error.value = t('streamC.fe2c18869159b80f', { v1: String(reasonOf(failure)) })
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
 * The list is the one scroller here, and it scrolls one way only: a row wraps, so there is
 * never anything to reach sideways for.
 */
.abele-deleted-files__list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  // Room inside the scroller for a row's light, which hangs past the text edge.
  padding-inline: var(--size-2-3);
  margin-inline: calc(-1 * var(--size-2-3));
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

/** A name has no space to break at, often, and a folder never has. */
.abele-deleted-files__row .abele-entry-row__title,
.abele-deleted-files__row .abele-entry-row__meta {
  overflow-wrap: anywhere;
}
</style>
