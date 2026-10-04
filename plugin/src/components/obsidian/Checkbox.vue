<template>
  <div
    class="checkbox-container"
    :class="{ 'is-enabled': isEnabled }"
    role="checkbox"
    tabindex="0"
    :aria-checked="isEnabled"
    @click.stop="emit('toggle')"
    @keydown="onKeydown"
    @keyup="onKeyup"
  />
</template>

<script setup lang="ts">
defineProps<{
  isEnabled: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle'): void
}>()

function isActivationKey(event: KeyboardEvent): boolean {
  return event.key === ' ' || event.key === 'Enter'
}

function onKeydown(event: KeyboardEvent): void {
  if (!isActivationKey(event)) return
  event.preventDefault()
  event.stopPropagation()
  if (!event.repeat) emit('toggle')
}

function onKeyup(event: KeyboardEvent): void {
  if (!isActivationKey(event)) return
  event.preventDefault()
  event.stopPropagation()
}
</script>
