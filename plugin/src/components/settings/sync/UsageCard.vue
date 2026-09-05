<template>
  <Section
    title="What the vault holds"
    desc="Measured on the server, across every device. Live files, the versions behind them, and what has been deleted but not yet swept."
  >
    <EmptyState v-if="usage === null" :text="error ?? 'Reading what the vault holds…'" />

    <template v-else>
      <Setting name="Live files" desc="The current version of everything in the vault.">
        <Badge :text="formatBytes(usage.live_bytes)" accent />
      </Setting>

      <Setting name="History" desc="Every earlier version the retention policy still keeps.">
        <Badge :text="formatBytes(usage.history_bytes)" />
      </Setting>

      <Setting name="Trash" desc="Deleted files, still restorable until they are swept.">
        <Badge :text="formatBytes(usage.trash_bytes)" />
      </Setting>

      <Setting name="Quota" :desc="quotaDesc">
        <Badge :text="usage.quota_bytes === null ? 'None set' : formatBytes(usage.quota_bytes)" />
      </Setting>

      <Setting
        v-for="kind in kinds"
        :key="kind.key"
        :name="kind.name"
        :desc="`${kind.count} ${kind.count === 1 ? 'file' : 'files'}.`"
        :data-usage-kind="kind.key"
      >
        <Badge :text="formatBytes(kind.bytes)" />
      </Setting>

      <Section
        v-if="top.length > 0"
        title="The heaviest histories"
        desc="Files whose earlier versions take the most room. Trimming what a note keeps starts here."
      >
        <CardGrid wide>
          <Card
            v-for="file in top"
            :key="file.file_id"
            :title="file.path"
            :meta="[formatBytes(file.history_bytes), `${file.versions} versions`]"
          />
        </CardGrid>
      </Section>
    </template>
  </Section>
</template>

<script setup lang="ts">
/**
 * How much room the vault takes on the server, and where it goes.
 *
 * Read once when the screen opens rather than watched: this is a report on a whole vault, not
 * a live figure, and asking the server for it on every status tick would cost a round trip a
 * second to tell somebody something that changes by the megabyte.
 *
 * There is no "clear history" here. Trimming a file's versions is a server operation and the
 * server has no route for it yet, so rather than a button that cannot work the screen names
 * the files worth trimming and leaves it at that.
 */
import { computed, onMounted, ref } from 'vue'
import type { FileKind, Usage } from '@abele/sync-protocol'
import Section from '../../obsidian/Section.vue'
import Setting from '../../obsidian/Setting.vue'
import Badge from '../../obsidian/Badge.vue'
import Card from '../../obsidian/Card.vue'
import CardGrid from '../../obsidian/CardGrid.vue'
import EmptyState from '../../obsidian/EmptyState.vue'
import { SyncService } from '@/sync/SyncService'
import { formatBytes } from '@/helpers/reduceImage'
import { reasonOf } from '@/sync/format'

/** One of the heaviest histories, as `GET /usage` names them. */
interface TopFile {
  file_id: string
  path: string
  history_bytes: number
  versions: number
}

/** What each kind is called on a screen, and the order they are worth reading in. */
const KIND_LABELS: Record<FileKind, string> = {
  note: 'Notes',
  canvas: 'Canvases',
  attachment: 'Attachments',
  script: 'Scripts',
  settings: 'Obsidian settings',
}

const KIND_ORDER: FileKind[] = ['note', 'canvas', 'attachment', 'script', 'settings']

const usage = ref<Usage | null>(null)
const top = ref<TopFile[]>([])
const error = ref<string | null>(null)

const quotaDesc = computed(() => {
  const quota = usage.value?.quota_bytes
  if (quota === undefined || quota === null) return 'This vault has no limit set on the server.'
  const used = usage.value?.live_bytes ?? 0
  return `${Math.round((used / Math.max(quota, 1)) * 100)}% of it is in live files.`
})

/** The kinds this vault actually holds, heaviest first; a kind with nothing in it says nothing. */
const kinds = computed(() =>
  KIND_ORDER.flatMap((key) => {
    const held = usage.value?.by_kind?.[key]
    if (held === undefined) return []
    return [{ key, name: KIND_LABELS[key], bytes: held.live_bytes, count: held.count }]
  })
)

/**
 * The report's `top` as this screen reads it.
 *
 * The client types it `unknown[]`: the server names the heaviest histories, but their shape is
 * not part of the protocol, so it is checked here rather than trusted. Anything unrecognisable
 * is left out instead of drawn as a blank card.
 */
function topFilesOf(entries: unknown[]): TopFile[] {
  return entries.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return []
    const file = entry as Record<string, unknown>
    if (typeof file.file_id !== 'string' || typeof file.path !== 'string') return []
    return [
      {
        file_id: file.file_id,
        path: file.path,
        history_bytes: typeof file.history_bytes === 'number' ? file.history_bytes : 0,
        versions: typeof file.versions === 'number' ? file.versions : 0,
      },
    ]
  })
}

onMounted(async () => {
  const client = SyncService.getInstance().client()
  if (client === null) {
    error.value = 'What the vault holds is on the server, and this device is not connected to one.'
    return
  }
  try {
    const report = await client.usage()
    usage.value = report
    top.value = topFilesOf(report.top)
  } catch (failure) {
    error.value = `What the vault holds could not be read: ${reasonOf(failure)}`
  }
})
</script>
