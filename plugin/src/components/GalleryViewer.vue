<template>
  <Teleport to="body">
    <div class="abele-gallery-viewer" @click.self="close" @wheel.prevent="onWheel">
      <div class="abele-gallery-viewer__counter">{{ currentIndex + 1 }} / {{ images.length }}</div>
      <ObsidianIcon icon="x" class="abele-gallery-viewer__close" no-hover @click="close" />

      <ObsidianIcon
        v-if="images.length > 1"
        icon="chevron-left"
        class="abele-gallery-viewer__nav abele-gallery-viewer__nav--prev"
        no-hover
        @click.stop="prev"
      />
      <ObsidianIcon
        v-if="images.length > 1"
        icon="chevron-right"
        class="abele-gallery-viewer__nav abele-gallery-viewer__nav--next"
        no-hover
        @click.stop="next"
      />

      <div
        class="abele-gallery-viewer__image-wrap"
        @mousedown.prevent="onDragStart"
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
        />
      </div>

      <div class="abele-gallery-viewer__toolbar" @click.stop>
        <ObsidianIcon icon="copy" no-hover text-right="Copy" @click="copyImage" />
        <ObsidianIcon icon="link" no-hover text-right="Path" @click="copyPath" />
        <ObsidianIcon
          v-if="isLocal"
          icon="folder-open"
          no-hover
          text-right="Reveal"
          @click="openOnDisk"
        />
        <ObsidianIcon
          v-if="isLocal"
          icon="rotate-cw"
          no-hover
          text-right="Rotate"
          @click="rotateImage"
        />
        <ObsidianIcon
          v-if="!isLocal"
          icon="download"
          no-hover
          text-right="Download"
          @click="downloadImage"
        />
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { Notice, TFile } from 'obsidian'
import ObsidianIcon from './obsidian/Icon.vue'
import { GlobalStore } from '@/stores/GlobalStore'

export interface ViewerImage {
  url: string
  alt: string
  type: 'local' | 'remote'
  path: string
}

const props = defineProps<{
  images: ViewerImage[]
  startIndex: number
  galleryFilePath: string
}>()

const emit = defineEmits<{
  close: []
  'image-changed': []
}>()

const currentIndex = ref(props.startIndex)
const scale = ref(1)
const translateX = ref(0)
const translateY = ref(0)
const urlOverride = ref<string | null>(null)

const imageEl = ref<HTMLImageElement | null>(null)

const currentImage = computed(() => props.images[currentIndex.value])
const isLocal = computed(() => currentImage.value.type === 'local')

const displayUrl = computed(() => urlOverride.value || currentImage.value.url)

const imageStyle = computed(() => ({
  transform: `translate(${translateX.value}px, ${translateY.value}px) scale(${scale.value})`,
  cursor: scale.value > 1 ? 'grab' : 'default',
}))

function resetTransform() {
  scale.value = 1
  translateX.value = 0
  translateY.value = 0
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
    const response = await fetch(displayUrl.value)
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
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext('2d')!.drawImage(img, 0, 0)
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

  try {
    const { app } = GlobalStore.getInstance()
    const basePath = (app.vault.adapter as any).basePath
    if (basePath) {
      const electron = require('electron')
      electron.remote?.shell?.showItemInFolder(`${basePath}/${file.path}`) ??
        electron.shell?.showItemInFolder(`${basePath}/${file.path}`)
    }
  } catch {
    navigator.clipboard.writeText(currentImage.value.path)
    new Notice('Path copied (could not open folder)')
  }
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
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalHeight
    canvas.height = img.naturalWidth
    const ctx = canvas.getContext('2d')!
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate(Math.PI / 2)
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)

    const mimeType = file.extension === 'png' ? 'image/png' : 'image/jpeg'
    const quality = mimeType === 'image/jpeg' ? 0.95 : undefined
    const rotatedBlob = await canvasToBlob(canvas, mimeType, quality)
    const rotatedBuffer = await rotatedBlob.arrayBuffer()

    await app.vault.modifyBinary(file, rotatedBuffer)

    // Force image reload in viewer and gallery grid
    urlOverride.value = app.vault.getResourcePath(file) + '#t=' + Date.now()
    emit('image-changed')
    new Notice('Image rotated')
  } finally {
    URL.revokeObjectURL(imgUrl)
  }
}

async function downloadImage() {
  const image = currentImage.value
  if (image.type !== 'remote') return

  try {
    const { app } = GlobalStore.getInstance()
    const response = await fetch(image.path)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const buffer = await response.arrayBuffer()

    let fileName: string
    try {
      fileName = new URL(image.path).pathname.split('/').pop() || `image-${Date.now()}.png`
    } catch {
      fileName = `image-${Date.now()}.png`
    }

    // Ensure file has an extension
    if (!fileName.includes('.')) {
      const contentType = response.headers.get('content-type') || ''
      const ext = contentType.includes('png')
        ? 'png'
        : contentType.includes('webp')
          ? 'webp'
          : 'jpg'
      fileName += '.' + ext
    }

    const file = await app.vault.createBinary(fileName, buffer)
    new Notice(`Downloaded: ${file.path}`)
  } catch (e) {
    new Notice(`Download failed: ${e}`)
  }
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

// --- Zoom / Pan / Keyboard ---

function onWheel(e: WheelEvent) {
  const delta = e.deltaY > 0 ? -0.15 : 0.15
  const newScale = Math.max(0.5, Math.min(10, scale.value + delta))

  if (newScale !== scale.value) {
    const rect = imageEl.value?.getBoundingClientRect()
    if (rect) {
      const cx = e.clientX - rect.left - rect.width / 2
      const cy = e.clientY - rect.top - rect.height / 2
      const factor = newScale / scale.value
      translateX.value = cx - factor * (cx - translateX.value)
      translateY.value = cy - factor * (cy - translateY.value)
    }
    scale.value = newScale
  }
}

let isDragging = false
let dragStartX = 0
let dragStartY = 0
let startTranslateX = 0
let startTranslateY = 0

function onDragStart(e: MouseEvent) {
  if (scale.value <= 1) return
  isDragging = true
  dragStartX = e.clientX
  dragStartY = e.clientY
  startTranslateX = translateX.value
  startTranslateY = translateY.value
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
}

function onDragMove(e: MouseEvent) {
  if (!isDragging) return
  translateX.value = startTranslateX + (e.clientX - dragStartX)
  translateY.value = startTranslateY + (e.clientY - dragStartY)
}

function onDragEnd() {
  isDragging = false
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
}

function onKeydown(e: KeyboardEvent) {
  switch (e.key) {
    case 'Escape':
      close()
      break
    case 'ArrowLeft':
      prev()
      break
    case 'ArrowRight':
      next()
      break
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
})
</script>

<style lang="scss">
.abele-gallery-viewer {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
}

.abele-gallery-viewer__counter {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  color: rgba(255, 255, 255, 0.7);
  font-size: 14px;
  pointer-events: none;
}

.abele-gallery-viewer__close {
  position: absolute;
  top: 12px;
  right: 12px;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;

  &:hover {
    color: #fff;
  }
}

.abele-gallery-viewer__nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  z-index: 1;

  &:hover {
    color: #fff;
  }

  &--prev {
    left: 12px;
  }

  &--next {
    right: 12px;
  }
}

.abele-gallery-viewer__image-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.abele-gallery-viewer__image {
  max-width: 90vw;
  max-height: 85vh;
  object-fit: contain;
  transition: none;
}

.abele-gallery-viewer__toolbar {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 4px;
  padding: 6px 10px;
  background: rgba(0, 0, 0, 0.6);
  border-radius: var(--radius-m);
  backdrop-filter: blur(8px);

  .abele-obsidian-icon {
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;

    &:hover {
      color: #fff;
    }
  }

  .abele-obsidian-icon__text {
    color: inherit;
  }
}
</style>
