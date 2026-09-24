<template>
  <div class="abele-github-notice">
    <div class="abele-github-notice__text">{{ text }}</div>
    <Button
      text="Try again"
      icon="refresh-cw"
      tooltip="Ask GitHub again for this part"
      :disabled="busy"
      @click="emit('retry')"
    />
  </div>
</template>

<script setup lang="ts">
import Button from '../obsidian/Button.vue'

/**
 * One section of an item that could not be read, said in that section's place: the rest of the
 * item is on screen, so this is a line in it rather than an error instead of it.
 */
defineProps<{
  text: string
  busy?: boolean
}>()

const emit = defineEmits<{
  (e: 'retry'): void
}>()
</script>

<style lang="scss">
.abele-github-notice {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--size-4-2);
  padding: var(--size-4-2) var(--size-4-3);
  border-left: var(--size-2-1) solid var(--text-warning);
  background-color: var(--background-secondary);
  border-radius: var(--radius-s);

  &__text {
    color: var(--text-muted);
    font-size: var(--font-ui-small);
    // A refusal is several lines — the cause, the permission, GitHub's own words.
    white-space: pre-line;
    overflow-wrap: anywhere;
  }
}
</style>
