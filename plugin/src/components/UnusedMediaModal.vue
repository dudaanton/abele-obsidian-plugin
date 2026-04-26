<template>
  <ObsidianModal title="Unused Media" @close="emit('close')">
    <div class="abele-unused-media">
      <div class="abele-unused-media__actions">
        <Button text="Scan" :disabled="scanning" @click="scan" />
        <Button
          v-if="items.length > 0"
          :text="deleting ? 'Deleting...' : `Delete All (${pendingCount})`"
          :disabled="deleting || pendingCount === 0"
          @click="deleteAll"
        />
      </div>

      <div v-if="scanning" class="abele-unused-media__status">
        Scanning... ({{ scannedFiles }}/{{ totalFiles }} files)
      </div>

      <div v-if="!scanning && scanned && items.length === 0" class="abele-unused-media__status">
        No unused media found.
      </div>

      <template v-if="items.length > 0">
        <div class="abele-unused-media__count">
          {{ items.length }} unused media
          <template v-if="deletedCount"> · {{ deletedCount }} deleted</template>
          <template v-if="totalSize"> · {{ formatSize(totalSize) }}</template>
        </div>

        <div class="abele-unused-media__list">
          <div
            v-for="item in items"
            :key="item.path"
            class="abele-unused-media__item"
            :class="{ 'abele-unused-media__item_deleted': item.status === 'deleted' }"
          >
            <!-- Preview -->
            <div class="abele-unused-media__preview">
              <img
                v-if="item.mediaType === 'image'"
                :src="item.resourceUrl"
                class="abele-unused-media__thumb"
              />
              <video
                v-else-if="item.mediaType === 'video'"
                :src="item.resourceUrl"
                class="abele-unused-media__thumb"
                muted
                preload="metadata"
              />
              <div v-else-if="item.mediaType === 'audio'" class="abele-unused-media__audio-icon">
                <Icon icon="music" />
              </div>
              <div v-else class="abele-unused-media__audio-icon">
                <Icon icon="file" />
              </div>
            </div>

            <div class="abele-unused-media__details">
              <div class="abele-unused-media__path">{{ item.path }}</div>
              <div class="abele-unused-media__meta">
                <span>{{ formatSize(item.size) }}</span>
                <span v-if="item.status === 'deleted'" class="abele-unused-media__deleted-label"
                  >deleted</span
                >
                <span v-else-if="item.status === 'error'" class="abele-unused-media__error">{{
                  item.error
                }}</span>
                <Button v-else text="Delete" @click="deleteOne(item)" />
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { TFile } from 'obsidian'
import ObsidianModal from './obsidian/Modal.vue'
import Button from './obsidian/Button.vue'
import Icon from './obsidian/Icon.vue'
import { GlobalStore } from '@/stores/GlobalStore'

const emit = defineEmits<{ (e: 'close'): void }>()

const { app } = GlobalStore.getInstance()

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico']
const VIDEO_EXT = ['mp4', 'webm', 'ogv', 'mov', 'mkv']
const AUDIO_EXT = ['mp3', 'ogg', 'wav', 'flac', 'aac', 'm4a']
const MEDIA_EXT = [...IMAGE_EXT, ...VIDEO_EXT, ...AUDIO_EXT, 'pdf']

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
const scannedFiles = ref(0)
const totalFiles = ref(0)
const deleting = ref(false)

const pendingCount = computed(() => items.value.filter((i) => i.status === 'pending').length)
const deletedCount = computed(() => items.value.filter((i) => i.status === 'deleted').length)
const totalSize = computed(() =>
  items.value.filter((i) => i.status === 'pending').reduce((s, i) => s + i.size, 0)
)

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const getMediaType = (ext: string): 'image' | 'video' | 'audio' | 'other' => {
  if (IMAGE_EXT.includes(ext)) return 'image'
  if (VIDEO_EXT.includes(ext)) return 'video'
  if (AUDIO_EXT.includes(ext)) return 'audio'
  return 'other'
}

// ── Scanning ──

const scan = async () => {
  scanning.value = true
  scanned.value = false
  items.value = []
  scannedFiles.value = 0

  try {
    // Collect all referenced file paths
    const referenced = new Set<string>()

    // 1. Obsidian's resolved links (wikilinks, markdown links)
    const allLinks = app.metadataCache.resolvedLinks
    for (const sourcePath in allLinks) {
      for (const targetPath in allLinks[sourcePath]) {
        referenced.add(targetPath)
      }
    }

    // 2. Scan all markdown files for URLs/paths in HTML tags and frontmatter
    const mdFiles = app.vault.getMarkdownFiles()
    totalFiles.value = mdFiles.length

    const htmlRefRegex = /(?:src|poster|href)=["']([^"']+)["']/gi
    const frontmatterMediaRegex =
      /^(?:cover|thumbnail|image|banner|poster):\s*["']?([^\s"']+)["']?/gm

    for (const file of mdFiles) {
      const content = await app.vault.cachedRead(file)

      // HTML attributes
      htmlRefRegex.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = htmlRefRegex.exec(content)) !== null) {
        const ref = match[1]
        if (!ref.startsWith('http')) {
          // Resolve as vault path
          const resolved = app.metadataCache.getFirstLinkpathDest(ref, file.path)
          if (resolved) referenced.add(resolved.path)
          else referenced.add(ref)
        }
      }

      // Frontmatter media properties
      frontmatterMediaRegex.lastIndex = 0
      while ((match = frontmatterMediaRegex.exec(content)) !== null) {
        const ref = match[1]
        if (!ref.startsWith('http')) {
          const resolved = app.metadataCache.getFirstLinkpathDest(ref, file.path)
          if (resolved) referenced.add(resolved.path)
          else referenced.add(ref)
        }
      }

      scannedFiles.value++
    }

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
        resourceUrl: app.vault.getResourcePath(file),
        status: 'pending',
      })
    }

    // Sort by size descending
    items.value.sort((a, b) => b.size - a.size)
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
    await app.vault.trash(file, false)
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
    for (const item of items.value) {
      if (item.status === 'pending') {
        await deleteOne(item)
      }
    }
  } finally {
    deleting.value = false
  }
}

scan()
</script>

<style lang="scss">
.abele-unused-media {
  min-width: min(450px, 100%);
}

.abele-unused-media__actions {
  display: flex;
  gap: var(--size-4-2);
  margin-bottom: var(--size-4-2);
}

.abele-unused-media__status {
  color: var(--text-muted);
  font-size: var(--font-small);
  padding: var(--size-4-2) 0;
}

.abele-unused-media__count {
  font-size: var(--font-small);
  color: var(--text-muted);
  margin-bottom: var(--size-4-2);
}

.abele-unused-media__list {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
  max-height: 450px;
  overflow-y: auto;
}

.abele-unused-media__item {
  display: flex;
  gap: var(--size-4-2);
  padding: var(--size-4-1) var(--size-4-2);
  border-radius: var(--radius-s);

  &:hover {
    background-color: var(--background-secondary);
  }

  &_deleted {
    opacity: 0.4;
  }
}

.abele-unused-media__preview {
  flex-shrink: 0;
  width: 60px;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-s);
  overflow: hidden;
  background-color: var(--background-secondary);
}

.abele-unused-media__thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.abele-unused-media__audio-icon {
  color: var(--text-faint);
}

.abele-unused-media__details {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--size-2-1);
}

.abele-unused-media__path {
  font-size: var(--font-small);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.abele-unused-media__meta {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  font-size: var(--font-smaller);
  color: var(--text-faint);
}

.abele-unused-media__deleted-label {
  color: var(--text-faint);
}

.abele-unused-media__error {
  color: var(--text-error);
}
</style>
