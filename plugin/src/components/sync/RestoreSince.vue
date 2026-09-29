<template>
  <div ref="root" class="abele-restore-since">
    <Setting name="Restore all deleted since" :desc="preview">
      <Dropdown :options="PRESETS" :model-value="preset" @update:model-value="choose" />
      <Input
        v-if="preset === 'custom'"
        date-time
        :model-value="custom"
        :disabled="busy"
        @update:model-value="custom = $event"
        @commit="custom = $event"
      />
      <Button
        :text="busy ? progress : `Restore ${picked.length}…`"
        accent
        :disabled="busy || picked.length === 0"
        :tooltip="
          picked.length === 0
            ? 'Nothing was deleted since then'
            : 'Bring back every file deleted since then, on every device'
        "
        @click="ask"
      />
    </Setting>
    <p v-if="error !== null" class="abele-restore-since__error">{{ error }}</p>

    <ConfirmModal
      v-if="confirming"
      :title="`Restore ${filesOf(asked.length)}?`"
      :message="question"
      confirm-text="Restore"
      confirm-tooltip="Bring these files back, on every device"
      cancel-tooltip="Close this and restore nothing"
      @confirm="restore"
      @close="confirming = false"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * Bringing back everything deleted since a moment (phase 3b, decision 8): the way back from a
 * mass delete that was confirmed, or that happened on a device with no guard.
 *
 * The files are picked by `deleted_at`, the time the server recorded each delete — not by
 * anything a device noted — so a delete made on a device whose clock is wrong is still placed
 * where it happened. Only the moment picked here is this device's clock.
 *
 * How many is said before anything happens; the question names the count, the first files and
 * which devices deleted them. The restore goes in batches of a thousand, each one commit the
 * other devices receive as one batch, and what comes back is counted: a file whose old path was
 * taken meanwhile comes back beside it under the next free name, and one no longer in the trash
 * (restored meanwhile, or swept) does not come back at all.
 */
import { computed, ref, useTemplateRef } from 'vue'
import { Notice } from 'obsidian'
import { TRASH_RESTORE_MAX, type CommitOpResult, type TrashItem } from '@abele/sync-protocol'
import Setting from '../obsidian/Setting.vue'
import Dropdown from '../obsidian/Dropdown.vue'
import Input from '../obsidian/Input.vue'
import Button from '../obsidian/Button.vue'
import ConfirmModal from '../obsidian/ConfirmModal.vue'
import { SyncService } from '@/sync/SyncService'
import { reasonOf } from '@/sync/format'
import { RestoreKeys } from '@/sync/restoreKeys'
import type { LocalStorage } from '@/sync/ledgerId'
import { GlobalStore } from '@/stores/GlobalStore'

type Preset = 'hour' | 'today' | 'custom'

const PRESETS: { value: Preset; display: string }[] = [
  { value: 'hour', display: 'the last hour' },
  { value: 'today', display: 'today' },
  { value: 'custom', display: 'a time I choose' },
]

/** How many paths the question names; the rest are counted. */
const NAMED = 5

const props = defineProps<{ items: TrashItem[] }>()

const emit = defineEmits<{
  /** These files are out of the trash now — back, or gone from it meanwhile. */
  (e: 'restored', fileIds: string[]): void
}>()

const sync = SyncService.getInstance()
const root = useTemplateRef<HTMLElement>('root')

const preset = ref<Preset>('hour')
/** The moment the presets are counted from, taken when one is chosen. */
const now = ref(Date.now())
const custom = ref(localInput(Date.now() - 60 * 60 * 1000))
const busy = ref(false)
const progress = ref('Restoring…')
const confirming = ref(false)
const error = ref<string | null>(null)
/** The files the question was asked about, fixed when it was asked. */
const asked = ref<TrashItem[]>([])

/** A moment as a date-time field holds it: `YYYY-MM-DDTHH:mm`, on this device's clock. */
function localInput(ms: number): string {
  const d = new Date(ms)
  const two = (n: number): string => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}` +
    `T${two(d.getHours())}:${two(d.getMinutes())}`
  )
}

function choose(value: string): void {
  preset.value = value as Preset
  now.value = Date.now()
}

/** The moment picked, in milliseconds, or null for a time that does not read. */
const cutoff = computed((): number | null => {
  if (preset.value === 'hour') return now.value - 60 * 60 * 1000
  if (preset.value === 'today') {
    const midnight = new Date(now.value)
    midnight.setHours(0, 0, 0, 0)
    return midnight.getTime()
  }
  const at = new Date(custom.value).getTime()
  return Number.isNaN(at) ? null : at
})

const picked = computed(() => {
  const from = cutoff.value
  if (from === null) return []
  return props.items.filter((one) => Date.parse(one.deleted_at) >= from)
})

const filesOf = (count: number): string => (count === 1 ? '1 file' : `${count} files`)

const preview = computed(() => {
  if (cutoff.value === null) return 'Give a date and a time.'
  const count = picked.value.length
  if (count === 0) return 'Nothing was deleted since then.'
  return `${filesOf(count)} deleted since then, going by when the server recorded each delete.`
})

/** `310 by MacBook, 2 by Phone`: who deleted what, most first. */
function byWhom(items: TrashItem[]): string {
  const counts = new Map<string, number>()
  for (const one of items) {
    const name = one.deleted_by?.name ?? 'a device not named'
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${count} by ${name}`)
    .join(', ')
}

const question = computed(() => {
  const items = asked.value
  const names = items.slice(0, NAMED).map((one) => one.path)
  const rest = items.length - names.length
  const list = rest > 0 ? `${names.join(', ')} and ${rest} more` : names.join(', ')
  return (
    `They come back where they were, on every device: ${list}. Deleted ${byWhom(items)}. ` +
    'A file whose place was taken meanwhile comes back beside it under a new name.'
  )
})

/**
 * Ask about the files picked now; the question and the restore keep to exactly those. A preset
 * counts from this moment, not from when it was chosen: "the last hour" of a dialog left open
 * is the hour before Restore is pressed.
 */
function ask(): void {
  if (preset.value !== 'custom') now.value = Date.now()
  asked.value = [...picked.value]
  if (asked.value.length > 0) confirming.value = true
}

/** The vault's local storage, where the batch keys outlive this dialog; none in a bare test. */
function localStorageOf(): LocalStorage | null {
  const app = GlobalStore.getInstance().app as Partial<LocalStorage> | undefined
  return typeof app?.loadLocalStorage === 'function' && typeof app.saveLocalStorage === 'function'
    ? (app as LocalStorage)
    : null
}

/** A key for one restore, from the element's own window: see `DeletedFilesModal`. */
const idempotencyKey = (): string => (root.value?.win ?? window).crypto.randomUUID()

/**
 * The key each batch went out under, by the files in it, kept in the vault's local storage until
 * a restore gets through (`restoreKeys.ts`), so a retry after the dialog was closed — or Obsidian
 * restarted — sends a batch whose answer was lost under the key it first had, and the server
 * answers with what it did then rather than `not_found` (task-10 review, #5; pi review #8).
 * Keyed by the exact files of a batch: a retry after more deletes reached the trash cuts the
 * batches differently, and a batch whose answer was lost is then counted as failed though its
 * files are back — the common retry, with nothing new and at most one batch, is not affected.
 */
const batchKeys = new RestoreKeys(localStorageOf(), sync.connection.value.vaultId, idempotencyKey)

const keyOf = (ids: string[]): string => batchKeys.keyOf(ids)

/**
 * What the summary says of the results. Restored: back where it was. Renamed: back under a new
 * name, its old one being taken. Failed: not back — a refusal, or a file no longer in the trash.
 */
function tally(items: TrashItem[], results: CommitOpResult[]) {
  let restored = 0
  let renamed = 0
  let failed = 0
  results.forEach((result, at) => {
    if (result.status !== 'applied') failed++
    else if (result.path !== items[at]?.path) renamed++
    else restored++
  })
  return { restored: restored + renamed, renamed, failed }
}

async function restore(): Promise<void> {
  const client = sync.client()
  const items = asked.value
  if (client === null || busy.value || items.length === 0) return
  busy.value = true
  error.value = null
  const results: CommitOpResult[] = []
  try {
    for (let at = 0; at < items.length; at += TRASH_RESTORE_MAX) {
      progress.value = `Restoring… ${at} of ${items.length}`
      const ids = items.slice(at, at + TRASH_RESTORE_MAX).map((one) => one.file_id)
      results.push(...(await client.restoreDeletedMany(ids, keyOf(ids))))
    }
  } catch (failure) {
    error.value =
      `Restoring stopped after ${results.length} of ${items.length}: ${reasonOf(failure)}. ` +
      'What came back is on the server; the list shows the rest.'
    if (results.length > 0) {
      emit('restored', gone(items, results))
      // What came back is on the server; a pull puts it here now rather than at the next poll.
      await sync.syncNow()
    }
    busy.value = false
    return
  }
  batchKeys.clear()
  const { restored, renamed, failed } = tally(items, results)
  sync.note(
    `restored ${restored} file(s) deleted since ${new Date(cutoff.value ?? 0).toISOString()}`
  )
  // The files are back on the server; a pull is what puts them back here.
  await sync.syncNow()
  const summary =
    `Restored ${restored}; ${renamed} came back under a new name because the old one was ` +
    `taken; ${failed} failed.`
  const state = sync.status.value.state
  new Notice(
    state === 'paused'
      ? `${summary} They reach this device when sync is resumed.`
      : state === 'offline' || state === 'error'
        ? `${summary} They reach this device at the next sync that gets through.`
        : summary
  )
  emit('restored', gone(items, results))
  busy.value = false
}

/** The files out of the trash now: back, or no longer there to restore. */
function gone(items: TrashItem[], results: CommitOpResult[]): string[] {
  return results.flatMap((result, at) =>
    result.status === 'applied' || result.code === 'not_found' ? [items[at].file_id] : []
  )
}
</script>

<style lang="scss">
// The generic dropdown offsets its focus-ring padding with negative margins. Inside the
// dialog's full-width setting column that margin crosses the row's right edge by 4px.
.abele-restore-since .abele-obsidian-dropdown {
  box-sizing: border-box;
  margin-inline: 0;
}

.abele-restore-since__error {
  margin: 0;
  color: var(--text-error);
  font-size: var(--font-ui-small);
  overflow-wrap: anywhere;
}
</style>
