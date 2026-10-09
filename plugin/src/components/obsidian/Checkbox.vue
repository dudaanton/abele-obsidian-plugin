<template>
  <div
    class="checkbox-container abele-checkbox"
    :class="{ 'is-enabled': isEnabled }"
    role="checkbox"
    tabindex="0"
    :aria-checked="isEnabled"
    @click.stop="emit('toggle')"
    @keydown="onKeydown"
    @keyup="onKeyup"
  >
    <span
      v-if="Platform.isMobile"
      class="checkbox-container abele-checkbox__paint"
      :class="{ 'is-enabled': isEnabled }"
      aria-hidden="true"
    />
  </div>
</template>

<script setup lang="ts">
import { Platform } from 'obsidian'
import './designKit.css'
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

<style>
.abele-checkbox__paint {
  display: none;
}
body.is-phone .abele-checkbox {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: auto;
  min-height: var(--abele-touch-min);
  padding-block: var(--size-4-2);
  background: transparent;
}
body.is-phone .abele-checkbox::after {
  display: none;
}
body.is-phone .abele-checkbox > .abele-checkbox__paint {
  display: block;
  flex: 0 0 auto;
  pointer-events: none;
}
</style>
