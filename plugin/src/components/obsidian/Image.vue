<template>
  <component
    :is="preview ? 'button' : 'span'"
    v-if="variant === 'thumbnail'"
    class="abele-image-thumbnail"
    :class="{ 'clickable-icon': preview, 'abele-image__preview': preview }"
    :type="preview ? 'button' : undefined"
    :disabled="preview ? unavailable || loading || pending : undefined"
    :aria-busy="pending || (loading && !unavailable)"
    :aria-label="
      unavailable && !pending
        ? `Image unavailable: ${alt || 'image'}`
        : preview
          ? `Preview ${alt || 'image'}`
          : undefined
    "
    :role="!preview && unavailable ? 'img' : undefined"
    @click="preview && !unavailable && !loading && !pending && emit('click')"
  >
    <img
      v-if="!unavailable && !pending"
      class="abele-image abele-image-thumbnail__image"
      :class="`abele-image_fit-${fit}`"
      :src="resolved"
      :alt="preview ? '' : (alt ?? '')"
      @load="loading = false"
      @error="failed = true"
    />
    <span v-if="unavailable && !pending" class="abele-image-thumbnail__fallback"
      ><Icon icon="image-off" no-hover /><span class="abele-image-thumbnail__reason"
        >Image unavailable<template v-if="alt">: {{ alt }}</template></span
      ></span
    >
    <span v-else-if="loading || pending" class="abele-image-thumbnail__fallback" role="status"
      ><span aria-hidden="true">Loading…</span
      ><span class="abele-image-thumbnail__reason">Loading image…</span></span
    >
  </component>
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
import Icon from './Icon.vue'
import './designKit.css'
const props = withDefaults(
  defineProps<{
    src: string
    alt?: string
    fit?: 'contain' | 'cover' | 'natural'
    variant?: 'image' | 'thumbnail'
    preview?: boolean
    /** The adapter is still resolving a source, not a missing image. */ pending?: boolean
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
  position: relative;
  align-items: center;
  justify-content: center;
  padding: 0;
  width: var(--size-4-16);
  height: var(--size-4-16);
  flex: 0 0 auto;
  border-radius: var(--radius-s);
  background: var(--background-secondary);
}
.abele-image-thumbnail .abele-image-thumbnail__image {
  width: var(--size-4-16);
  height: var(--size-4-16);
}
.abele-image-thumbnail__fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
}
/* The fallback icon has an exact accessible explanation, without turning a bounded
   thumbnail into a column of broken words. Its parent owns the accessible image name. */
.abele-image-thumbnail__reason {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
}
</style>
