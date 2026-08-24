<template>
  <button
    ref="el"
    class="abele-obsidian-button"
    :class="{ 'mod-cta': accent, 'mod-warning': warning }"
    :disabled="disabled"
    @click="$emit('click')"
  >
    <Icon v-if="icon" :icon="icon" class="abele-obsidian-button__icon" />
    {{ text }}
  </button>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { setTooltip } from 'obsidian'
import Icon from './Icon.vue'

const props = defineProps<{
  text: string
  icon?: string
  accent?: boolean
  /** For an action that destroys something. */
  warning?: boolean
  disabled?: boolean
  /** What pressing this does, in a few words. Every button carries one — see docs/Design.md. */
  tooltip?: string
}>()

defineEmits<{
  (e: 'click'): void
}>()

const el = ref<HTMLElement>()

// Obsidian's own tooltip rather than the browser's `title`: it is styled with the theme and
// appears without the second-long delay a native tooltip has.
const applyTooltip = () => {
  if (el.value) setTooltip(el.value, props.tooltip ?? '')
}

onMounted(applyTooltip)
watch(() => props.tooltip, applyTooltip)
</script>

<style lang="scss">
.abele-obsidian-button {
  display: flex;
  gap: var(--size-4-2);

  .abele-obsidian-button__icon {
    padding: 0;
  }
}
</style>
