<template>
  <div ref="root" class="abele-restore-since">
    <Setting :name="t('streamC.f83f455a5e01def4')" :desc="preview">
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
        :text="
          busy
            ? progress
            : picked.length
              ? t('streamC.c427630e171e8231', { v1: String(picked.length) })
              : t('streamC.a76e13b9839270eb')
        "
        :disabled="busy || picked.length === 0"
        :tooltip="
          picked.length === 0 ? t('streamC.e0af0bba41478fd8') : t('streamC.0e2dc9528f18865c')
        "
        @click="ask"
      />
    </Setting>
    <p v-if="error !== null" class="abele-restore-since__error">{{ error }}</p>

    <ConfirmModal
      v-if="confirming"
      :title="t('streamC.8fb5dd7374a932dc', { v1: String(filesOf(asked.length)) })"
      :message="question"
      :confirm-text="t('streamC.a76e13b9839270eb')"
      :confirm-tooltip="t('streamC.a2db04ee689cd83e')"
      :cancel-tooltip="t('streamC.941bbcc0fabee37a')"
      @confirm="restore"
      @close="confirming = false"
    />
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'

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
import { TRASH_RESTORE_MAX, type CommitOpResult, type TrashItem } from '@abele/sync-sdk/protocol'
import Setting from '../obsidian/Setting.vue'
import Dropdown from '../obsidian/Dropdown.vue'
import Input from '../obsidian/Input.vue'
import Button from '../obsidian/Button.vue'
import ConfirmModal from '../obsidian/ConfirmModal.vue'
import { tokenHistory } from '@/sync/tokenHistory'
import { reasonOf } from '@/sync/format'
import { RestoreKeys } from '@/sync/restoreKeys'
import type { LocalStorage } from '@/sync/ledgerId'
import { GlobalStore } from '@/stores/GlobalStore'

type Preset = 'hour' | 'today' | 'custom'

const PRESETS: { value: Preset; display: string }[] = [
  { value: 'hour', display: t('streamC.69fed412165fb960') },
  { value: 'today', display: t('streamC.e0f4f767ac88a930') },
  { value: 'custom', display: t('streamC.f329145399987d0f') },
]

/** How many paths the question names; the rest are counted. */
const NAMED = 5

const props = defineProps<{ items: TrashItem[] }>()

const emit = defineEmits<{
  /** These files are out of the trash now — back, or gone from it meanwhile. */
  (e: 'restored', fileIds: string[]): void
}>()

const sync = tokenHistory()
const root = useTemplateRef<HTMLElement>('root')

const preset = ref<Preset>('hour')
/** The moment the presets are counted from, taken when one is chosen. */
const now = ref(Date.now())
const custom = ref(localInput(Date.now() - 60 * 60 * 1000))
const busy = ref(false)
const progress = ref(t('streamC.5a4918e0201c877c'))
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

const filesOf = (count: number): string => t('streamC.files', { count: count })

const preview = computed(() => {
  if (cutoff.value === null) return t('streamC.818a1e91e5ff0885')
  const count = picked.value.length
  if (count === 0) return t('streamC.25df34de860b321c')
  return t('streamC.2ec6ee28e1c8a0f7', { v1: String(filesOf(count)) })
})

/** `310 by MacBook, 2 by Phone`: who deleted what, most first. */
function byWhom(items: TrashItem[]): string {
  const counts = new Map<string, number>()
  for (const one of items) {
    const name = one.deleted_by?.name ?? t('streamC.8dfdcc7aa13f0c43')
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => t('streamC.40c235a259c24219', { v1: String(count), v2: String(name) }))
    .join(', ')
}

const question = computed(() => {
  const items = asked.value
  const names = items.slice(0, NAMED).map((one) => one.path)
  const rest = items.length - names.length
  const list =
    rest > 0
      ? t('streamC.07d587805a0f6780', { v1: String(names.join(', ')), v2: String(rest) })
      : names.join(', ')
  return t('streamC.1f4be59fa130ef44', { v1: list, v2: byWhom(items) })
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
      progress.value = t('streamC.1a415e759c80f3bc', { v1: String(at), v2: String(items.length) })
      const ids = items.slice(at, at + TRASH_RESTORE_MAX).map((one) => one.file_id)
      results.push(...(await client.restoreDeletedMany(ids, keyOf(ids))))
    }
  } catch (failure) {
    error.value = t('streamC.0c4f6ab39ffe220c', {
      v1: results.length,
      v2: items.length,
      v3: reasonOf(failure),
    })
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
  const summary = t('streamC.86b087f0e635342a', { v1: restored, v2: renamed, v3: failed })
  const state = sync.status.value.state
  new Notice(
    state === 'paused'
      ? t('streamC.dde0f92cc68c6d75', { v1: String(summary) })
      : state === 'offline' || state === 'error'
        ? t('streamC.4aafe656d9968dce', { v1: String(summary) })
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
// A step under the window's words, as one setting stands from the text above it.
.abele-restore-since {
  margin-top: var(--size-4-3);
}

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
