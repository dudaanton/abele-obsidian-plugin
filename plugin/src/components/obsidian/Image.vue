<template>
  <span
    v-if="variant === 'thumbnail'"
    class="abele-image-thumbnail"
    :aria-busy="loading && !unavailable"
  >
    <img
      v-if="!unavailable"
      class="abele-image abele-image-thumbnail__image"
      :class="`abele-image_fit-${fit}`"
      :src="resolved"
      :alt="alt ?? ''"
      @load="loading = false"
      @error="failed = true"
    />
    <span v-if="unavailable" class="abele-image-thumbnail__fallback"
      >Image unavailable<template v-if="alt">: {{ alt }}</template></span
    >
    <span v-else-if="loading" class="abele-image-thumbnail__fallback" role="status"
      >Loading image…</span
    >
    <button
      v-if="preview"
      type="button"
      class="clickable-icon abele-image__preview"
      :disabled="unavailable || loading"
      :aria-label="unavailable ? 'Preview unavailable: image missing' : `Preview ${alt || 'image'}`"
      @click="emit('click')"
    >
      Preview
    </button>
  </span>
  <img
    v-else
    class="abele-image"
    :class="[`abele-image_fit-${fit}`, { 'abele-image_missing': unavailable }]"
    :src="unavailable ? undefined : resolved"
    :alt="alt ?? ''"
    @load="loading = false"
    @error="failed = true"
    @click="emit('click')"
  />
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { isExternalSource, resourceUrl } from '@/helpers/resourceUrl'
import './designKit.css'
const props = withDefaults(
  defineProps<{
    src: string
    alt?: string
    fit?: 'contain' | 'cover' | 'natural'
    variant?: 'image' | 'thumbnail'
    preview?: boolean
  }>(),
  { fit: 'contain', variant: 'image' }
)
const emit = defineEmits<{ click: [] }>()
const resolved = computed(() => resourceUrl(props.src))
const failed = ref(false)
const loading = ref(true)
const unavailable = computed(
  () => failed.value || (!isExternalSource(props.src) && resolved.value === undefined)
)
watch(
  () => props.src,
  () => {
    failed.value = false
    loading.value = true
  }
)
</script>
<style>
.abele-image {
  display: block;
  max-width: 100%;
  border-radius: var(--radius-s);
}
.abele-image_fit-contain {
  width: 100%;
  height: auto;
  object-fit: contain;
}
.abele-image_fit-cover {
  width: 100%;
  object-fit: cover;
}
.abele-image_fit-natural {
  width: auto;
}
.abele-image_missing {
  min-height: var(--size-4-8);
  color: var(--text-muted);
}
.abele-image-thumbnail {
  display: inline-flex;
  flex-direction: column;
  justify-content: center;
  width: var(--size-4-16);
  min-height: var(--size-4-16);
  flex: 0 0 auto;
  border-radius: var(--radius-s);
  background: var(--background-secondary);
}
.abele-image-thumbnail .abele-image-thumbnail__image {
  width: var(--size-4-16);
  height: var(--size-4-16);
}
.abele-image-thumbnail__fallback {
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
  overflow-wrap: anywhere;
  padding: var(--size-4-1);
}
.abele-image__preview {
  white-space: normal;
}
</style>
