<template>
  <ObsidianModal :title="title" close-in-footer @close="emit('close')">
    <p class="abele-confirm__message">{{ message }}</p>
    <template #footer>
      <Button text="Cancel" :tooltip="cancelTooltip" @click="emit('close')" />
      <Button
        :text="confirmText"
        :warning="!readOnly"
        :disabled="readOnly"
        :tooltip="confirmTooltip"
        @click="onConfirm"
      />
    </template>
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
const props = withDefaults(
  defineProps<{
    title: string
    /** What will be lost, named. */
    message: string
    confirmText?: string
    confirmTooltip?: string
    cancelTooltip?: string
    readOnly?: boolean
  }>(),
  {
    readOnly: false,
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
  if (props.readOnly) return
  emit('confirm')
  emit('close')
}
</script>

<style lang="scss">
.abele-confirm__message {
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
