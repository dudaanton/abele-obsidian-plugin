<template>
  <div
    class="checkbox-container abele-checkbox"
    :class="{
      'is-enabled': isEnabled,
      'is-disabled': disabled,
      'mod-small': size === 'small',
      'abele-checkbox_enabled': isEnabled,
      'abele-checkbox_disabled': disabled,
      'abele-checkbox_small': size === 'small',
    }"
    role="checkbox"
    :tabindex="disabled ? -1 : 0"
    :aria-checked="isEnabled"
    :aria-disabled="disabled || undefined"
    @click.stop="toggle"
    @keydown="onKeydown"
    @keyup="onKeyup"
  >
    <span
      v-if="Platform.isMobile"
      class="checkbox-container abele-checkbox__paint"
      :class="{ 'is-enabled': isEnabled, 'is-disabled': disabled, 'mod-small': size === 'small' }"
      aria-hidden="true"
    />
  </div>
</template>

<script setup lang="ts">
import { Platform } from 'obsidian'
import './designKit.css'
// Obsidian's own switch, the toggle of its settings: what Nuxt UI calls a Switch.
const props = defineProps<{
  isEnabled: boolean
  /** Cannot be switched now; Obsidian draws it faded. */
  disabled?: boolean
  /** Obsidian's smaller switch, for a dense row. */
  size?: 'small'
}>()

const emit = defineEmits<{
  (e: 'toggle'): void
}>()

function toggle(): void {
  if (!props.disabled) emit('toggle')
}

function isActivationKey(event: KeyboardEvent): boolean {
  return event.key === ' ' || event.key === 'Enter'
}

function onKeydown(event: KeyboardEvent): void {
  if (!isActivationKey(event)) return
  event.preventDefault()
  event.stopPropagation()
  if (!event.repeat) toggle()
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
