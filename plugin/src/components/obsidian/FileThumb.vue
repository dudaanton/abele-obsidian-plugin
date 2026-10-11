<template>
  <span class="abele-file-thumb" :class="{ 'abele-file-thumb_glyph': !shows }" aria-hidden="true">
    <img v-if="shows && kind === 'image'" :src="src" alt="" loading="lazy" @error="failed = true" />
    <video v-else-if="shows && kind === 'video'" :src="src" muted preload="metadata" />
    <Icon v-else :icon="glyph" :interactive="false" />
  </span>
</template>

<script setup lang="ts">
/**
 * A file's picture at the start of a row: a small square of the image or the video's first frame,
 * or the glyph of its kind where there is nothing to show — the same square, so the names of a
 * list stay in one column whatever the files are.
 */
import { computed, ref, watch } from 'vue'
import Icon from './Icon.vue'

const props = withDefaults(
  defineProps<{
    kind?: 'image' | 'video' | 'audio' | 'note' | 'other'
    src?: string
    /** A glyph of the caller's in place of the kind's own. */
    icon?: string
  }>(),
  { kind: 'other', src: undefined, icon: undefined }
)
const failed = ref(false)
watch(
  () => props.src,
  () => (failed.value = false)
)
const shows = computed(
  () => !!props.src && !failed.value && (props.kind === 'image' || props.kind === 'video')
)
const glyph = computed(
  () =>
    props.icon ??
    { image: 'image', video: 'film', audio: 'music', note: 'file-text', other: 'file' }[props.kind]
)
</script>

<style lang="scss">
.abele-file-thumb {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--size-4-6);
  height: var(--size-4-6);
  overflow: hidden;
  border-radius: var(--radius-s);

  img,
  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  &_glyph {
    background-color: var(--background-secondary);
    color: var(--text-faint);

    svg {
      width: var(--icon-s);
      height: var(--icon-s);
    }
  }
}
</style>
