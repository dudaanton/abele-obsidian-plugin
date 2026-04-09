<template>
  <ObsidianModal title="Save Remote Media" @close="emit('close')">
    <div class="abele-save-media">
      <AiScopeEditor
        :entries="scopeEntries"
        :full-vault-access="fullVaultAccess"
        @update:entries="scopeEntries = $event"
        @update:full-vault-access="fullVaultAccess = $event"
      />

      <!-- Frontmatter properties to check -->
      <div class="abele-save-media__props">
        <div class="abele-scope-mgr__label">Frontmatter properties</div>
        <div class="abele-save-media__props-list">
          <span v-for="(prop, idx) in mediaProps" :key="prop" class="abele-save-media__prop-chip">
            {{ prop }}
            <Icon icon="x" @click="mediaProps.splice(idx, 1)" />
          </span>
        </div>
        <div class="abele-save-media__props-add">
          <input
            type="text"
            :value="newProp"
            placeholder="Add property..."
            @input="newProp = ($event.target as HTMLInputElement).value"
            @keydown.enter="addProp"
          />
          <Button text="Add" @click="addProp" />
        </div>
      </div>

      <div class="abele-save-media__actions">
        <Button text="Scan" :disabled="scanning" @click="scan" />
        <Button
          v-if="items.length > 0"
          :text="downloadingAll ? `Downloading ${downloadProgress}...` : 'Download All'"
          :disabled="downloadingAll || allDone"
          @click="downloadAll"
        />
      </div>

      <div v-if="scanning" class="abele-save-media__status">
        Scanning... ({{ scannedFiles }}/{{ totalFiles }} files)
      </div>

      <div v-if="!scanning && scanned && items.length === 0" class="abele-save-media__status">
        No remote media found.
      </div>

      <template v-if="items.length > 0">
        <div class="abele-save-media__toolbar">
          <span class="abele-save-media__count">
            {{ items.length }} media in {{ fileCount }} files
            <template v-if="doneCount"> · {{ doneCount }} saved</template>
          </span>
        </div>

        <div class="abele-save-media__list">
          <template v-for="(group, filePath) in groupedItems" :key="filePath">
            <div class="abele-save-media__file-header">{{ filePath }}</div>
            <div
              v-for="item in group"
              :key="item.url + item.filePath"
              class="abele-save-media__item"
            >
              <div class="abele-save-media__item-url">{{ item.url }}</div>
              <div class="abele-save-media__item-info">
                <span class="abele-save-media__item-type">{{ item.type }}</span>
                <span v-if="item.status === 'done'" class="abele-save-media__item-done">saved</span>
                <span v-else-if="item.status === 'error'" class="abele-save-media__item-error">{{
                  item.error
                }}</span>
                <span
                  v-else-if="item.status === 'downloading'"
                  class="abele-save-media__item-loading"
                  >downloading...</span
                >
                <Button v-else text="Download" @click="downloadItem(item)" />
              </div>
            </div>
          </template>
        </div>
      </template>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { TFile, TFolder, requestUrl } from 'obsidian'
import ObsidianModal from './obsidian/Modal.vue'
import Button from './obsidian/Button.vue'
import Icon from './obsidian/Icon.vue'
import AiScopeEditor from './AiScopeEditor.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import type { ScopeEntry } from '@/ai/ScopeResolver'

const emit = defineEmits<{ (e: 'close'): void }>()

const { app } = GlobalStore.getInstance()

// ── Scope ──

const scopeEntries = ref<ScopeEntry[]>([])
const fullVaultAccess = ref(true)
const mediaProps = ref(['cover', 'thumbnail', 'image', 'banner', 'poster'])
const newProp = ref('')

const addProp = () => {
  const p = newProp.value.trim().toLowerCase()
  if (p && !mediaProps.value.includes(p)) {
    mediaProps.value.push(p)
  }
  newProp.value = ''
}

// ── State ──

interface MediaItem {
  url: string
  type: string
  matchFull: string
  filePath: string
  status: 'pending' | 'downloading' | 'done' | 'error'
  error?: string
  savedPath?: string
}

const items = ref<MediaItem[]>([])
const scanning = ref(false)
const scanned = ref(false)
const scannedFiles = ref(0)
const totalFiles = ref(0)
const downloadingAll = ref(false)

const allDone = computed(
  () => items.value.length > 0 && items.value.every((i) => i.status === 'done')
)
const doneCount = computed(() => items.value.filter((i) => i.status === 'done').length)
const fileCount = computed(() => new Set(items.value.map((i) => i.filePath)).size)
const downloadProgress = computed(() => `${doneCount.value}/${items.value.length}`)

const groupedItems = computed(() => {
  const map: Record<string, MediaItem[]> = {}
  for (const item of items.value) {
    if (!map[item.filePath]) map[item.filePath] = []
    map[item.filePath].push(item)
  }
  return map
})

// ── Scanning ──

const STATIC_PATTERNS: Array<{ regex: RegExp; type: string }> = [
  { regex: /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g, type: 'image' },
  { regex: /<img[^>]+src=["'](https?:\/\/[^"'\s]+)["'][^>]*>/gi, type: 'image' },
  { regex: /<(?:video|source)[^>]+src=["'](https?:\/\/[^"'\s]+)["'][^>]*>/gi, type: 'video' },
  { regex: /<audio[^>]+src=["'](https?:\/\/[^"'\s]+)["'][^>]*>/gi, type: 'audio' },
]

const getMediaPatterns = (): Array<{ regex: RegExp; type: string }> => {
  const patterns = [...STATIC_PATTERNS]
  for (const prop of mediaProps.value) {
    const escaped = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    patterns.push({
      regex: new RegExp(`^${escaped}:\\s*["']?(https?:\\/\\/[^\\s"']+)["']?`, 'gm'),
      type: 'property',
    })
  }
  return patterns
}

const patternToRegex = (pat: string): RegExp => {
  const escaped = pat
    .replace(/[.+^${}()|[\]\\?]/g, '\\$&')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/{{GLOBSTAR}}/g, '.*')
  return new RegExp(`^${escaped}$`, 'i')
}

const resolveFolder = (folderPath: string, result: Set<string>) => {
  const folder = app.vault.getAbstractFileByPath(folderPath)
  if (!(folder instanceof TFolder)) return
  for (const child of folder.children) {
    if (child instanceof TFile && child.extension === 'md') {
      result.add(child.path)
    } else if (child instanceof TFolder) {
      resolveFolder(child.path, result)
    }
  }
}

const getFilesToScan = (): TFile[] => {
  if (fullVaultAccess.value) {
    return app.vault.getMarkdownFiles()
  }

  const paths = new Set<string>()
  for (const entry of scopeEntries.value) {
    switch (entry.type) {
      case 'file': {
        const f = app.vault.getAbstractFileByPath(entry.path)
        if (f instanceof TFile) paths.add(f.path)
        break
      }
      case 'folder':
        resolveFolder(entry.path, paths)
        break
      case 'pattern': {
        const re = patternToRegex(entry.path)
        for (const f of app.vault.getMarkdownFiles()) {
          if (re.test(f.path)) paths.add(f.path)
        }
        break
      }
    }
  }

  return [...paths]
    .map((p) => app.vault.getAbstractFileByPath(p))
    .filter((f): f is TFile => f instanceof TFile)
}

const scanFile = async (file: TFile, seen: Set<string>): Promise<MediaItem[]> => {
  const content = await app.vault.read(file)
  const found: MediaItem[] = []

  for (const { regex, type } of getMediaPatterns()) {
    regex.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(content)) !== null) {
      const url = match[1]
      const key = `${file.path}::${url}`
      if (seen.has(key)) continue
      seen.add(key)
      found.push({
        url,
        type,
        matchFull: match[0],
        filePath: file.path,
        status: 'pending',
      })
    }
  }

  return found
}

const scan = async () => {
  scanning.value = true
  scanned.value = false
  items.value = []
  scannedFiles.value = 0

  try {
    const files = getFilesToScan()
    totalFiles.value = files.length
    const seen = new Set<string>()

    for (const file of files) {
      const found = await scanFile(file, seen)
      if (found.length) {
        items.value = [...items.value, ...found]
      }
      scannedFiles.value++
    }
  } finally {
    scanning.value = false
    scanned.value = true
  }
}

// ── Downloading ──

const getAttachmentFolder = async (): Promise<string> => {
  let folder = (app.vault as any).getConfig?.('attachmentFolderPath') || 'Attachments'
  if (folder === '/' || folder === '.') folder = ''
  if (folder && !app.vault.getAbstractFileByPath(folder)) {
    await app.vault.createFolder(folder)
  }
  return folder
}

/** Hash an ArrayBuffer for content dedup (simple FNV-1a 32-bit) */
const hashBuffer = (buf: ArrayBuffer): string => {
  const bytes = new Uint8Array(buf)
  let h = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/** Build content hash index of existing attachment files */
const attachmentHashIndex = new Map<string, string>() // hash → vault path
let hashIndexBuilt = false

const buildHashIndex = async () => {
  if (hashIndexBuilt) return
  const folder = await getAttachmentFolder()
  const allFiles = app.vault.getFiles()
  for (const f of allFiles) {
    if (folder && !f.path.startsWith(folder + '/')) continue
    if (f.extension === 'md') continue
    try {
      const buf = await app.vault.readBinary(f)
      const h = hashBuffer(buf)
      attachmentHashIndex.set(h, f.path)
    } catch {
      // skip unreadable files
    }
  }
  hashIndexBuilt = true
}

/** Generate a short hash from a string */
const hashStr = (s: string): string => {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0
  }
  return Math.abs(h).toString(36)
}

const urlToFilename = (url: string): string => {
  const hash = hashStr(url)
  try {
    const pathname = new URL(url).pathname
    const raw = pathname.split('/').pop() || ''
    const withoutExt = raw
      .split('?')[0]
      .split('#')[0]
      .replace(/\.[^.]+$/, '')
    const clean = withoutExt.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)
    return clean ? `${clean}-${hash}` : hash
  } catch {
    return hash
  }
}

const ensureExtension = (name: string, contentType: string): string => {
  if (/\.\w{2,5}$/.test(name)) return name
  const extMap: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'audio/mpeg': '.mp3',
    'audio/ogg': '.ogg',
  }
  const ext = extMap[contentType] || ''
  return ext ? `${name}${ext}` : name
}

const getAvailablePath = (basePath: string): string => {
  let targetPath = basePath
  let counter = 1
  while (app.vault.getAbstractFileByPath(targetPath)) {
    const dot = basePath.lastIndexOf('.')
    const name = dot > 0 ? basePath.slice(0, dot) : basePath
    const ext = dot > 0 ? basePath.slice(dot) : ''
    targetPath = `${name} ${counter}${ext}`
    counter++
  }
  return targetPath
}

// URL → local path cache (persists within this modal session)
const downloadedUrls = new Map<string, string>()

const downloadItem = async (item: MediaItem) => {
  if (item.status === 'done' || item.status === 'downloading') return

  const idx = items.value.indexOf(item)
  if (idx === -1) return

  items.value[idx] = { ...item, status: 'downloading' }

  try {
    await buildHashIndex()

    // 1. URL already downloaded this session?
    let localPath = downloadedUrls.get(item.url)

    if (!localPath) {
      // 2. Download the file
      const response = await requestUrl({ url: item.url, method: 'GET', throw: false })
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP ${response.status}`)
      }

      const contentHash = hashBuffer(response.arrayBuffer)

      // 3. Content already exists in attachments?
      const existingByHash = attachmentHashIndex.get(contentHash)
      if (existingByHash) {
        localPath = existingByHash
      } else {
        // 4. Save new file
        const contentType = response.headers['content-type'] || ''
        const folder = await getAttachmentFolder()
        const filename = urlToFilename(item.url)
        const finalName = ensureExtension(filename, contentType.split(';')[0].trim())
        const basePath = folder ? `${folder}/${finalName}` : finalName
        localPath = getAvailablePath(basePath)

        await app.vault.createBinary(localPath, response.arrayBuffer)
        attachmentHashIndex.set(contentHash, localPath)
      }

      downloadedUrls.set(item.url, localPath)
    }

    // Replace URL in all files that reference it
    const filesToUpdate = new Set<string>()
    for (const i of items.value) {
      if (i.url === item.url) filesToUpdate.add(i.filePath)
    }
    for (const fp of filesToUpdate) {
      await replaceAllInNote(fp, item.url, localPath)
    }

    // Mark all items with the same URL across all files as done
    items.value = items.value.map((i) =>
      i.url === item.url && i.status !== 'done'
        ? { ...i, status: 'done' as const, savedPath: localPath }
        : i
    )
  } catch (err: unknown) {
    items.value[idx] = {
      ...item,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Replace ALL occurrences of a URL in a note — handles markdown images,
 * HTML attributes, and frontmatter properties in one pass.
 */
const replaceAllInNote = async (filePath: string, url: string, localPath: string) => {
  const file = app.vault.getAbstractFileByPath(filePath)
  if (!(file instanceof TFile)) return

  const content = await app.vault.read(file)
  const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  // Replace markdown images: ![...](url) → ![[localPath]]
  let updated = content.replace(
    new RegExp(`!\\[[^\\]]*\\]\\(${escapedUrl}\\)`, 'g'),
    `![[${localPath}]]`
  )

  // Replace remaining occurrences of the URL (HTML tags, frontmatter, etc.)
  updated = updated.replaceAll(url, localPath)

  if (updated !== content) {
    await app.vault.modify(file, updated)
  }
}

const downloadAll = async () => {
  downloadingAll.value = true
  try {
    for (const item of items.value) {
      if (item.status === 'pending') {
        await downloadItem(item)
      }
    }
  } finally {
    downloadingAll.value = false
  }
}
</script>

<style lang="scss">
.abele-save-media {
  min-width: 450px;
}

.abele-save-media__props {
  margin-top: var(--size-4-2);
}

.abele-save-media__props-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-2-2);
  margin: var(--size-4-1) 0;
}

.abele-save-media__prop-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--size-2-1);
  padding: var(--size-2-1) var(--size-2-3);
  background-color: var(--background-secondary);
  border-radius: var(--radius-s);
  font-size: var(--font-smaller);
  color: var(--text-normal);

  .clickable-icon {
    cursor: pointer;
    color: var(--text-faint);
    &:hover {
      color: var(--text-muted);
    }
  }
}

.abele-save-media__props-add {
  display: flex;
  gap: var(--size-4-1);

  input {
    flex: 1;
  }
}

.abele-save-media__actions {
  display: flex;
  gap: var(--size-4-2);
  margin: var(--size-4-2) 0;
}

.abele-save-media__toolbar {
  margin-bottom: var(--size-4-2);
}

.abele-save-media__count {
  font-size: var(--font-small);
  color: var(--text-muted);
}

.abele-save-media__status {
  color: var(--text-muted);
  font-size: var(--font-small);
  padding: var(--size-4-2) 0;
}

.abele-save-media__list {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-1);
  max-height: 400px;
  overflow-y: auto;
}

.abele-save-media__file-header {
  font-size: var(--font-small);
  font-weight: 600;
  color: var(--text-normal);
  padding: var(--size-4-1) 0 var(--size-2-1);
  border-bottom: 1px solid var(--background-modifier-border);

  &:not(:first-child) {
    margin-top: var(--size-4-1);
  }
}

.abele-save-media__item {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-1);
  padding: var(--size-2-1) var(--size-4-2);
  border-radius: var(--radius-s);

  &:hover {
    background-color: var(--background-secondary);
  }
}

.abele-save-media__item-url {
  font-size: var(--font-smaller);
  font-family: var(--font-monospace);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
}

.abele-save-media__item-info {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
}

.abele-save-media__item-type {
  font-size: var(--font-smaller);
  color: var(--text-faint);
}

.abele-save-media__item-done {
  font-size: var(--font-smaller);
  color: var(--color-green);
}

.abele-save-media__item-error {
  font-size: var(--font-smaller);
  color: var(--text-error);
}

.abele-save-media__item-loading {
  font-size: var(--font-smaller);
  color: var(--text-accent);
}
</style>
