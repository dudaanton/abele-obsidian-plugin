<template>
  <ObsidianModal title="Deduplicate Media" @close="emit('close')">
    <div class="abele-dedup">
      <div class="abele-dedup__actions">
        <Button text="Scan" :disabled="scanning" @click="scan" />
        <Button
          v-if="groups.length > 0"
          :text="merging ? 'Merging...' : `Merge All (${groups.length} groups)`"
          :disabled="merging || groups.length === 0"
          @click="mergeAll"
        />
      </div>

      <div v-if="scanning" class="abele-dedup__status">
        Hashing... ({{ scannedFiles }}/{{ totalFiles }} files)
      </div>

      <div v-if="!scanning && scanned && groups.length === 0" class="abele-dedup__status">
        No duplicates found.
      </div>

      <div v-if="groups.length > 0" class="abele-dedup__count">
        {{ groups.length }} duplicate groups · {{ totalDuplicateSize }}
      </div>

      <div v-if="groups.length > 0" class="abele-dedup__list">
        <div v-for="(group, gIdx) in groups" :key="gIdx" class="abele-dedup__group">
          <div class="abele-dedup__group-header">
            <span>{{ group.files.length }} files · {{ formatSize(group.size) }} each</span>
            <Button v-if="group.status === 'pending'" text="Merge" @click="mergeGroup(gIdx)" />
            <span v-else-if="group.status === 'done'" class="abele-dedup__done">merged</span>
            <span v-else-if="group.status === 'error'" class="abele-dedup__error">{{
              group.error
            }}</span>
          </div>

          <div class="abele-dedup__side-by-side">
            <div
              v-for="(file, fIdx) in group.files"
              :key="file.path"
              class="abele-dedup__file"
              :class="{
                'abele-dedup__file_keep': fIdx === 0,
                'abele-dedup__file_remove': fIdx > 0 && group.status === 'done',
              }"
            >
              <div class="abele-dedup__preview">
                <img
                  v-if="file.mediaType === 'image'"
                  :src="file.resourceUrl"
                  class="abele-dedup__thumb"
                />
                <video
                  v-else-if="file.mediaType === 'video'"
                  :src="file.resourceUrl"
                  class="abele-dedup__thumb"
                  muted
                  preload="metadata"
                />
                <div v-else class="abele-dedup__icon">
                  <Icon :icon="file.mediaType === 'audio' ? 'music' : 'file'" />
                </div>
              </div>
              <div class="abele-dedup__file-path">{{ file.path }}</div>
              <div class="abele-dedup__file-refs">{{ file.refCount }} refs</div>
              <div v-if="fIdx === 0" class="abele-dedup__keep-badge">keep</div>
            </div>
          </div>
        </div>
      </div>
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

const hashBuffer = (buf: ArrayBuffer): string => {
  const bytes = new Uint8Array(buf)
  let h = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
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
    const hashMap = new Map<string, TFile[]>()
    for (const file of allFiles) {
      try {
        const buf = await app.vault.readBinary(file)
        const h = hashBuffer(buf)
        if (!hashMap.has(h)) hashMap.set(h, [])
        hashMap.get(h)!.push(file)
      } catch {
        // skip unreadable
      }
      scannedFiles.value++
    }

    // Build groups for hashes with >1 file
    for (const [hash, files] of hashMap) {
      if (files.length < 2) continue

      const dupFiles: DupFile[] = files.map((f) => ({
        path: f.path,
        mediaType: getMediaType(f.extension.toLowerCase()),
        resourceUrl: app.vault.getResourcePath(f),
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

    // Rewrite all references in all notes
    const mdFiles = app.vault.getMarkdownFiles()
    for (const mdFile of mdFiles) {
      let content = await app.vault.cachedRead(mdFile)
      let changed = false

      for (const removePath of removePaths) {
        if (content.includes(removePath)) {
          content = content.replaceAll(removePath, keepPath)
          changed = true
        }
        // Also check basename (wikilinks use basenames)
        const removeName = removePath
          .split('/')
          .pop()!
          .replace(/\.[^.]+$/, '')
        const keepName = keepPath
          .split('/')
          .pop()!
          .replace(/\.[^.]+$/, '')
        if (removeName !== keepName && content.includes(removeName)) {
          // Only replace wikilink-style references: [[name]] or ![[name]]
          const escaped = removeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const wikiRe = new RegExp(`(\\[\\[)${escaped}(\\]\\])`, 'g')
          const newContent = content.replace(wikiRe, `$1${keepName}$2`)
          if (newContent !== content) {
            content = newContent
            changed = true
          }
        }
      }

      if (changed) {
        await app.vault.modify(mdFile, content)
      }
    }

    // Delete duplicate files
    for (const removePath of removePaths) {
      const file = app.vault.getAbstractFileByPath(removePath)
      if (file instanceof TFile) {
        await app.fileManager.trashFile(file)
      }
    }

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
      if (groups.value[i].status === 'pending') {
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
  min-width: min(500px, 100%);
}

.abele-dedup__actions {
  display: flex;
  gap: var(--size-4-2);
  margin-bottom: var(--size-4-2);
}

.abele-dedup__status {
  color: var(--text-muted);
  font-size: var(--font-small);
  padding: var(--size-4-2) 0;
}

.abele-dedup__count {
  font-size: var(--font-small);
  color: var(--text-muted);
  margin-bottom: var(--size-4-2);
}

.abele-dedup__list {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);
  max-height: 450px;
  overflow-y: auto;
}

.abele-dedup__group {
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s);
  padding: var(--size-4-2);
}

.abele-dedup__group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--font-small);
  color: var(--text-muted);
  margin-bottom: var(--size-4-2);
}

.abele-dedup__done {
  color: var(--color-green);
  font-size: var(--font-smaller);
}

.abele-dedup__error {
  color: var(--text-error);
  font-size: var(--font-smaller);
}

.abele-dedup__side-by-side {
  display: flex;
  gap: var(--size-4-2);
  overflow-x: auto;
}

.abele-dedup__file {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--size-2-1);
  min-width: 120px;
  max-width: 160px;
  padding: var(--size-4-1);
  border-radius: var(--radius-s);
  position: relative;

  &_keep {
    background-color: rgba(var(--color-green-rgb), 0.08);
  }

  &_remove {
    opacity: 0.3;
  }
}

.abele-dedup__preview {
  width: 100px;
  height: 100px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-s);
  overflow: hidden;
  background-color: var(--background-secondary);
}

.abele-dedup__thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.abele-dedup__icon {
  color: var(--text-faint);
}

.abele-dedup__file-path {
  font-size: var(--font-smaller);
  color: var(--text-muted);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
}

.abele-dedup__file-refs {
  font-size: var(--font-smaller);
  color: var(--text-faint);
}

.abele-dedup__keep-badge {
  position: absolute;
  top: var(--size-2-1);
  right: var(--size-2-1);
  font-size: 10px;
  padding: 1px var(--size-2-1);
  background-color: var(--color-green);
  color: var(--background-primary);
  border-radius: var(--radius-s);
  font-weight: 600;
}
</style>
