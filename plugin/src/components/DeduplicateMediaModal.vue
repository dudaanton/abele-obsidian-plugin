<template>
  <ObsidianModal title="Duplicate media" @close="emit('close')">
    <FoundList
      class="abele-dedup"
      icon="copy"
      :state="scanning ? 'working' : scanned && groups.length === 0 ? 'none' : 'list'"
      working-title="Comparing media files"
      :working-text="`${scannedFiles} of ${totalFiles} read`"
      :progress="{ done: scannedFiles, total: totalFiles }"
      none-title="No duplicates"
      none-text="No two media files in the vault hold the same bytes."
      :summary="summary"
      selectable
      :chosen="chosenPending.length"
      :total="pendingGroups.length"
      @select-all="chooseAll(true)"
      @clear="chooseAll(false)"
    >
      <EntryRow
        v-for="(group, gIdx) in groups"
        :key="group.hash + group.files[0].path"
        :more="!!open[gIdx]"
        @update:more="open[gIdx] = $event"
        role="listitem"
        more-label="copies"
        class="abele-dedup__group"
        :class="{ 'abele-dedup__group_done': group.status === 'done' }"
      >
        <template #leading>
          <input
            type="checkbox"
            class="abele-dedup__check"
            :checked="group.status === 'pending' && chosen.has(group.hash)"
            :disabled="group.status !== 'pending'"
            :aria-label="`Merge the copies of ${group.files[0].path}`"
            @change="toggle(group)"
          />
          <FileThumb :kind="group.files[0].mediaType" :src="group.files[0].resourceUrl" />
        </template>
        <span class="abele-dedup__name" :title="group.files[0].path">{{
          nameOf(group.files[0].path)
        }}</span>
        <template #meta>
          <span>{{ group.files.length }} copies</span>
          <span>saves {{ formatSize(group.size * (group.files.length - 1)) }}</span>
        </template>
        <template v-if="group.status !== 'pending'" #codes>
          <ResultMark
            :class="group.status === 'done' ? 'abele-dedup__done' : 'abele-dedup__error'"
            :state="group.status === 'done' ? 'done' : 'error'"
            :text="group.status === 'done' ? 'Merged into the one kept' : group.error"
          />
        </template>
        <template #detail>
          <div v-if="group.status === 'error'" class="abele-dedup__error-text" role="alert">
            {{ group.error }}
          </div>
          <!-- Every copy, the one that stays first: choosing another keeps that one instead. -->
          <div v-show="open[gIdx]" class="abele-dedup__copies" role="radiogroup" :aria-label="'Which copy stays'">
            <div
              v-for="(file, fIdx) in group.files"
              :key="file.path"
              class="abele-dedup__copy"
              :class="{ 'is-active': fIdx === 0 }"
              role="radio"
              :aria-checked="fIdx === 0"
              :tabindex="group.status === 'pending' ? 0 : -1"
              @click="keep(gIdx, fIdx)"
              @keydown.enter.space.prevent="keep(gIdx, fIdx)"
            >
              <span class="abele-dedup__copy-path">{{ file.path }}</span>
              <span class="abele-dedup__copy-meta">
                {{ fIdx === 0 ? 'stays' : `${file.refCount} ${file.refCount === 1 ? 'link' : 'links'}` }}
              </span>
            </div>
          </div>
        </template>
      </EntryRow>
    </FoundList>
    <template #footer>
      <Button
        text="Scan again"
        tooltip="Compare the media files again"
        :disabled="scanning || merging"
        @click="scan"
      />
      <Button
        v-if="pendingGroups.length"
        :text="merging ? 'Merging…' : `Merge ${chosenPending.length} ${chosenPending.length === 1 ? 'group' : 'groups'}`"
        tooltip="Keep one copy of each chosen file and point every link at it"
        accent
        :loading="merging"
        :disabled="merging || chosenPending.length === 0"
        @click="mergeAll"
      />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { ref, computed, reactive } from 'vue'
import { hashMediaBytes } from '@/media/contentHash'
import { TFile } from 'obsidian'
import ObsidianModal from './obsidian/Modal.vue'
import Button from './obsidian/Button.vue'
import EntryRow from './obsidian/EntryRow.vue'
import FileThumb from './obsidian/FileThumb.vue'
import FoundList from './obsidian/FoundList.vue'
import ResultMark from './obsidian/ResultMark.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { vaultUrl } from '@/helpers/vaultUrl'
import { equalMediaBytes, mergeMediaFiles } from '@/helpers/mediaDeduplication'
import { formatBytes as formatSize } from '@/helpers/displayFormat'
import {
  SCAN_MEDIA_EXTENSIONS as MEDIA_EXT,
  scanMediaType as getMediaType,
} from '@/media/extensions'

const emit = defineEmits<{ (e: 'close'): void }>()

const { app } = GlobalStore.getInstance()

interface DupFile {
  path: string
  mediaType: 'image' | 'video' | 'audio' | 'other'
  resourceUrl: string
  refCount: number
}

interface DupGroup {
  hash: string
  size: number
  files: DupFile[]
  status: 'pending' | 'done' | 'error'
  error?: string
}

const groups = ref<DupGroup[]>([])
const scanning = ref(false)
const scanned = ref(false)
const scannedFiles = ref(0)
const totalFiles = ref(0)
const merging = ref(false)

const totalDuplicateSize = computed(() => {
  const bytes = groups.value
    .filter((g) => g.status === 'pending')
    .reduce((s, g) => s + g.size * (g.files.length - 1), 0)
  return formatSize(bytes)
})

// Every group found is chosen at first; one taken out of the choice is left as it is.
const chosen = reactive(new Set<string>())
const open = reactive<boolean[]>([])
const pendingGroups = computed(() => groups.value.filter((g) => g.status === 'pending'))
const chosenPending = computed(() => pendingGroups.value.filter((g) => chosen.has(g.hash)))
const toggle = (group: DupGroup) => {
  if (chosen.has(group.hash)) chosen.delete(group.hash)
  else chosen.add(group.hash)
}
const chooseAll = (on: boolean) => {
  chosen.clear()
  if (on) for (const g of pendingGroups.value) chosen.add(g.hash)
}
const summary = computed(() => {
  const n = groups.value.length
  return `${n} ${n === 1 ? 'file' : 'files'} with copies · ${totalDuplicateSize.value} to save`
})
const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/** The copy at `fIdx` is the one that stays: it moves to the front of its group. */
const keep = (gIdx: number, fIdx: number) => {
  const group = groups.value[gIdx]
  if (group.status !== 'pending' || fIdx === 0) return
  const files = [...group.files]
  const [stays] = files.splice(fIdx, 1)
  groups.value[gIdx] = { ...group, files: [stays, ...files] }
}

/** Count how many notes reference a given file path */
const countRefs = (path: string): number => {
  const allLinks = app.metadataCache.resolvedLinks
  let count = 0
  for (const sourcePath in allLinks) {
    if (allLinks[sourcePath][path]) count++
  }
  return count
}

// ── Scanning ──

const scan = async () => {
  scanning.value = true
  scanned.value = false
  groups.value = []
  scannedFiles.value = 0

  try {
    const allFiles = app.vault
      .getFiles()
      .filter((f) => MEDIA_EXT.includes(f.extension.toLowerCase()))
    totalFiles.value = allFiles.length

    // Hash all media files
    const hashMap = new Map<string, TFile[][]>()
    for (const file of allFiles) {
      try {
        const buf = await app.vault.readBinary(file)
        const h = await hashMediaBytes(buf)
        if (!hashMap.has(h)) hashMap.set(h, [])
        const buckets = hashMap.get(h)!
        let matching: TFile[] | undefined
        for (const bucket of buckets) {
          if (equalMediaBytes(buf, await app.vault.readBinary(bucket[0]))) {
            matching = bucket
            break
          }
        }
        if (matching) matching.push(file)
        else buckets.push([file])
      } catch {
        // skip unreadable
      }
      scannedFiles.value++
    }

    // A short hash only selects candidates. Each bucket has also been compared byte for byte.
    for (const [hash, files] of [...hashMap].flatMap(([hash, buckets]) =>
      buckets.map((files) => [hash, files] as const)
    )) {
      if (files.length < 2) continue

      const dupFiles: DupFile[] = files.map((f) => ({
        path: f.path,
        mediaType: getMediaType(f.extension.toLowerCase()),
        resourceUrl: vaultUrl(app, f),
        refCount: countRefs(f.path),
      }))

      // Sort: most referenced first (that one we keep)
      dupFiles.sort((a, b) => b.refCount - a.refCount)

      groups.value.push({
        hash,
        size: files[0].stat.size,
        files: dupFiles,
        status: 'pending',
      })
    }

    // Sort groups by total wasted size
    groups.value.sort((a, b) => b.size * (b.files.length - 1) - a.size * (a.files.length - 1))
    chooseAll(true)
  } finally {
    scanning.value = false
    scanned.value = true
  }
}

// ── Merging ──

/**
 * Merge a group: keep the first file (most referenced), delete the rest.
 * All references to deleted files are rewritten to point to the kept file.
 */
const mergeGroup = async (gIdx: number) => {
  const group = groups.value[gIdx]
  if (group.status !== 'pending') return

  try {
    const keepPath = group.files[0].path
    const removePaths = group.files.slice(1).map((f) => f.path)

    await mergeMediaFiles(app, keepPath, removePaths)

    groups.value[gIdx] = { ...group, status: 'done' }
  } catch (err: unknown) {
    groups.value[gIdx] = {
      ...group,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

const mergeAll = async () => {
  merging.value = true
  try {
    for (let i = 0; i < groups.value.length; i++) {
      if (groups.value[i].status === 'pending' && chosen.has(groups.value[i].hash)) {
        await mergeGroup(i)
      }
    }
  } finally {
    merging.value = false
  }
}

scan()
</script>

<style lang="scss">
.abele-dedup {
  min-width: min(28em, 100%);
}

.abele-dedup__group_done .abele-entry-row__title,
.abele-dedup__group_done .abele-file-thumb {
  opacity: 0.5;
}

.abele-dedup .abele-dedup__check {
  margin: 0;

  &:disabled {
    visibility: hidden;
  }
}

.abele-dedup__name {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.abele-dedup__error-text {
  color: var(--text-error);
  font-size: var(--font-ui-smaller);
}

// The copies as Obsidian's own list rows under the group: the one that stays lit.
.abele-dedup__copies {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-1);
  margin-inline-start: calc(-1 * var(--size-2-3));
}

.abele-dedup__copy {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--size-4-2);
  padding: var(--size-2-2) var(--size-2-3);
  border-radius: var(--radius-s);
  color: var(--text-muted);
  font-size: var(--font-ui-small);
  cursor: var(--cursor);

  &:hover,
  &:focus-visible {
    background-color: var(--abele-hover-background);
  }

  &.is-active {
    background-color: var(--abele-selected-background);
    color: var(--abele-selected-color);
  }
}

.abele-dedup__copy-path {
  min-width: 0;
  overflow-wrap: anywhere;
}

.abele-dedup__copy-meta {
  flex: none;
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
}
</style>
