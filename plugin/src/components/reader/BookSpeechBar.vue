<template>
  <div
    class="abele-book-speech"
    role="toolbar"
    :aria-label="t('settings.components.reader.ReaderSettingsForm.reading_aloud.044c9986')"
    data-ignore-swipe="true"
  >
    <span class="abele-book-speech__label">{{
      state === 'paused'
        ? t('settings.sync.presentation.e159b06187d369a0')
        : t('settings.components.reader.ReaderSettingsForm.reading_aloud.044c9986')
    }}</span>
    <div class="abele-book-speech__actions">
      <Icon
        icon="skip-back"
        :tooltip="t('streamC.bd07513853a62229')"
        @click="emit('action', 'prev')"
      />
      <Icon
        :icon="state === 'paused' ? 'play' : 'pause'"
        :tooltip="
          state === 'paused'
            ? t('streamC.98eaab7498a65aec')
            : t('settings.SyncSettings.pause.858e4ba7')
        "
        @click="emit('action', 'toggle')"
      />
      <Icon
        icon="skip-forward"
        :tooltip="t('streamC.da9e33675fd2160c')"
        @click="emit('action', 'next')"
      />
      <Icon
        icon="settings-2"
        :tooltip="t('streamC.19f86453b60855d5')"
        @click="emit('action', 'settings')"
      />
      <Icon
        icon="square"
        :tooltip="t('streamC.a6c798b8abab1275')"
        @click="emit('action', 'stop')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'

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
