<template>
  <ObsidianModal title="Version history" size="tall" @close="emit('close')">
    <div ref="root" class="abele-version-history">
      <div class="abele-version-history__head">
        <p class="abele-version-history__path">{{ path }}</p>
        <!--
          A failure is a line above the list, not a replacement for it: a restore the server
          refused leaves every other version still worth reading and still restorable.
        -->
        <p v-if="error !== null" class="abele-version-history__error">{{ error }}</p>
      </div>

      <div class="abele-version-history__list">
        <EmptyState v-if="notice !== null" :text="notice" />

        <CardGrid v-else stack>
          <Card
            v-for="version in versions"
            :key="version.version_id"
            :title="`#${version.no}`"
            :meta="metaOf(version)"
            :clickable="isText"
            :selected="isText ? selected === version.version_id : undefined"
            @click="select(version)"
          >
            <template #badges>
              <Badge :text="OP_LABEL[version.op]" />
            </template>

            <template #actions>
              <Button
                text="Restore"
                :disabled="busy || refusalFor(version) !== null"
                :tooltip="refusalFor(version) ?? 'Make this version the current one again'"
                @click="confirming = version"
              />
            </template>

            <!--
              The preview sits inside a card that opens and closes on a click, so its own clicks
              are stopped: selecting a line of the diff to copy it must not fold the diff away.
            -->
            <div v-if="selected === version.version_id" @click.stop @keydown.enter.stop>
              <p v-if="previewNote !== null" class="abele-version-history__note">
                {{ previewNote }}
              </p>
              <div v-else class="abele-version-history__diff">
                <div
                  v-for="(line, index) in diff"
                  :key="index"
                  class="abele-version-history__diff-line"
                  :class="lineClass(line)"
                >
                  {{ line }}
                </div>
              </div>
            </div>
          </Card>
        </CardGrid>
      </div>
    </div>

    <ConfirmModal
      v-if="confirming !== null"
      title="Restore this version?"
      :message="confirmMessage"
      confirm-text="Restore"
      confirm-tooltip="Put these bytes back as the current version"
      cancel-tooltip="Close this and leave the file as it is"
      @confirm="restore"
      @close="confirming = null"
    />
  </ObsidianModal>
</template>

<script setup lang="ts">
/**
 * What has happened to one file, and what putting an old version back would change.
 *
 * The history is the server's, not this device's: a version is a thing every device shares,
 * and the ledger this device keeps holds only the one it currently agrees with. So the file id
 * comes from that ledger — a path is not an identity, a moved file keeps its id — and
 * everything else is asked of the server when the dialog opens.
 *
 * The preview is a unified diff of a version against the file as it stands, which is the
 * question a person actually has: not "what did this version say" but "what would I be
 * undoing". A file that is not text has no such answer, so it gets the list and nothing more —
 * two versions of a picture differ, and saying so line by line is a wall of bytes.
 *
 * Restoring goes through the server rather than by writing the bytes here. A restore is a
 * commit like any other: the server makes it the head, and the engine pulls it onto disk on
 * the next sync — which is what `syncNow` is for, and why the editor shows the restored text
 * without this dialog touching the vault at all. And like any other commit it can be *refused*
 * without failing — a 200 carrying `rejected` — which is why the answer is read rather than
 * discarded.
 */
import { computed, onMounted, ref, useTemplateRef } from 'vue'
import { Notice } from 'obsidian'
import type { VaultClient } from '@abele/sync-core'
import type { VersionInfo, VersionOp } from '@abele/sync-protocol'
import ObsidianModal from '../obsidian/Modal.vue'
import Card from '../obsidian/Card.vue'
import CardGrid from '../obsidian/CardGrid.vue'
import Badge from '../obsidian/Badge.vue'
import Button from '../obsidian/Button.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import ConfirmModal from '../obsidian/ConfirmModal.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { SyncService } from '@/sync/SyncService'
import { formatWhen, reasonOf } from '@/sync/format'
import { unifiedDiff } from '@/sync/diff'
import { formatBytes } from '@/helpers/reduceImage'

const props = defineProps<{
  /** The file whose history this is, as the vault spells it. */
  path: string
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

/** How far back one page of history goes. The same page the daemon's `history` shows. */
const PAGE = 50

/** What each version did to the file, in the words a person reads rather than the wire's. */
const OP_LABEL: Record<VersionOp, string> = {
  create: 'Created',
  modify: 'Edited',
  delete: 'Deleted',
  move: 'Moved',
  restore: 'Restored',
  merge: 'Merged',
  conflict: 'Conflict',
}

/**
 * The extensions a diff is worth drawing for.
 *
 * Named rather than sniffed, because the point of the list is to *not* fetch the bytes: a
 * version of a video is a download, and asking for one to discover it is not text is the
 * wrong way round. The bytes are still checked once they arrive — a `.md` holding something
 * that is not UTF-8 is possible, and a decoder that threw would take the dialog with it.
 */
const TEXT_EXTENSIONS = [
  'md',
  'markdown',
  'txt',
  'canvas',
  'base',
  'json',
  'csv',
  'css',
  'js',
  'ts',
  'html',
  'xml',
  'yaml',
  'yml',
  'svg',
]

const sync = SyncService.getInstance()

const versions = ref<VersionInfo[]>([])
/** What the list says when there is no list: reading, unreachable, unsynced, or empty. */
const notice = ref<string | null>('Reading this file’s history…')
/** What went wrong, said above the list without taking it away. */
const error = ref<string | null>(null)
const selected = ref<string | null>(null)
const diff = ref<string[]>([])
const previewNote = ref<string | null>(null)
const confirming = ref<VersionInfo | null>(null)
const busy = ref(false)

const root = useTemplateRef<HTMLElement>('root')

let fileId = ''
/** The version this device currently agrees with — the one there is nothing to restore to. */
let currentVersionId = ''
let client: VaultClient | null = null

/**
 * Whether a diff is worth drawing for this path.
 *
 * The extension is taken from the last segment and not from the whole path: a folder with a
 * dot in its name — `my.notes/README` — would otherwise hand `notes/README` to the list, and a
 * file with no extension at all would hand over its own name.
 */
const isText = computed(() => {
  const name = props.path.split('/').pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot < 0 ? false : TEXT_EXTENSIONS.includes(name.slice(dot + 1).toLowerCase())
})

/**
 * Why this version cannot be restored, or null when it can — and the tooltip either way.
 *
 * Two versions have nothing to put back. The current one is already the head, and the server
 * would answer a restore of it with `rejected`; a deletion holds no bytes at all, which the
 * server answers the same way. Both are better said on a disabled button than found out by
 * pressing it.
 */
function refusalFor(version: VersionInfo): string | null {
  if (version.version_id === currentVersionId) return 'This is already the current version'
  if (version.op === 'delete') return 'A deletion holds no content to put back'
  return null
}

const confirmMessage = computed(() => {
  const version = confirming.value
  if (version === null) return ''
  const head = `Version #${version.no} of ${props.path} becomes the current one, on this device and every other. Nothing is lost: what the file holds now stays in the history as a version of its own.`
  // A restore is about content, never about where the file lives. Saying so matters most for a
  // version that moved the file: restoring it does not put the file back at the old name.
  const moved = version.op === 'move' || version.path !== props.path
  return moved
    ? `${head} That version had the file at ${version.path}; restoring puts its content back at ${props.path}, where the file is now — the move itself is not undone.`
    : head
})

/** The three facts about a version that fit on one faint row: who, when, and how big. */
const metaOf = (version: VersionInfo): string[] => [
  version.actor.name,
  formatWhen(version.at),
  formatBytes(version.size),
]

/** Which part of a unified diff a line is, so the block can colour it. */
function lineClass(line: string): string {
  if (line.startsWith('---') || line.startsWith('+++'))
    return 'abele-version-history__diff-line_head'
  if (line.startsWith('@@')) return 'abele-version-history__diff-line_hunk'
  if (line.startsWith('+')) return 'abele-version-history__diff-line_added'
  if (line.startsWith('-')) return 'abele-version-history__diff-line_removed'
  return ''
}

/**
 * The bytes as text, or null when they are not text at all.
 *
 * A NUL byte settles it without decoding anything, and a strict decoder settles the rest: a
 * lenient one answers every byte string with replacement characters, which would draw a diff
 * of question marks rather than saying the file is not text.
 */
function asText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/** The file as it stands in the vault; empty when the path holds nothing any more. */
async function currentText(): Promise<string> {
  const { app } = GlobalStore.getInstance()
  const file = app.vault.getFileByPath(props.path)
  return file === null ? '' : app.vault.cachedRead(file)
}

/**
 * Opens a version's preview, or closes the one that is open.
 *
 * The bytes are fetched on the click rather than with the list: a history of fifty versions is
 * fifty downloads, and a person reads one or two of them.
 */
async function select(version: VersionInfo): Promise<void> {
  if (!isText.value || client === null) return
  if (selected.value === version.version_id) {
    selected.value = null
    return
  }
  selected.value = version.version_id
  diff.value = []
  previewNote.value = 'Reading this version…'
  try {
    const bytes = await client.versionBytes(fileId, version.version_id)
    // The answer to a click that has since been overtaken by another one.
    if (selected.value !== version.version_id) return
    const text = asText(bytes)
    if (text === null) {
      previewNote.value = 'This version is not text, so there is nothing to show line by line.'
      return
    }
    const lines = unifiedDiff(text, await currentText(), {
      from: `${props.path} #${version.no}`,
      to: `${props.path} as it is now`,
    })
    if (selected.value !== version.version_id) return
    if (lines.length === 0) {
      previewNote.value = 'This version says exactly what the file says now.'
      return
    }
    diff.value = lines
    previewNote.value = null
  } catch (failure) {
    previewNote.value = `This version could not be read: ${reasonOf(failure)}`
  }
}

/**
 * A key for the one commit this dialog can send.
 *
 * Minted from the element's own window: settings can open in a window of their own, and the
 * `crypto` a dialog there should use is that window's. A restore retried under the key it was
 * first sent with is the first answer again rather than a second version of the same bytes.
 */
const idempotencyKey = (): string => (root.value?.win ?? window).crypto.randomUUID()

/** Make the version the head again, then pull it onto disk. */
async function restore(): Promise<void> {
  const version = confirming.value
  if (version === null || client === null || busy.value) return
  busy.value = true
  error.value = null
  try {
    const result = await client.restore(fileId, version.version_id, idempotencyKey())
    // A refusal is a 200, not a throw: the server answers "no, and here is why" in the same
    // shape it answers "yes". Announcing that as a restore is how a dialog lies.
    if (result.status === 'rejected') {
      error.value = `Version #${version.no} was not restored: ${result.message}`
      return
    }
    sync.note(`restored ${props.path} to version #${version.no}`)
    // The commit is on the server; the file on disk is still the old one until the engine
    // fetches it, and there is no reason to make somebody wait for the next trigger.
    await sync.syncNow()
    new Notice(`${result.path} restored to version #${version.no}.`)
    emit('close')
  } catch (failure) {
    error.value = `Version #${version.no} could not be restored: ${reasonOf(failure)}`
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  client = sync.client()
  if (client === null) {
    notice.value =
      'A file’s history is kept on the server, and this device is not connected to one.'
    return
  }
  try {
    // Inside the try with the request: the ledger is a database, and a database that will not
    // open would otherwise leave this dialog reading for ever.
    const entry = await sync.entryFor(props.path)
    if (entry === null) {
      notice.value = 'This file has not been synced yet, so the server holds no history of it.'
      return
    }
    fileId = entry.fileId
    currentVersionId = entry.versionId
    versions.value = await client.versions(fileId, { limit: PAGE })
    notice.value =
      versions.value.length === 0 ? 'The server holds no versions of this file yet.' : null
  } catch (failure) {
    notice.value = null
    error.value = `This file’s history could not be read: ${reasonOf(failure)}`
  }
})
</script>

<style lang="scss">
/**
 * A column, because the dialog is one: `.abele-modal_tall` is a flex column with
 * `overflow: hidden`, so whatever it holds has to take the scrolling on itself. A body that
 * grew instead would push fifty version cards — and an expanded diff — past the bottom of the
 * sheet, where nothing can reach them.
 */
.abele-version-history {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}

.abele-version-history__head {
  flex: 0 0 auto;
  margin-bottom: var(--size-4-3);
}

/**
 * The list is the one scroller here, and it scrolls one way only: a card wraps and a diff line
 * wraps, so there is never anything to reach sideways for.
 */
.abele-version-history__list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

/**
 * A path has no space to break at and is long enough to outgrow a dialog on a phone, so it
 * breaks anywhere. Monospace because it is read a segment at a time.
 */
.abele-version-history__path {
  margin: 0;
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.abele-version-history__error {
  margin: var(--size-4-2) 0 0;
  color: var(--text-error);
  font-size: var(--font-ui-small);
  overflow-wrap: anywhere;
}

.abele-version-history__note {
  margin: var(--size-4-2) 0 0;
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}

/**
 * The diff itself. `white-space: pre-wrap` rather than `pre`: the leading sign and the
 * indentation of a line are part of what is being read, and a long line wraps rather than
 * taking the dialog sideways — nothing here scrolls horizontally.
 */
.abele-version-history__diff {
  margin-top: var(--size-4-2);
  padding: var(--size-4-2);
  border-radius: var(--radius-s);
  background-color: var(--code-background);
  font-family: var(--font-monospace);
  font-size: var(--font-smaller);
  line-height: var(--line-height-tight);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.abele-version-history__diff-line_head {
  color: var(--text-faint);
}

.abele-version-history__diff-line_hunk {
  color: var(--text-accent);
}

.abele-version-history__diff-line_added {
  color: var(--text-success);
}

.abele-version-history__diff-line_removed {
  color: var(--text-error);
}
</style>
