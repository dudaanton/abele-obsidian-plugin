<template>
  <ObsidianModal :title="title" @close="emit('close')">
    <div class="abele-confirm">
      <p class="abele-confirm__message">{{ message }}</p>

      <div class="abele-confirm__actions">
        <Button text="Cancel" :tooltip="cancelTooltip" @click="emit('close')" />
        <Button :text="confirmText" warning :tooltip="confirmTooltip" @click="onConfirm" />
      </div>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import ObsidianModal from './Modal.vue'
import Button from './Button.vue'

/**
 * Asks before something is destroyed.
 *
 * Deliberately not `window.confirm`: that dialog is the operating system's, ignores the
 * theme, and blocks the whole app — including the separate window settings can open in.
 */
withDefaults(
  defineProps<{
    title: string
    /** What will be lost, named. */
    message: string
    confirmText?: string
    confirmTooltip?: string
    cancelTooltip?: string
  }>(),
  {
    confirmText: 'Delete',
    confirmTooltip: 'Go ahead and delete it',
    cancelTooltip: 'Close this and change nothing',
  }
)

const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'close'): void
}>()

function onConfirm(): void {
  emit('confirm')
  emit('close')
}
</script>

<style lang="scss">
.abele-confirm__message {
  margin: 0 0 var(--size-4-4);
  overflow-wrap: anywhere;
}

.abele-confirm__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--size-4-2);
}
</style>
