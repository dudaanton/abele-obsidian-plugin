<template>
  <ObsidianModal :title="title" size="full" @close="close">
    <div class="abele-gallery-viewer" @click.self="close">
      <!-- Where in the gallery, and the file's size and date: one quiet line under the title. -->
      <div class="abele-gallery-viewer__info">{{ facts }}</div>

      <template v-if="images.length > 1">
        <ObsidianIcon
          icon="chevron-left"
          tooltip="Previous picture (←)"
          class="abele-gallery-viewer__nav abele-gallery-viewer__nav--prev"
          @click.stop="prev"
          @mousedown.prevent
        />
        <ObsidianIcon
          icon="chevron-right"
          tooltip="Next picture (→)"
          class="abele-gallery-viewer__nav abele-gallery-viewer__nav--next"
          @click.stop="next"
          @mousedown.prevent
        />
      </template>

      <div
        ref="frame"
        class="abele-gallery-viewer__image-wrap"
        tabindex="0"
        data-ignore-swipe="true"
        @wheel="onWheel"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @dblclick="onDoubleClick"
        @click.self="close"
      >
        <img
          ref="imageEl"
          :src="displayUrl"
          :alt="currentImage.alt"
          class="abele-gallery-viewer__image"
          :style="imageStyle"
          draggable="false"
          @click.stop
          @load="fit"
        />
      </div>

      <div v-if="currentImage.description" class="abele-gallery-viewer__caption">
        {{ currentImage.description }}
      </div>

      <!-- What can be done with the picture, as glyphs in a row the way a tab's header has them. -->
      <div class="abele-gallery-viewer__toolbar" role="toolbar" @click.stop>
        <ObsidianIcon icon="copy" tooltip="Copy the picture" @click="copyImage" />
        <ObsidianIcon
          icon="link"
          :tooltip="isLocal ? 'Copy its path in the vault' : 'Copy its address'"
          @click="copyPath"
        />
        <ObsidianIcon
          v-if="drawable"
          icon="pen-line"
          tooltip="Draw on this picture"
          @click="drawOnImage"
        />
        <ObsidianIcon
          v-if="isLocal"
          icon="rotate-cw"
          tooltip="Turn a quarter to the right"
          @click="rotateImage"
        />
        <ObsidianIcon
          v-if="!isLocal"
          icon="download"
          tooltip="Save it into the vault"
          @click="downloadImage"
        />
        <ObsidianIcon
          v-if="isLocal"
          icon="more-horizontal"
          tooltip="More: reveal, strip metadata, reduce, cover"
          @click="showMoreMenu"
        />
      </div>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { FileSystemAdapter, Menu, Notice, Platform, TFile } from 'obsidian'
import { request as requestUrl } from '@/helpers/http'
import ObsidianIcon from './obsidian/Icon.vue'
import ObsidianModal from './obsidian/Modal.vue'
import { useViewerPanZoom } from '@/composables/useViewerPanZoom'
import { GlobalStore } from '@/stores/GlobalStore'
import { createImportedBinary } from '@/media/importImageFile'
import { setCoverFromMedia } from '@/commands/setCover'
import { reduceImageFile, formatBytes } from '@/helpers/reduceImage'
import { useFilesInAgent } from '@/helpers/useFilesInAgent'
import { AbeleConfig } from '@/services/AbeleConfig'
import { vaultUrl } from '@/helpers/vaultUrl'
import { openImageInk } from '@/drawing/files'
import { isDrawable } from '@/drawing/pictureEntries'

import type { ViewerImage } from '@/helpers/viewerImage'
export type { ViewerImage } from '@/helpers/viewerImage'

const props = defineProps<{
  images: ViewerImage[]
  startIndex: number
  galleryFilePath: string
  chatId?: string
  /** An unsent image: the drawing returned to the chat replaces this attachment. */
  replaceAttachment?: string
}>()

const emit = defineEmits<{
  close: []
  'image-changed': []
}>()

const currentIndex = ref(props.startIndex)
const urlOverride = ref<string | null>(null)

const imageEl = ref<HTMLImageElement | null>(null)

const currentImage = computed(() => props.images[currentIndex.value])
const isLocal = computed(() => currentImage.value.type === 'local')

const fileInfo = computed(() => {
  if (!isLocal.value) return null
  const { app } = GlobalStore.getInstance()
  const file = app.vault.getAbstractFileByPath(currentImage.value.path)
  if (!(file instanceof TFile)) return null
  const s = file.stat
  return {
    name: file.name,
    size: formatBytes(s.size),
    modified: new Date(s.mtime).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }),
  }
})

/**
 * The file's name. Not the caption, which stands under the picture: a gallery's `alt` is the
 * caption or, with none, the whole link, so it was the caption twice or a path in the title.
 */
const title = computed(
  () =>
    fileInfo.value?.name || nameOf(currentImage.value.path) || currentImage.value.alt || 'Picture'
)
const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const facts = computed(() =>
  [
    props.images.length > 1 ? `${currentIndex.value + 1} / ${props.images.length}` : '',
    fileInfo.value?.size ?? '',
    fileInfo.value?.modified ?? '',
  ]
    .filter(Boolean)
    .join(' · ')
)

/** A picture in the vault that can be drawn on: the pen opens it in a drawing tab. */
const drawable = computed(() => isLocal.value && isDrawable(resolveFile()))

function drawOnImage() {
  const file = resolveFile()
  if (!file) return
  close()
  void openImageInk(
    GlobalStore.getInstance().app,
    file.path,
    props.chatId,
    null,
    props.replaceAttachment
  )
}

const displayUrl = computed(() => urlOverride.value || currentImage.value.url)

const frame = ref<HTMLElement | null>(null)
const {
  view,
  fit,
  reset,
  onWheel,
  onDoubleClick,
  onKey,
  onPointerDown,
  onPointerMove,
  onPointerUp,
} = useViewerPanZoom(
  frame,
  () => ({
    width: imageEl.value?.naturalWidth ?? 0,
    height: imageEl.value?.naturalHeight ?? 0,
  }),
  {
    close,
    maxFitScale: 1,
    wheelZoom: true,
    swipe: (direction) => (direction === 'next' ? next() : prev()),
  }
)
const imageStyle = computed(() => ({
  transform: `translate(${view.value.x}px, ${view.value.y}px) scale(${view.value.scale})`,
}))

function resetTransform() {
  reset()
  urlOverride.value = null
}

watch(currentIndex, resetTransform)

function prev() {
  currentIndex.value = (currentIndex.value - 1 + props.images.length) % props.images.length
}

function next() {
  currentIndex.value = (currentIndex.value + 1) % props.images.length
}

function close() {
  emit('close')
}

// --- Toolbar actions ---

function resolveFile(): TFile | null {
  const { app } = GlobalStore.getInstance()
  return app.metadataCache.getFirstLinkpathDest(currentImage.value.path, props.galleryFilePath)
}

async function copyImage() {
  try {
    // `fetch`, not `requestUrl`: this URL is often an `app://` vault resource for a local
    // image, which `requestUrl` does not serve. Named on `window` for the same reason the
    // timers are — it is the window's own implementation that is wanted.
    const response = await window.fetch(displayUrl.value)
    const blob = await response.blob()
    const pngBlob = blob.type === 'image/png' ? blob : await convertToPng(displayUrl.value)
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })])
    new Notice('Image copied')
  } catch {
    new Notice('Failed to copy image')
  }
}

function convertToPng(src: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = createEl('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext('2d').drawImage(img, 0, 0)
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
    }
    img.onerror = reject
    img.src = src
  })
}

function copyPath() {
  const image = currentImage.value
  const text = image.type === 'local' ? image.path : image.url
  navigator.clipboard.writeText(text)
  new Notice('Path copied')
}

function openOnDisk() {
  const file = resolveFile()
  if (!file) return

  // Obsidian exposes no cross-platform way to reveal a file in the OS file manager, so this
  // reaches for Electron — which exists only on desktop. On mobile, and if anything about the
  // call fails, the path is copied instead.
  if (Platform.isDesktop) {
    try {
      const { app } = GlobalStore.getInstance()
      const basePath = (app.vault.adapter as FileSystemAdapter).getBasePath()
      if (basePath) {
        const electron = require('electron')
        electron.remote?.shell?.showItemInFolder(`${basePath}/${file.path}`) ??
          electron.shell?.showItemInFolder(`${basePath}/${file.path}`)
        return
      }
    } catch {
      // Falls through to copying the path.
    }
  }

  navigator.clipboard.writeText(currentImage.value.path)
  new Notice('Path copied (could not open folder)')
}

async function rotateImage() {
  const file = resolveFile()
  if (!file) return

  const { app } = GlobalStore.getInstance()

  const buffer = await app.vault.readBinary(file)
  const blob = new Blob([buffer])
  const imgUrl = URL.createObjectURL(blob)

  try {
    const img = await loadImage(imgUrl)
    const canvas = createEl('canvas')
    canvas.width = img.naturalHeight
    canvas.height = img.naturalWidth
    const ctx = canvas.getContext('2d')
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate(Math.PI / 2)
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)

    const mimeType = file.extension === 'png' ? 'image/png' : 'image/jpeg'
    const quality = mimeType === 'image/jpeg' ? 0.95 : undefined
    const rotatedBlob = await canvasToBlob(canvas, mimeType, quality)
    const rotatedBuffer = await rotatedBlob.arrayBuffer()

    await app.vault.modifyBinary(file, rotatedBuffer)

    // Force image reload in viewer and gallery grid
    urlOverride.value = vaultUrl(app, file)
    emit('image-changed')
    new Notice('Image rotated')
  } finally {
    URL.revokeObjectURL(imgUrl)
  }
}

/** Re-encode image through canvas to strip all EXIF/IPTC metadata */
async function stripMetadata() {
  const file = resolveFile()
  if (!file) return

  const { app } = GlobalStore.getInstance()
  const buffer = await app.vault.readBinary(file)
  const blob = new Blob([buffer])
  const imgUrl = URL.createObjectURL(blob)

  try {
    const img = await loadImage(imgUrl)
    const canvas = createEl('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)

    const mimeType = file.extension === 'png' ? 'image/png' : 'image/jpeg'
    const quality = mimeType === 'image/jpeg' ? 0.95 : undefined
    const cleanBlob = await canvasToBlob(canvas, mimeType, quality)
    const cleanBuffer = await cleanBlob.arrayBuffer()

    const saved = cleanBuffer.byteLength
    const original = buffer.byteLength
    await app.vault.modifyBinary(file, cleanBuffer)

    urlOverride.value = vaultUrl(app, file)
    emit('image-changed')
    const diff = original - saved
    new Notice(
      diff > 0
        ? `Metadata stripped (${formatBytes(original)} → ${formatBytes(saved)})`
        : 'Metadata stripped'
    )
  } finally {
    URL.revokeObjectURL(imgUrl)
  }
}

/** Re-encode image at reduced quality/size */
async function reduceSize() {
  const file = resolveFile()
  if (!file) return

  const result = await reduceImageFile(file)
  if (!result.reduced) {
    new Notice('Image is already optimized')
    return
  }

  const { app } = GlobalStore.getInstance()
  urlOverride.value = vaultUrl(app, file)
  emit('image-changed')
  new Notice(`Reduced: ${formatBytes(result.originalSize)} → ${formatBytes(result.newSize)}`)
}

async function downloadImage() {
  const image = currentImage.value
  if (image.type !== 'remote') return

  try {
    const { app } = GlobalStore.getInstance()
    // `requestUrl` rather than `fetch`: this is always a remote address, and going out from
    // the main process means a host that sends no CORS headers still serves the image.
    const response = await requestUrl({ url: image.path, throw: false })
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status}`)
    }
    const buffer = response.arrayBuffer

    let fileName: string
    try {
      fileName = new URL(image.path).pathname.split('/').pop() || `image-${Date.now()}.png`
    } catch {
      fileName = `image-${Date.now()}.png`
    }

    // Ensure file has an extension
    if (!fileName.includes('.')) {
      const contentType = response.headers['content-type'] || ''
      const ext = contentType.includes('png')
        ? 'png'
        : contentType.includes('webp')
          ? 'webp'
          : 'jpg'
      fileName += '.' + ext
    }

    const file = await createImportedBinary(
      app,
      fileName,
      new Blob([buffer], { type: response.headers['content-type'] || '' })
    )
    new Notice(`Downloaded: ${file.path}`)
  } catch (e) {
    new Notice(`Download failed: ${e}`)
  }
}

async function setAsCover() {
  const mediaFile = resolveFile()
  if (!mediaFile) return
  const { app } = GlobalStore.getInstance()
  const noteFile = app.vault.getAbstractFileByPath(props.galleryFilePath)
  if (!(noteFile instanceof TFile)) return
  await setCoverFromMedia(mediaFile, noteFile)
}

function showMoreMenu(e: MouseEvent) {
  const menu = new Menu()
  if (isLocal.value) {
    menu.addItem((item) =>
      item
        .setTitle('Reveal in folder')
        .setIcon('folder-open')
        .onClick(() => openOnDisk())
    )
    menu.addItem((item) =>
      item
        .setTitle('Strip metadata')
        .setIcon('eraser')
        .onClick(() => stripMetadata())
    )
    menu.addItem((item) =>
      item
        .setTitle('Reduce size')
        .setIcon('minimize-2')
        .onClick(() => reduceSize())
    )
    menu.addItem((item) =>
      item
        .setTitle('Set as cover')
        .setIcon('image')
        .onClick(() => setAsCover())
    )
    if (AbeleConfig.getInstance().ai.enabled) {
      menu.addItem((item) =>
        item
          .setTitle('Add to agent context')
          .setIcon('bot')
          .onClick(() => {
            const file = resolveFile()
            if (file) useFilesInAgent([file])
          })
      )
    }
  }
  menu.showAtPosition({ x: e.clientX, y: e.clientY })
}

// --- Helpers ---

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), type, quality)
  })
}

function onKeydown(e: KeyboardEvent) {
  switch (e.key) {
    case 'Escape':
      e.stopPropagation()
      close()
      break
    case 'ArrowLeft':
      e.stopPropagation()
      prev()
      break
    case 'ArrowRight':
      e.stopPropagation()
      next()
      break
    default:
      onKey(e)
  }
}

onMounted(() => {
  // Blur active element to prevent keyboard popup on mobile
  ;(document.activeElement as HTMLElement)?.blur()
  document.addEventListener('keydown', onKeydown, true)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown, true)
})
</script>

<style lang="scss">
.abele-gallery-viewer {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  user-select: none;
}
.abele-gallery-viewer__info {
  min-height: 1lh;
  color: var(--text-muted);
  font-size: var(--font-ui-small);
  font-variant-numeric: tabular-nums;
  text-align: center;
  pointer-events: none;
}
// On a plate of the page's own colour, so the arrow reads over any picture.
.abele-gallery-viewer .abele-gallery-viewer__nav {
  position: absolute;
  top: 50%;
  z-index: 1;
  transform: translateY(-50%);
  background-color: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  &:hover {
    background-color: var(--background-primary);
    color: var(--icon-color-hover);
  }
  &--prev {
    left: var(--size-4-2);
  }
  &--next {
    right: var(--size-4-2);
  }
}
.abele-gallery-viewer__image-wrap {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  touch-action: none;
  outline: none;
  background-color: var(--background-secondary);
  border-radius: var(--radius-m);
}
.abele-gallery-viewer__image {
  position: absolute;
  top: 0;
  left: 0;
  max-width: none;
  max-height: none;
  transform-origin: 0 0;
  transition: none;
}
.abele-gallery-viewer__caption {
  color: var(--text-normal);
  font-size: var(--font-ui-small);
  text-align: center;
  overflow-wrap: anywhere;
  pointer-events: none;
}
.abele-gallery-viewer__toolbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--size-2-2);
}
</style>
