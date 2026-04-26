<template>
  <ObsidianModal title="Import Files" @close="emit('close')">
    <div class="abele-import-files">
      <div
        class="abele-import-files__drop"
        :class="{ 'abele-import-files__drop--active': dragging }"
        @dragover.prevent="dragging = true"
        @dragleave="dragging = false"
        @drop.prevent="onDrop"
        @click="fileInputEl?.click()"
      >
        <Icon icon="upload" no-hover class="abele-import-files__drop-icon" />
        <span>Drop files here or click to browse</span>
      </div>

      <input
        ref="fileInputEl"
        type="file"
        multiple
        style="display: none"
        @change="onFileSelected"
      />

      <div v-if="files.length" class="abele-import-files__list">
        <div v-for="(f, i) in files" :key="i" class="abele-import-files__item">
          <Icon :icon="f.done ? 'check' : f.error ? 'alert-triangle' : 'file'" />
          <span class="abele-import-files__name">{{ f.name }}</span>
          <span v-if="f.done" class="abele-import-files__status abele-import-files__status--done"
            >saved</span
          >
          <span
            v-else-if="f.error"
            class="abele-import-files__status abele-import-files__status--error"
            >{{ f.error }}</span
          >
          <span v-else-if="f.importing" class="abele-import-files__status">importing...</span>
        </div>
      </div>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Notice } from 'obsidian'
import ObsidianModal from './obsidian/Modal.vue'
import Icon from './obsidian/Icon.vue'
import { importExternalFile } from '@/ai/attachments'

const emit = defineEmits<{ (e: 'close'): void }>()

interface FileEntry {
  name: string
  file: File
  importing: boolean
  done: boolean
  error?: string
}

const fileInputEl = ref<HTMLInputElement | null>(null)
const files = ref<FileEntry[]>([])
const dragging = ref(false)

const importFiles = async (fileList: File[]) => {
  const entries: FileEntry[] = fileList.map((f) => ({
    name: f.name,
    file: f,
    importing: false,
    done: false,
  }))
  files.value = [...files.value, ...entries]

  let saved = 0
  for (const entry of entries) {
    entry.importing = true
    files.value = [...files.value]
    try {
      await importExternalFile(entry.file)
      entry.done = true
      saved++
    } catch (err: unknown) {
      entry.error = err instanceof Error ? err.message : String(err)
    }
    entry.importing = false
    files.value = [...files.value]
  }
  if (saved > 0) {
    new Notice(`${saved} file${saved > 1 ? 's' : ''} imported to Attachments`)
  }
}

const onFileSelected = (e: Event) => {
  const input = e.target as HTMLInputElement
  const fileList = input.files ? Array.from(input.files) : []
  input.value = ''
  if (fileList.length) importFiles(fileList)
}

const onDrop = (e: DragEvent) => {
  dragging.value = false
  const fileList = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : []
  if (fileList.length) importFiles(fileList)
}
</script>

<style lang="scss">
.abele-import-files {
  min-width: min(400px, 100%);
}

.abele-import-files__drop {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--size-4-2);
  padding: var(--size-4-6) var(--size-4-4);
  border: 2px dashed var(--background-modifier-border);
  border-radius: var(--radius-m);
  cursor: pointer;
  color: var(--text-muted);
  transition:
    border-color 0.15s,
    background-color 0.15s;

  &:hover,
  &--active {
    border-color: var(--interactive-accent);
    background-color: var(--background-secondary);
  }
}

.abele-import-files__drop-icon svg {
  width: 32px;
  height: 32px;
  stroke-width: 1.5;
}

.abele-import-files__list {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-1);
  margin-top: var(--size-4-3);
  max-height: 300px;
  overflow-y: auto;
}

.abele-import-files__item {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  padding: var(--size-2-2) var(--size-4-2);
  border-radius: var(--radius-s);
  font-size: var(--font-small);
}

.abele-import-files__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.abele-import-files__status {
  flex-shrink: 0;
  font-size: var(--font-smaller);
  color: var(--text-muted);

  &--done {
    color: var(--color-green);
  }

  &--error {
    color: var(--text-error);
  }
}
</style>
