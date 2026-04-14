<template>
  <div class="abele-gallery">
    <div v-if="gallery.images.length === 0" class="abele-gallery__empty">
      <ObsidianIcon icon="image" />
      <span>No images</span>
    </div>
    <div v-else class="abele-gallery__grid">
      <div v-for="(image, index) in resolvedImages" :key="index" class="abele-gallery__item">
        <img
          v-if="image.url"
          :src="image.url"
          :alt="image.alt"
          class="abele-gallery__image"
          loading="lazy"
          @click="openViewer(index)"
        />
        <div v-else class="abele-gallery__image-error">
          <ObsidianIcon icon="image-off" />
          <span>{{ image.alt }}</span>
        </div>
      </div>
    </div>

    <GalleryViewer
      v-if="viewerOpen"
      :images="viewerImages"
      :start-index="viewerStartIndex"
      @close="viewerOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Gallery } from '@/entities/Gallery'
import ObsidianIcon from './obsidian/Icon.vue'
import GalleryViewer, { type ViewerImage } from './GalleryViewer.vue'

const props = defineProps<{
  gallery: Gallery
}>()

const resolvedImages = computed(() => {
  return props.gallery.images.map((image) => ({
    url: props.gallery.resolveImageUrl(image),
    alt: image.alt,
    type: image.type,
    path: image.path,
  }))
})

const viewerOpen = ref(false)
const viewerStartIndex = ref(0)

const viewerImages = computed<ViewerImage[]>(() =>
  resolvedImages.value.filter((img) => img.url).map((img) => ({ url: img.url!, alt: img.alt }))
)

function openViewer(index: number) {
  // Map grid index to viewer index (skipping broken images)
  let viewerIdx = 0
  for (let i = 0; i < index; i++) {
    if (resolvedImages.value[i].url) viewerIdx++
  }
  viewerStartIndex.value = viewerIdx
  viewerOpen.value = true
}
</script>

<style lang="scss">
.abele-gallery {
  margin: 0.5em 0;
  border-radius: var(--radius-m);
  overflow: hidden;
}

.abele-gallery__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5em;
  padding: 2em;
  color: var(--text-muted);
  background: var(--background-secondary);
  border-radius: var(--radius-m);
}

.abele-gallery__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 4px;
}

.abele-gallery__item {
  position: relative;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: var(--radius-s);
}

.abele-gallery__image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.abele-gallery__image-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5em;
  height: 100%;
  color: var(--text-muted);
  background: var(--background-secondary);
  font-size: 0.85em;

  span {
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
    max-width: 90%;
  }
}
</style>
