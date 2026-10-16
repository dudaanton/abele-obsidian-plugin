<template>
  <ObsidianModal
    title="Excalidraw drawings to canvases"
    phone-sheet
    close-in-footer
    modal-class="abele-excalidraw-migration"
    @close="emit('close')"
  >
    <div class="abele-excalidraw-migration__body">
      <!-- Before: how many, and what will happen to them. Then the window is the report alone. -->
      <p v-if="!running && !report && !failure" class="abele-excalidraw-migration__message">
        {{ question }}
      </p>
      <RunReport
        v-else
        :running="running"
        :finished="!!report || !!failure"
        :percent="percent"
        :status="status"
        :facts="facts"
        :errors="errors"
      >
        <ShortList
          v-if="lost.length"
          heading="Not carried over"
          :items="lost"
          icon="circle-slash"
        />
        <ShortList v-if="results.length" heading="Drawings" :items="results" icon="workflow" />
      </RunReport>
    </div>
    <template #footer>
      <Button
        v-if="report || failure || !drawings.length"
        text="Done"
        tooltip="Close this window"
        accent
        @click="emit('close')"
      />
      <template v-else>
        <Button
          text="Cancel"
          tooltip="Close this and change nothing"
          :disabled="running"
          @click="emit('close')"
        />
        <Button
          :text="`Migrate ${drawingsWord}`"
          tooltip="Make a canvas beside each drawing; the drawings stay as they are"
          accent
          :loading="running"
          :disabled="running"
          @click="start"
        />
      </template>
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
/**
 * Every Excalidraw drawing in the vault made into a canvas: asks first with how many there are,
 * shows where it is while it works, then says what came of it — the counts, what failed and why,
 * what of the drawings the canvases could not carry, and the canvases made.
 */
import { computed, ref } from 'vue'
import ObsidianModal from './obsidian/Modal.vue'
import Button from './obsidian/Button.vue'
import RunReport from './obsidian/RunReport.vue'
import ShortList from './obsidian/ShortList.vue'
import type { MigrationReport } from '@/canvas/excalidraw/migrate'

const props = defineProps<{
  /** The drawings found, by path. */
  drawings: string[]
  run: (onProgress: (done: number, total: number) => void) => Promise<MigrationReport>
  /** A report to show straight away, without asking: for the design catalogue and tests. */
  initialReport?: MigrationReport
}>()
const emit = defineEmits<{ (e: 'close'): void }>()

const running = ref(false)
const failure = ref('')
const done = ref(0)
const report = ref<MigrationReport | null>(props.initialReport ?? null)

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const drawingsWord = computed(() => plural(props.drawings.length, 'drawing', 'drawings'))
const question = computed(() =>
  props.drawings.length
    ? `${drawingsWord.value} found in this vault. Each gets a new canvas beside it; the drawings themselves are not changed. Links and embeds in referring notes and canvases are updated. Drawings that already have a canvas are skipped.`
    : 'No Excalidraw drawings were found in this vault.'
)
const percent = computed(() =>
  props.drawings.length ? Math.round((done.value / props.drawings.length) * 100) : 0
)
const status = computed(() =>
  failure.value
    ? 'Migration stopped'
    : report.value
      ? report.value.failed
        ? `Migrated ${report.value.migrated} of ${report.value.files.length}`
        : 'Migration complete'
      : `Migrating · ${done.value} of ${props.drawings.length}`
)
const facts = computed(() =>
  report.value
    ? [
        { label: 'Migrated', value: report.value.migrated },
        { label: 'Skipped', value: report.value.skipped },
        { label: 'Failed', value: report.value.failed },
        {
          label: 'References rewritten',
          value: report.value.files.reduce(
            (total, file) => total + (file.references?.rewritten ?? 0),
            0
          ),
        },
      ].filter((f) => f.value || f.label === 'Migrated')
    : []
)
const name = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const folder = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
const errors = computed(() =>
  failure.value
    ? [failure.value]
    : (report.value?.files ?? [])
        .filter((f) => f.status === 'failed')
        .map((f) => `${name(f.source)}: ${f.reason ?? 'failed'}`)
        .concat(
          (report.value?.files ?? []).flatMap((f) =>
            (f.references?.files ?? [])
              .filter((file) => file.error)
              .map((file) => `${file.path}: ${file.error}`)
          )
        )
)
/** Each kind of loss once, with how many items of it and in how many drawings. */
const lost = computed(() => {
  const kinds = new Map<string, { count: number; files: number }>()
  for (const file of report.value?.files ?? [])
    for (const loss of file.losses) {
      const k = kinds.get(loss.what) ?? { count: 0, files: 0 }
      kinds.set(loss.what, { count: k.count + loss.count, files: k.files + 1 })
    }
  return [...kinds]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([title, k]) => ({
      title,
      meta: `${k.count} in ${plural(k.files, 'drawing', 'drawings')}`,
    }))
})
const results = computed(() =>
  (report.value?.files ?? []).map((f) => ({
    title: name(f.source),
    meta: [
      folder(f.source),
      f.status,
      f.target,
      f.losses.map((loss) => `${loss.what} ×${loss.count}`).join('; '),
      f.reason,
      f.references ? `${f.references.rewritten} references rewritten` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  }))
)

async function start(): Promise<void> {
  running.value = true
  try {
    report.value = await props.run((n) => (done.value = n))
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error)
    console.debug('[Abele] Excalidraw migration stopped', error)
  } finally {
    running.value = false
  }
}
</script>

<style lang="scss">
.abele-excalidraw-migration__message {
  margin: 0;
}

.abele-excalidraw-migration__body {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);
}
</style>
