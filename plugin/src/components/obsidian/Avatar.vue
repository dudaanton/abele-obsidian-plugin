<template>
  <span class="abele-avatar" :data-initial="initial" aria-hidden="true">
    <img
      v-if="src && !broken"
      class="abele-avatar__image"
      :src="src"
      alt=""
      @error="broken = true"
    />
  </span>
</template>

<script setup lang="ts">
/**
 * A person's picture, round, at the size of a line of small text. Without a picture — none
 * given, or one that would not load — the circle shows the first letter of `name` instead. The
 * letter is drawn by CSS, not written into the page, so it is never copied, found or read out as
 * part of the text beside it; the picture is decoration for the same reason, the name beside it
 * says who it is.
 */
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  /** A URL or a `data:` URL; empty for none. */
  src?: string | null
  /** Whose it is: the first letter stands in for a missing picture. */
  name: string
}>()

const broken = ref(false)
watch(
  () => props.src,
  () => (broken.value = false)
)

const initial = computed(() => props.name.trim().charAt(0).toUpperCase())
</script>

<style lang="scss">
.abele-avatar {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: var(--size-4-5);
  height: var(--size-4-5);
  border-radius: 50%;
  overflow: hidden;
  background-color: var(--background-modifier-hover);
  color: var(--text-muted);
  font-size: var(--font-smallest);
  line-height: 1;
  vertical-align: middle;

  &::before {
    content: attr(data-initial);
  }

  &__image {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}
</style>
