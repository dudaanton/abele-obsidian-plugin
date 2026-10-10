<template>
  <div
    class="abele-gallery"
    :class="{
      'abele-gallery_readonly': gallery.readonly,
      'abele-gallery_dragging': draggingFiles,
    }"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <div v-if="draggingFiles" class="abele-gallery__drop-zone">
      <ObsidianIcon icon="images" />
      <span>Drop images and videos here</span>
    </div>
    <div v-if="!gallery.readonly" class="abele-gallery__header">
      <div class="abele-gallery__header-right">
        <ObsidianIcon ref="addBtnRef" icon="image-plus" @click="addMenu.open" />
        <ObsidianIcon :icon="editMode ? 'check' : 'pencil'" @click="editMode = !editMode" />
        <ObsidianIcon ref="layoutBtnRef" icon="settings" @click="layoutMenu.open" />
        <ObsidianIcon ref="deleteBtnRef" icon="trash-2" @click="deleteMenu.open" />
      </div>
    </div>

    <div
      v-if="gallery.images.length === 0"
      class="abele-gallery__empty"
      @click="!gallery.readonly && addFromVault()"
    >
      <ObsidianIcon icon="image" />
      <span>No images</span>
    </div>

    <div v-else-if="editMode && !gallery.readonly" class="abele-gallery__edit-list">
      <div v-for="(image, index) in resolvedImages" :key="index" class="abele-gallery__edit-item">
        <video
          v-if="image.url && image.mediaType === 'video'"
          :src="image.url"
          class="abele-gallery__edit-thumb"
          muted
        />
        <img v-else-if="image.url" :src="image.url" class="abele-gallery__edit-thumb" />
        <div v-else class="abele-gallery__edit-thumb abele-gallery__edit-thumb--missing">
          <ObsidianIcon icon="image-off" />
        </div>
        <div class="abele-gallery__edit-fields">
          <div class="abele-gallery__edit-path">{{ image.path }}</div>
          <input
            class="abele-gallery__edit-description"
            :value="gallery.images[index].description"
            placeholder="Description..."
            @change="updateDescription(index, ($event.target as HTMLInputElement).value)"
          />
        </div>
        <div class="abele-gallery__edit-actions">
          <ObsidianIcon icon="image" title="Set as cover" @click="setAsCover(index)" />
          <ObsidianIcon icon="arrow-up" :disabled="index === 0" @click="moveImage(index, -1)" />
          <ObsidianIcon
            icon="arrow-down"
            :disabled="index === resolvedImages.length - 1"
            @click="moveImage(index, 1)"
          />
          <ObsidianIcon icon="trash" @click="removeImage(index)" />
        </div>
      </div>
    </div>

    <div v-else-if="gallery.layout === 'masonry'" class="abele-gallery__masonry">
      <div v-for="(col, colIdx) in masonryColumns" :key="colIdx" class="abele-gallery__masonry-col">
        <div v-for="imgIdx in col" :key="imgIdx" class="abele-gallery__item">
          <video
            v-if="resolvedImages[imgIdx].url && resolvedImages[imgIdx].mediaType === 'video'"
            :src="resolvedImages[imgIdx].url"
            class="abele-gallery__image"
            controls
            muted
            preload="metadata"
          />
          <img
            v-else-if="resolvedImages[imgIdx].url"
            :src="resolvedImages[imgIdx].url"
            :alt="resolvedImages[imgIdx].alt"
            class="abele-gallery__image"
            loading="lazy"
            @click.stop.prevent="openViewer(imgIdx)"
            @load="onImageLoad(imgIdx, $event)"
          />
          <div v-else class="abele-gallery__image-error">
            <ObsidianIcon icon="image-off" />
            <span>{{ resolvedImages[imgIdx].alt }}</span>
          </div>
        </div>
      </div>
    </div>

    <div
      v-else-if="gallery.layout === 'slider'"
      :class="['abele-gallery__slider-wrap', { 'abele-gallery__slider-wrap--no-bg': !gallery.bg }]"
    >
      <div ref="gridEl" class="abele-gallery__slider">
        <div
          v-for="(image, index) in resolvedImages"
          :key="index"
          class="abele-gallery__slider-item"
          :style="{ height: gallery.height + 'px' }"
        >
          <video
            v-if="image.url && image.mediaType === 'video'"
            :src="image.url"
            class="abele-gallery__image abele-gallery__image--contain"
            controls
            muted
            preload="metadata"
          />
          <img
            v-else-if="image.url"
            :src="image.url"
            :alt="image.alt"
            class="abele-gallery__image abele-gallery__image--contain"
            loading="lazy"
            @click.stop.prevent="openViewer(index)"
            @load="onImageLoad(index, $event)"
          />
        </div>
      </div>
      <template v-if="resolvedImages.length > 1">
        <div
          class="abele-gallery__slider-nav abele-gallery__slider-nav--prev"
          @click.stop="slideBy(-1)"
          @mousedown.prevent
        >
          <ObsidianIcon icon="chevron-left" no-hover />
        </div>
        <div
          class="abele-gallery__slider-nav abele-gallery__slider-nav--next"
          @click.stop="slideBy(1)"
          @mousedown.prevent
        >
          <ObsidianIcon icon="chevron-right" no-hover />
        </div>
      </template>
    </div>

    <div v-else :class="['abele-gallery__grid', `abele-gallery__grid--${gallery.layout}`]">
      <div v-for="(image, index) in resolvedImages" :key="index" class="abele-gallery__item">
        <video
          v-if="image.url && image.mediaType === 'video'"
          :src="image.url"
          class="abele-gallery__image"
          controls
          muted
          preload="metadata"
        />
        <img
          v-else-if="image.url"
          :src="image.url"
          :alt="image.alt"
          class="abele-gallery__image"
          loading="lazy"
          @click.stop.prevent="openViewer(index)"
          @load="onImageLoad(index, $event)"
        />
        <div v-else class="abele-gallery__image-error">
          <ObsidianIcon icon="image-off" />
          <span>{{ image.alt }}</span>
        </div>
      </div>
    </div>

    <input
      ref="fileInputRef"
      type="file"
      accept="image/*,video/*"
      multiple
      style="display: none"
      @change="onFilesSelected"
    />

    <GalleryViewer
      v-if="viewerOpen"
      :images="viewerImages"
      :start-index="viewerStartIndex"
      :gallery-file-path="gallery.filePath"
      @close="viewerOpen = false"
      @image-changed="imageVersion++"
    />
  </div>
</template>

<script lang="ts">
/** Track which galleries are in edit mode (survives widget recreation on doc change) */
const editModeFiles = new Set<string>()
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Notice, TFile } from 'obsidian'
import { Gallery } from '@/entities/Gallery'
import { GlobalStore } from '@/stores/GlobalStore'
import { useGalleryImports } from '@/composables/useGalleryImports'
import ObsidianIcon from './obsidian/Icon.vue'
import GalleryViewer, { type ViewerImage } from './GalleryViewer.vue'
import { setCoverFromMedia } from '@/commands/setCover'
import { Choice, useMenu } from '@/composables/useMenu'
import { reduceImageFile, formatBytes } from '@/helpers/reduceImage'
import { isMediaPath } from '@/helpers/galleryUtils'

const props = defineProps<{
  gallery: Gallery
}>()

const imageVersion = ref(0)
const editMode = ref(editModeFiles.has(props.gallery.filePath))
const fileInputRef = ref<HTMLInputElement | null>(null)
const gridEl = ref<HTMLElement | null>(null)
const addBtnRef = ref<InstanceType<typeof ObsidianIcon> | null>(null)
const layoutBtnRef = ref<InstanceType<typeof ObsidianIcon> | null>(null)
const deleteBtnRef = ref<InstanceType<typeof ObsidianIcon> | null>(null)
const {
  draggingFiles, addFromVault, addFromDisk, addFromClipboard, onDragEnter,
  onDragOver, onDragLeave, onDrop, onFilesSelected,
} = useGalleryImports(props, fileInputRef)

watch(editMode, (val) => {
  if (val) editModeFiles.add(props.gallery.filePath)
  else editModeFiles.delete(props.gallery.filePath)
})

/**
 * Bumped when a picture this gallery could not find appears in the vault. On a phone the note
 * often arrives from sync before its attachments do, and the link was resolved once, when the
 * gallery was drawn — so the picture stayed missing until the note was opened again.
 */
const vaultTick = ref(0)
const unresolved = () => resolvedImages.value.some((image) => image.type === 'local' && !image.url)
const onVaultChange = (file: unknown) => {
  if (file instanceof TFile && isMediaPath(file.path) && unresolved()) vaultTick.value++
}
{
  const { vault } = GlobalStore.getInstance().app
  const refs = [vault.on('create', onVaultChange), vault.on('rename', onVaultChange)]
  onBeforeUnmount(() => refs.forEach((r) => vault.offref(r)))
}

const resolvedImages = computed(() => {
  // A picture changed in place has a new address: this reads it again.
  void imageVersion.value
  void vaultTick.value
  return props.gallery.images.map((image) => ({
    url: props.gallery.resolveImageUrl(image),
    alt: image.alt,
    type: image.type,
    path: image.path,
    mediaType: image.mediaType || 'image',
  }))
})

// --- Image aspect ratios for masonry layout ---
const imageRatios = ref<Record<number, number>>({})

function onImageLoad(index: number, e: Event) {
  const img = e.target as HTMLImageElement
  if (img.naturalWidth && img.naturalHeight) {
    imageRatios.value[index] = img.naturalWidth / img.naturalHeight
  }
}

// --- Masonry column distribution ---
const MASONRY_COLS = 3

const masonryColumns = computed(() => {
  const cols: number[][] = Array.from({ length: MASONRY_COLS }, () => [])
  const heights = new Array(MASONRY_COLS).fill(0)

  for (let i = 0; i < resolvedImages.value.length; i++) {
    // Find shortest column
    let shortest = 0
    for (let c = 1; c < MASONRY_COLS; c++) {
      if (heights[c] < heights[shortest]) shortest = c
    }
    cols[shortest].push(i)
    // Estimate height: 1/aspectRatio (wider images are shorter)
    const ratio = imageRatios.value[i] || 1
    heights[shortest] += 1 / ratio
  }

  return cols
})

const viewerOpen = ref(false)
const viewerStartIndex = ref(0)

const viewerImages = computed<ViewerImage[]>(() =>
  resolvedImages.value
    .filter((img) => img.url)
    .map((img, i) => ({
      url: img.url!,
      alt: img.alt,
      type: img.type as 'local' | 'remote',
      path: img.path,
      description: props.gallery.images[i]?.description || '',
    }))
)

function openViewer(index: number) {
  let viewerIdx = 0
  for (let i = 0; i < index; i++) {
    if (resolvedImages.value[i].url) viewerIdx++
  }
  viewerStartIndex.value = viewerIdx
  viewerOpen.value = true
}

// --- Add menu ---

const addChoices = computed<Choice[]>(() => [
  { title: 'From vault', event: 'vault', icon: 'vault' },
  { title: 'From disk', event: 'disk', icon: 'hard-drive' },
  { title: 'From clipboard', event: 'clipboard', icon: 'clipboard-paste' },
])

function handleAddMenu(event: string) {
  if (event === 'vault') addFromVault()
  else if (event === 'disk') addFromDisk()
  else if (event === 'clipboard') addFromClipboard()
}

const addMenu = useMenu(addBtnRef, addChoices, handleAddMenu)

// --- Settings menu (layout, height, bg) ---

const settingsChoices = computed<Choice[]>(() => [
  {
    title: 'Layout',
    icon: 'layout-grid',
    subMenu: [
      { title: 'Grid', event: 'layout', value: 'grid', icon: 'layout-grid' },
      { title: 'Masonry', event: 'layout', value: 'masonry', icon: 'gallery-vertical-end' },
      { title: 'Column', event: 'layout', value: 'column', icon: 'rows-3' },
      { title: 'Slider', event: 'layout', value: 'slider', icon: 'gallery-horizontal' },
    ],
  },
  {
    title: 'Height',
    icon: 'ruler',
    subMenu: [200, 300, 400, 500, 600].map((h) => ({
      title: `${h}px${h === props.gallery.height ? ' ✓' : ''}`,
      event: 'height',
      value: String(h),
    })),
  },
  {
    title: props.gallery.bg ? 'Hide background' : 'Show background',
    event: 'bg',
    icon: props.gallery.bg ? 'eye-off' : 'eye',
  },
  {
    title: 'Reduce size',
    event: 'reduce-size',
    icon: 'minimize-2',
  },
])

async function handleSettingsMenu(event: string, value: string) {
  if (event === 'layout') props.gallery.setLayout(value)
  else if (event === 'height') props.gallery.setHeight(parseInt(value))
  else if (event === 'bg') props.gallery.setBg(!props.gallery.bg)
  else if (event === 'reduce-size') await reduceAllImages()
}

async function reduceAllImages() {
  const { app } = GlobalStore.getInstance()
  const localImages = props.gallery.images.filter((img) => img.type === 'local')

  if (localImages.length === 0) {
    new Notice('No local images to reduce')
    return
  }

  let reduced = 0
  let totalOriginal = 0
  let totalNew = 0

  for (const img of localImages) {
    const file = app.metadataCache.getFirstLinkpathDest(img.path, props.gallery.filePath)
    if (!(file instanceof TFile)) continue

    const result = await reduceImageFile(file)
    totalOriginal += result.originalSize
    totalNew += result.newSize
    if (result.reduced) reduced++
  }

  imageVersion.value++

  if (reduced === 0) {
    new Notice('All images are already optimized')
  } else {
    new Notice(
      `Reduced ${reduced}/${localImages.length} images: ${formatBytes(totalOriginal)} → ${formatBytes(totalNew)}`
    )
  }
}

const layoutMenu = useMenu(layoutBtnRef, settingsChoices, handleSettingsMenu)

// --- Slider ---

function slideBy(dir: number) {
  const el = gridEl.value
  if (!el) return

  const itemWidth = el.clientWidth
  const maxScroll = el.scrollWidth - itemWidth
  const currentScroll = el.scrollLeft

  if (dir > 0 && currentScroll >= maxScroll - 1) {
    // At the end → loop to start
    el.scrollTo({ left: 0, behavior: 'smooth' })
  } else if (dir < 0 && currentScroll <= 1) {
    // At the start → loop to end
    el.scrollTo({ left: maxScroll, behavior: 'smooth' })
  } else {
    el.scrollBy({ left: itemWidth * dir, behavior: 'smooth' })
  }
}

// --- Edit mode actions ---

async function setAsCover(index: number) {
  const { app } = GlobalStore.getInstance()
  const image = props.gallery.images[index]
  const mediaFile = app.metadataCache.getFirstLinkpathDest(image.path, props.gallery.filePath)
  if (!(mediaFile instanceof TFile)) return
  const noteFile = app.vault.getAbstractFileByPath(props.gallery.filePath)
  if (!(noteFile instanceof TFile)) return
  await setCoverFromMedia(mediaFile, noteFile)
}

function removeImage(index: number) {
  props.gallery.removeImage(index)
}

function moveImage(index: number, direction: -1 | 1) {
  props.gallery.moveImage(index, direction)
}

function updateDescription(index: number, description: string) {
  props.gallery.updateDescription(index, description)
}

// --- Delete menu ---

const deleteChoices = computed<Choice[]>(() => [
  { title: 'Remove gallery only', event: 'header', icon: 'minus' },
  { title: 'Remove with images', event: 'all', icon: 'trash-2' },
])

async function handleDeleteMenu(event: string) {
  if (event === 'header') {
    props.gallery.removeHeaderOnly()
  } else if (event === 'all') {
    const { app } = GlobalStore.getInstance()
    const localFiles = props.gallery.images
      .filter((img) => img.type === 'local')
      .map((img) => app.metadataCache.getFirstLinkpathDest(img.path, props.gallery.filePath))
      .filter((f): f is TFile => f instanceof TFile)

    props.gallery.removeBlock()

    for (const file of localFiles) {
      await app.fileManager.trashFile(file)
    }
  }
}

const deleteMenu = useMenu(deleteBtnRef, deleteChoices, handleDeleteMenu)
</script>

<style lang="scss" src="./gallery/gallery.scss"></style>
