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
 * A vault path is not a URL the renderer can load; `getResourcePath` turns it into one. A
 * path that resolves to nothing keeps its `alt` and a class, so a script can style the gap.
 */
import { computed } from 'vue'
import { TFile } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'

const props = defineProps<{
  /** A vault path, or a URL — anything with a scheme, or a leading slash, is left alone. */
  src: string
  alt?: string
  fit?: 'contain' | 'cover' | 'natural'
}>()

const emit = defineEmits<{ (e: 'click'): void }>()

const isUrl = (s: string) => /^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('/')

const file = computed(() => {
  if (isUrl(props.src)) return null
  const found = GlobalStore.getInstance().app.vault.getAbstractFileByPath(props.src)
  return found instanceof TFile ? found : null
})

const missing = computed(() => !isUrl(props.src) && !file.value)

const resolved = computed(() => {
  if (isUrl(props.src)) return props.src
  return file.value ? GlobalStore.getInstance().app.vault.getResourcePath(file.value) : undefined
})
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
