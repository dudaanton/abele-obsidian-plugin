<template>
  <div class="abele-book-speech" role="toolbar" aria-label="Reading aloud" data-ignore-swipe="true">
    <span class="abele-book-speech__label">{{
      state === 'paused' ? 'Paused' : 'Reading aloud'
    }}</span>
    <div class="abele-book-speech__actions">
      <Icon
        icon="skip-back"
        tooltip="Read the last sentence again"
        @click="emit('action', 'prev')"
      />
      <Icon
        :icon="state === 'paused' ? 'play' : 'pause'"
        :tooltip="state === 'paused' ? 'Go on reading' : 'Pause'"
        @click="emit('action', 'toggle')"
      />
      <Icon
        icon="skip-forward"
        tooltip="Skip to the next sentence"
        @click="emit('action', 'next')"
      />
      <Icon icon="settings-2" tooltip="Voice and speed" @click="emit('action', 'settings')" />
      <Icon icon="square" tooltip="Stop reading aloud" @click="emit('action', 'stop')" />
    </div>
  </div>
</template>

<script setup lang="ts">
/** What can be done while a book is read aloud: back, pause or go on, skip, voice, stop. */
import Icon from '../obsidian/Icon.vue'

defineProps<{
  state: 'playing' | 'paused'
}>()

const emit = defineEmits<{
  (e: 'action', action: 'toggle' | 'stop' | 'next' | 'prev' | 'settings'): void
}>()
</script>

<style lang="scss">
.abele-book-speech {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--size-4-2);
  padding: 0 var(--size-4-3);
  border-top: 1px solid var(--background-modifier-border);
  background-color: var(--background-primary);

  &__label {
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
  }

  &__actions {
    display: flex;
    align-items: center;
    gap: var(--size-4-1);
  }
}
</style>
