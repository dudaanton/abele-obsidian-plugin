<template>
  <ObsidianModal title="Unused media" @close="emit('close')">
    <FoundList
      class="abele-unused-media"
      icon="image"
      :state="state"
      working-title="Looking for media nothing links to"
      :working-text="`${totalFiles} files in the vault`"
      :progress="{ done: scannedFiles, total: totalFiles }"
      none-title="Nothing to clean up"
      none-text="Every picture, video and sound is linked from a note, a chat or a canvas."
      error-title="Could not finish looking"
      :error-text="scanError"
      :summary="summary"
      selectable
      :chosen="chosenPending.length"
      :total="pendingCount"
      @select-all="chooseAll(true)"
      @clear="chooseAll(false)"
    >
      <EntryRow
        v-for="item in items"
        :key="item.path"
        role="listitem"
        class="abele-unused-media__item"
        :class="{ 'abele-unused-media__item_deleted': item.status === 'deleted' }"
        @click="item.status === 'pending' && toggle(item)"
      >
        <template #leading>
          <input
            type="checkbox"
            class="abele-unused-media__check"
            :checked="item.status === 'pending' && chosen.has(item.path)"
            :disabled="item.status !== 'pending'"
            :aria-label="`Choose ${item.path}`"
            @click.stop
            @change="toggle(item)"
          />
          <FileThumb :kind="item.mediaType" :src="item.resourceUrl" />
        </template>
        <span class="abele-unused-media__path" :title="item.path">{{ nameOf(item.path) }}</span>
        <template #meta>
          <span v-if="folderOf(item.path)">{{ folderOf(item.path) }}</span>
          <span>{{ formatSize(item.size) }}</span>
        </template>
        <template v-if="item.status !== 'pending'" #codes>
          <ResultMark
            :state="item.status === 'deleted' ? 'done' : 'error'"
            :text="item.status === 'deleted' ? 'Moved to the trash' : item.error"
          />
        </template>
        <template v-if="item.status === 'error'" #detail>
          <div class="abele-unused-media__error" role="alert">{{ item.error }}</div>
        </template>
      </EntryRow>
    </FoundList>
    <template #footer>
      <Button
        text="Scan again"
        tooltip="Look through the vault again"
        :disabled="scanning || deleting"
        @click="scan"
      />
      <Button
        v-if="pendingCount"
        :text="deleting ? 'Moving to the trash…' : `Move ${chosenPending.length} to the trash`"
        :tooltip="'Move the chosen files to the trash; they can be taken back from there'"
        warning
        :loading="deleting"
        :disabled="deleting || chosenPending.length === 0"
        @click="askToDelete"
      />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { ref, computed, reactive } from 'vue'
import { TFile } from 'obsidian'
import ObsidianModal from './obsidian/Modal.vue'
import Button from './obsidian/Button.vue'
import EntryRow from './obsidian/EntryRow.vue'
import FileThumb from './obsidian/FileThumb.vue'
import FoundList from './obsidian/FoundList.vue'
import ResultMark from './obsidian/ResultMark.vue'
import { confirmAction } from '@/modal/confirm'
import { GlobalStore } from '@/stores/GlobalStore'
import { vaultUrl } from '@/helpers/vaultUrl'
import { collectMediaReferences } from '@/helpers/mediaReferences'
import { formatBytes as formatSize } from '@/helpers/displayFormat'
import {
  SCAN_MEDIA_EXTENSIONS as MEDIA_EXT,
  scanMediaType as getMediaType,
} from '@/media/extensions'

const emit = defineEmits<{ (e: 'close'): void }>()

const { app } = GlobalStore.getInstance()

interface MediaFileItem {
  path: string
  size: number
  mediaType: 'image' | 'video' | 'audio' | 'other'
  resourceUrl: string
  status: 'pending' | 'deleted' | 'error'
  error?: string
}

const items = ref<MediaFileItem[]>([])
const scanning = ref(false)
const scanned = ref(false)
const scanError = ref('')
const scannedFiles = ref(0)
const totalFiles = ref(0)
const deleting = ref(false)

const pendingCount = computed(() => items.value.filter((i) => i.status === 'pending').length)
const deletedCount = computed(() => items.value.filter((i) => i.status === 'deleted').length)

// Every file found is chosen at first; taking one out of the choice keeps it.
const chosen = reactive(new Set<string>())
const chosenPending = computed(() =>
  items.value.filter((i) => i.status === 'pending' && chosen.has(i.path))
)
const toggle = (item: MediaFileItem) => {
  if (chosen.has(item.path)) chosen.delete(item.path)
  else chosen.add(item.path)
}
const chooseAll = (on: boolean) => {
  chosen.clear()
  if (on) for (const i of items.value) if (i.status === 'pending') chosen.add(i.path)
}

const state = computed(() =>
  scanning.value
    ? 'working'
    : scanError.value
      ? 'error'
      : scanned.value && items.value.length === 0
        ? 'none'
        : 'list'
)
const summary = computed(() => {
  const size = chosenPending.value.reduce((s, i) => s + i.size, 0)
  const parts = [`${items.value.length} ${items.value.length === 1 ? 'file' : 'files'}`]
  if (size) parts.push(formatSize(size))
  if (deletedCount.value) parts.push(`${deletedCount.value} in the trash`)
  return parts.join(' · ')
})
const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const folderOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')))

// ── Scanning ──

const scan = async () => {
  scanning.value = true
  scanned.value = false
  scanError.value = ''
  items.value = []
  scannedFiles.value = 0

  try {
    totalFiles.value = app.vault.getFiles().length
    const referenced = await collectMediaReferences(app)
    scannedFiles.value = totalFiles.value

    // 3. Find unreferenced media files
    const allFiles = app.vault.getFiles()
    for (const file of allFiles) {
      const ext = file.extension.toLowerCase()
      if (!MEDIA_EXT.includes(ext)) continue
      if (referenced.has(file.path)) continue

      items.value.push({
        path: file.path,
        size: file.stat.size,
        mediaType: getMediaType(ext),
        resourceUrl: vaultUrl(app, file),
        status: 'pending',
      })
    }

    // Sort by size descending
    items.value.sort((a, b) => b.size - a.size)
    chooseAll(true)
  } catch (err: unknown) {
    items.value = []
    scanError.value = `Scan failed; nothing will be deleted: ${err instanceof Error ? err.message : String(err)}`
  } finally {
    scanning.value = false
    scanned.value = true
  }
}

// ── Deleting ──

const deleteOne = async (item: MediaFileItem) => {
  const file = app.vault.getAbstractFileByPath(item.path)
  if (!(file instanceof TFile)) return

  try {
    if ((await collectMediaReferences(app)).has(file.path)) {
      throw new Error('File is now referenced. Scan again before deleting.')
    }
    await app.fileManager.trashFile(file)
    const idx = items.value.indexOf(item)
    if (idx !== -1) items.value[idx] = { ...item, status: 'deleted' }
  } catch (err: unknown) {
    const idx = items.value.indexOf(item)
    if (idx !== -1)
      items.value[idx] = {
        ...item,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      }
  }
}

const deleteAll = async () => {
  deleting.value = true
  try {
    for (const item of [...chosenPending.value]) await deleteOne(item)
  } finally {
    deleting.value = false
  }
}

const askToDelete = async () => {
  const n = chosenPending.value.length
  const yes = await confirmAction(app, {
    title: 'Move to the trash?',
    message: `${n} ${n === 1 ? 'file' : 'files'} nothing links to will go to the trash. They can be taken back from there.`,
    confirmText: 'Move to the trash',
    confirmTooltip: 'Move the chosen files to the trash',
  })
  if (yes) await deleteAll()
}

scan()
</script>

<style lang="scss">
.abele-unused-media {
  min-width: min(28em, 100%);
}

.abele-unused-media__item {
  cursor: var(--cursor);

  &:hover {
    background-color: var(--background-modifier-hover);
  }

  &_deleted .abele-entry-row__title,
  &_deleted .abele-file-thumb {
    opacity: 0.5;
  }
}

.abele-unused-media .abele-unused-media__check {
  margin: 0;

  // Done with or failed: nothing left to choose, but the row keeps its column.
  &:disabled {
    visibility: hidden;
  }
}

.abele-unused-media__path {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.abele-unused-media__error {
  color: var(--text-error);
  font-size: var(--font-ui-smaller);
}
</style>
