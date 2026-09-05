<template>
  <img
    class="abele-image"
    :class="[`abele-image_fit-${fit ?? 'contain'}`, { 'abele-image_missing': missing }]"
    :src="resolved"
    :alt="alt ?? ''"
    @click="emit('click')"
  />
</template>

<script setup lang="ts">
/**
 * A picture from the vault or from the web.
 *
 * A vault path is not a URL the renderer can load; `resourceUrl` turns it into one, and finds
 * a file by the name a note would link it by when no file sits at the path as written. A
 * path that resolves to nothing keeps its `alt` and a class, so a script can style the gap.
 */
import { computed } from 'vue'
import { isExternalSource, resourceUrl } from '@/helpers/resourceUrl'

const props = defineProps<{
  /** A vault path, a link name (`poster.jpg`), or a URL — anything with a scheme, or a leading slash, is left alone. */
  src: string
  alt?: string
  fit?: 'contain' | 'cover' | 'natural'
}>()

const emit = defineEmits<{ (e: 'click'): void }>()

const resolved = computed(() => resourceUrl(props.src))

const missing = computed(() => !isExternalSource(props.src) && resolved.value === undefined)
</script>

<style lang="scss">
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

/** The picture's own size, for a diagram or an icon that a column must not stretch. */
.abele-image_fit-natural {
  width: auto;
}

/** Nothing loaded, so the `alt` is all there is: give it a line to sit on. */
.abele-image_missing {
  min-height: var(--size-4-8);
  color: var(--text-muted);
}
</style>
