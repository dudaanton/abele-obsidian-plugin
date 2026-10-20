<template>
  <ObsidianModal :title="t('streamC.a6df11e706c514f1')" size="tall" @close="emit('close')">
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

        <!--
          The versions as rows by day, the way a file's history reads anywhere: what happened in
          the words, who and when as quiet facts. A row unfolds into what restoring it would
          undo and the one Restore there is to press, rather than a button on every row.
        -->
        <template v-else>
          <div v-for="day in days" :key="day.label" class="abele-version-history__day">
            <GroupHeading :label="day.label" />
            <div role="list">
              <EntryRow
                v-for="version in day.versions"
                :key="version.version_id"
                role="listitem"
                class="abele-version-history__row"
                :data-version="version.no"
                :active="selected === version.version_id"
                :more="selected === version.version_id"
                :more-label="t('streamC.5d2ee847168e7be8')"
                @update:more="select(version)"
                @click="select(version)"
              >
                {{ OP_LABEL[version.op] }}
                <template v-if="version.version_id === currentId" #codes>
                  <Icon
                    icon="check"
                    :interactive="false"
                    :tooltip="t('streamC.d5413cb628ce4e4d')"
                  />
                </template>
                <template #meta>
                  <span v-for="(fact, i) in metaOf(version)" :key="i">{{ fact }}</span>
                  <span v-if="mergeLine(version, versions)" class="abele-version-history__merge">{{
                    mergeLine(version, versions)
                  }}</span>
                </template>
                <!--
                  Its own clicks are stopped: selecting a line of the diff to copy it must not
                  fold the row away.
                -->
                <template v-if="selected === version.version_id" #detail>
                  <div class="abele-version-history__open" @click.stop @keydown.enter.stop>
                    <p v-if="previewNote !== null" class="abele-version-history__note">
                      {{ previewNote }}
                    </p>
                    <div v-else-if="diff.length" class="abele-version-history__diff">
                      <div
                        v-for="(line, index) in diff"
                        :key="index"
                        class="abele-version-history__diff-line"
                        :class="lineClass(line)"
                      >
                        {{ line }}
                      </div>
                    </div>
                    <p v-if="refusalFor(version)" class="abele-version-history__note">
                      {{ refusalFor(version) }}.
                    </p>
                    <div v-else class="abele-version-history__restore">
                      <Button
                        :text="t('streamC.a76e13b9839270eb')"
                        :disabled="busy"
                        :tooltip="t('streamC.de2471dffcbbd587', { v1: String(version.no) })"
                        @click="confirming = version"
                      />
                    </div>
                  </div>
                </template>
              </EntryRow>
            </div>
          </div>
        </template>
        <ScrollMore
          v-if="hasOlder"
          :loading="loadingOlder"
          :label="t('streamC.e9ba757bff4c4c50')"
          :shown="versions.length"
          @more="!busy && loadOlder()"
        />
      </div>
    </div>

    <ConfirmModal
      v-if="confirming !== null"
      :title="t('streamC.2bfce226cd8dbd40')"
      :message="confirmMessage"
      :confirm-text="t('streamC.a76e13b9839270eb')"
      :confirm-tooltip="t('streamC.973707a50e4a1a81')"
      :cancel-tooltip="t('streamC.1923cdb4fe2ad6d2')"
      @confirm="restore"
      @close="confirming = null"
    />
  </ObsidianModal>
</template>

<script setup lang="ts">
import { t, currentLocale, dateFormatter } from '@/i18n'

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
import { computed, onMounted, onBeforeUnmount, ref, useTemplateRef } from 'vue'
import { Notice } from 'obsidian'
import type { V2EngineClient } from '@abele/sync-sdk/core'
import type { VersionInfo, VersionOp } from '@abele/sync-sdk/protocol'
import ObsidianModal from '../obsidian/Modal.vue'
import EntryRow from '../obsidian/EntryRow.vue'
import GroupHeading from '../obsidian/GroupHeading.vue'
import Icon from '../obsidian/Icon.vue'
import Button from '../obsidian/Button.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import ScrollMore from '../obsidian/ScrollMore.vue'
import ConfirmModal from '../obsidian/ConfirmModal.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { tokenHistory } from '@/sync/tokenHistory'
import { mergeLine, reasonOf, restoredNotice } from '@/sync/format'
import dayjs from '@/helpers/dateLibrary'
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
  create: t('streamC.d70b9e24bca26b40'),
  modify: t('streamC.7117f0807129493f'),
  delete: t('streamC.b48ff39c2e0f5451'),
  move: t('streamC.b11c9047f3512271'),
  restore: t('streamC.5d561a1e3f1707d6'),
  merge: t('streamC.bd0a06202c440a9e'),
  conflict: t('streamC.014659ab9d98c8fe'),
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

const sync = tokenHistory()

const versions = ref<VersionInfo[]>([])
const hasOlder = ref(false)
const loadingOlder = ref(false)
/** What the list says when there is no list: reading, unreachable, unsynced, or empty. */
const notice = ref<string | null>(t('streamC.6409814de00946cb'))
/** What went wrong, said above the list without taking it away. */
const error = ref<string | null>(null)
const selected = ref<string | null>(null)
const diff = ref<string[]>([])
const previewNote = ref<string | null>(null)
const confirming = ref<VersionInfo | null>(null)
const busy = ref(false)
onBeforeUnmount(() => {
  selected.value = null
  diff.value = []
  previewNote.value = null
})

const root = useTemplateRef<HTMLElement>('root')

let fileId = ''
/** The version this device currently agrees with — the one there is nothing to restore to. */
let currentVersionId = ''
/** The same, for the row that marks it. */
const currentId = ref('')
let client: V2EngineClient | null = null

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
  if (version.version_id === currentVersionId) return t('streamC.dfec40fafda05e97')
  if (version.op === 'delete') return t('streamC.46d379cc5c2d7232')
  return null
}

const confirmMessage = computed(() => {
  const version = confirming.value
  if (version === null) return ''
  const head = t('streamC.1b3291a51cf7a516', { v1: String(version.no), v2: String(props.path) })
  // A restore is about content, never about where the file lives. Saying so matters most for a
  // version that moved the file: restoring it does not put the file back at the old name.
  const moved = version.op === 'move' || version.path !== props.path
  return moved
    ? t('streamC.60428a25bacbf13f', {
        v1: String(head),
        v2: String(version.path),
        v3: String(props.path),
      })
    : head
})

const whenOf = (version: VersionInfo) =>
  dayjs(new Date(version.mtime ?? Date.parse(version.at)).toISOString())

/**
 * The facts about a version that fit on one faint row: when in its day, who, how big, and its
 * number, which is what the server and the restore question call it by.
 */
const metaOf = (version: VersionInfo): string[] => [
  whenOf(version).format('HH:mm'),
  version.actor.name,
  formatBytes(version.size),
  `#${version.no}`,
]

/** The versions by the day they were written, newest first as the server gives them. */
const days = computed(() => {
  const out: { label: string; versions: VersionInfo[] }[] = []
  const today = dayjs().startOf('day')
  for (const version of versions.value) {
    const day = whenOf(version).startOf('day')
    const label = day.isSame(today)
      ? t('area.today')
      : day.isSame(today.subtract(1, 'day'))
        ? t('area.yesterday')
        : currentLocale().language === 'en'
          ? day.format(day.isSame(today, 'year') ? 'D MMMM' : 'D MMMM YYYY')
          : dateFormatter(currentLocale().format, {
              day: 'numeric',
              month: 'long',
              ...(day.isSame(today, 'year') ? {} : { year: 'numeric' as const }),
            }).format(day.toDate())
    const last = out.at(-1)
    if (last?.label === label) last.versions.push(version)
    else out.push({ label, versions: [version] })
  }
  return out
})

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
  if (client === null) return
  if (selected.value === version.version_id) {
    selected.value = null
    diff.value = []
    previewNote.value = null
    return
  }
  selected.value = version.version_id
  // A file that is not text opens on its Restore alone: two versions of a picture differ, and
  // saying so line by line is a wall of bytes.
  if (!isText.value) {
    diff.value = []
    previewNote.value = null
    return
  }
  diff.value = []
  previewNote.value = t('streamC.27b5182e35b84b22')
  try {
    const bytes = await client.versionBytes(fileId, version.version_id)
    // The answer to a click that has since been overtaken by another one.
    if (selected.value !== version.version_id) return
    const text = asText(bytes)
    if (text === null) {
      previewNote.value = t('streamC.dd9ca06841dd09bc')
      return
    }
    const lines = unifiedDiff(text, await currentText(), {
      from: `${props.path} #${version.no}`,
      to: t('streamC.b9012d040a7ce98e', { v1: String(props.path) }),
    })
    if (selected.value !== version.version_id) return
    if (lines.length === 0) {
      previewNote.value = t('streamC.2904ec9fad440eb3')
      return
    }
    diff.value = lines
    previewNote.value = null
  } catch (failure) {
    previewNote.value = t('streamC.1eadc37538a0e713', { v1: String(reasonOf(failure)) })
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
      error.value = t('streamC.c8f0026c4a577efb', {
        v1: String(version.no),
        v2: String(result.message),
      })
      return
    }
    sync.note(`restored ${props.path} to version #${version.no}`)
    // The commit is on the server; the file on disk is still the old one until the engine
    // fetches it, and there is no reason to make somebody wait for the next trigger.
    await sync.syncNow()
    new Notice(
      restoredNotice(
        sync.status.value.state,
        t('streamC.657a26320c1cc594', { v1: String(result.path), v2: String(version.no) }),
        t('streamC.4337c467c01b5298', { v1: String(result.path), v2: String(version.no) })
      )
    )
    emit('close')
  } catch (failure) {
    error.value = t('streamC.f1b0e977fda31813', {
      v1: String(version.no),
      v2: String(reasonOf(failure)),
    })
  } finally {
    busy.value = false
  }
}

async function loadOlder(): Promise<void> {
  if (client === null || loadingOlder.value || !hasOlder.value) return
  const before = versions.value[versions.value.length - 1]?.no
  if (before === undefined) return
  loadingOlder.value = true
  error.value = null
  try {
    const page = await client.versions(fileId, { limit: PAGE, before })
    const known = new Set(versions.value.map((version) => version.version_id))
    versions.value.push(...page.filter((version) => !known.has(version.version_id)))
    hasOlder.value = page.length === PAGE
  } catch (failure) {
    error.value = t('streamC.1f8edbd020b422bb', { v1: String(reasonOf(failure)) })
  } finally {
    loadingOlder.value = false
  }
}

onMounted(async () => {
  client = sync.client()
  if (client === null) {
    notice.value = t('streamC.b779eecb7545e22d')
    return
  }
  try {
    // Inside the try with the request: the ledger is a database, and a database that will not
    // open would otherwise leave this dialog reading for ever.
    const entry = await sync.entryFor(props.path)
    if (entry === null) {
      notice.value = t('streamC.781271f228aaeffe')
      return
    }
    fileId = entry.fileId
    currentVersionId = entry.versionId
    currentId.value = entry.versionId
    versions.value = await client.versions(fileId, { limit: PAGE })
    hasOlder.value = versions.value.length === PAGE
    notice.value = versions.value.length === 0 ? t('streamC.5f44bebed48101a8') : null
  } catch (failure) {
    notice.value = null
    error.value = t('streamC.2cb6f24d9193bc1f', { v1: String(reasonOf(failure)) })
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
  // Room inside the scroller for a row's light, which hangs past the text edge.
  padding-inline: var(--size-2-3);
  margin-inline: calc(-1 * var(--size-2-3));
}

// The paging control stands under the last row, with room inside the clipping scroller for the
// native button's focus ring.
.abele-version-history__day + .abele-version-history__day {
  margin-top: var(--size-4-3);
}

.abele-version-history__day .abele-group-heading {
  margin-bottom: var(--size-2-2);
}

.abele-version-history__row {
  cursor: var(--cursor);
}

// What an opened row holds: the diff, then the one Restore, at the row's text edge.
.abele-version-history__open {
  cursor: auto;
}

.abele-version-history__restore {
  margin-top: var(--size-4-2);
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
  background-color: var(--abele-code-background);
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
