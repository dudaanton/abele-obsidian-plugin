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
          :src="currentImage.url"
          :alt="currentImage.alt"
          class="abele-gallery-viewer__image"
          :style="imageStyle"
          draggable="false"
          @click.stop
        />
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import ObsidianIcon from './obsidian/Icon.vue'

export interface ViewerImage {
  url: string
  alt: string
}

const props = defineProps<{
  images: ViewerImage[]
  startIndex: number
}>()

const emit = defineEmits<{
  close: []
}>()

const currentIndex = ref(props.startIndex)
const scale = ref(1)
const translateX = ref(0)
const translateY = ref(0)

const imageEl = ref<HTMLImageElement | null>(null)

const currentImage = computed(() => props.images[currentIndex.value])

const imageStyle = computed(() => ({
  transform: `translate(${translateX.value}px, ${translateY.value}px) scale(${scale.value})`,
  cursor: scale.value > 1 ? 'grab' : 'default',
}))

function resetTransform() {
  scale.value = 1
  translateX.value = 0
  translateY.value = 0
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

function onWheel(e: WheelEvent) {
  const delta = e.deltaY > 0 ? -0.15 : 0.15
  const newScale = Math.max(0.5, Math.min(10, scale.value + delta))

  if (newScale !== scale.value) {
    // Zoom toward cursor position
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
  max-height: 90vh;
  object-fit: contain;
  transition: none;
}
</style>
