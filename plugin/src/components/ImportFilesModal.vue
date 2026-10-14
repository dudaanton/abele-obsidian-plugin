<template>
  <ObsidianModal title="Import files" @close="emit('close')">
    <div class="abele-import-files">
      <!-- Where files are dropped: a dashed place with what it takes, and a button for a phone,
           which cannot drag. -->
      <div
        class="abele-import-files__drop"
        :class="{ 'abele-import-files__drop_active': dragging }"
        @dragover.prevent="dragging = true"
        @dragleave="dragging = false"
        @drop.prevent="onDrop"
      >
        <Icon icon="upload" :interactive="false" class="abele-import-files__drop-icon" />
        <span v-if="!phone" class="abele-import-files__drop-text">Drop files here</span>
        <Button
          text="Choose files"
          tooltip="Pick files on this device to copy into the vault"
          @click="fileInputEl?.click()"
        />
        <span class="abele-import-files__drop-hint">They go to {{ folder || 'the vault' }}</span>
      </div>

      <input
        ref="fileInputEl"
        type="file"
        multiple
        class="abele-import-files__input"
        @change="onFileSelected"
      />

      <div v-if="files.length" class="abele-import-files__list" role="list">
        <EntryRow v-for="(f, i) in files" :key="i" role="listitem" class="abele-import-files__item">
          <template #leading>
            <FileThumb :kind="kindOf(f.name)" :src="f.preview" />
          </template>
          <span class="abele-import-files__name">{{ f.name }}</span>
          <template #meta>
            <span>{{ f.savedPath ? folderOf(f.savedPath) : folder }}</span>
            <span>{{ formatBytes(f.size) }}</span>
          </template>
          <template v-if="f.importing || f.done || f.error" #codes>
            <ResultMark
              :state="f.importing ? 'working' : f.done ? 'done' : 'error'"
              :text="f.importing ? 'Copying' : f.done ? `Saved as ${f.savedPath}` : f.error"
            />
          </template>
          <template v-if="f.error" #detail>
            <div class="abele-import-files__error" role="alert">{{ f.error }}</div>
          </template>
        </EntryRow>
      </div>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import { Notice, Platform } from 'obsidian'
import ObsidianModal from './obsidian/Modal.vue'
import Button from './obsidian/Button.vue'
import EntryRow from './obsidian/EntryRow.vue'
import FileThumb from './obsidian/FileThumb.vue'
import Icon from './obsidian/Icon.vue'
import ResultMark from './obsidian/ResultMark.vue'
import { importExternalFile } from '@/ai/attachments'
import { formatBytes } from '@/helpers/displayFormat'
import { configuredAttachmentFolder } from '@/media/attachmentFolder'
import { scanMediaType } from '@/media/extensions'
import { GlobalStore } from '@/stores/GlobalStore'

const emit = defineEmits<{ (e: 'close'): void }>()

interface FileEntry {
  name: string
  file: File
  size: number
  /** A picture of an image file while the window is open. */
  preview?: string
  importing: boolean
  done: boolean
  savedPath?: string
  error?: string
}

const phone = Platform.isPhone
const fileInputEl = ref<HTMLInputElement | null>(null)
const files = ref<FileEntry[]>([])
const dragging = ref(false)

/** Where Obsidian puts new attachments, as its own setting says. */
const folder = ref(configuredAttachmentFolder(GlobalStore.getInstance().app))

const kindOf = (name: string) => {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  return name.includes('.') ? scanMediaType(ext) : 'other'
}

const folderOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')))

const previews: string[] = []
onUnmounted(() => previews.forEach((url) => URL.revokeObjectURL(url)))

const importFiles = async (fileList: File[]) => {
  const entries: FileEntry[] = fileList.map((f) => {
    let preview: string | undefined
    if (kindOf(f.name) === 'image' && typeof URL.createObjectURL === 'function') {
      preview = URL.createObjectURL(f)
      previews.push(preview)
    }
    return { name: f.name, file: f, size: f.size, preview, importing: false, done: false }
  })
  files.value = [...files.value, ...entries]

  let saved = 0
  for (const entry of entries) {
    entry.importing = true
    files.value = [...files.value]
    try {
      const file = await importExternalFile(entry.file)
      entry.savedPath = file.path
      entry.done = true
      saved++
    } catch (err: unknown) {
      entry.error = err instanceof Error ? err.message : String(err)
    }
    entry.importing = false
    files.value = [...files.value]
  }
  if (saved > 0) {
    new Notice(`${saved} file${saved > 1 ? 's' : ''} imported to ${folder.value || 'the vault'}`)
  }
}

const onFileSelected = (e: Event) => {
  const input = e.target as HTMLInputElement
  const fileList = input.files ? Array.from(input.files) : []
  input.value = ''
  if (fileList.length) void importFiles(fileList)
}

const onDrop = (e: DragEvent) => {
  dragging.value = false
  const fileList = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : []
  if (fileList.length) void importFiles(fileList)
}
</script>

<style lang="scss">
.abele-import-files {
  min-width: min(28em, 100%);
}

.abele-import-files__drop {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--size-4-2);
  padding: var(--size-4-6) var(--size-4-4);
  border: 1px dashed var(--background-modifier-border-hover);
  border-radius: var(--radius-m);
  color: var(--text-muted);
  text-align: center;

  &_active {
    border-color: var(--interactive-accent);
    background-color: var(--abele-selected-background);
  }
}

.abele-import-files__drop-icon {
  color: var(--text-faint);

  svg {
    width: var(--icon-l);
    height: var(--icon-l);
  }
}

.abele-import-files__drop-hint {
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
}

.abele-import-files__input {
  display: none;
}

.abele-import-files__list {
  display: flex;
  flex-direction: column;
  margin-top: var(--size-4-3);
}

.abele-import-files__name {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.abele-import-files__error {
  color: var(--text-error);
  font-size: var(--font-ui-smaller);
}
</style>
