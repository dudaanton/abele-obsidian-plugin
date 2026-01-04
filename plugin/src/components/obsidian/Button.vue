<template>
  <button
    class="abele-obsidian-button"
    :class="{ 'mod-cta': accent }"
    :disabled="disabled"
    @click="$emit('click')"
  >
    <Icon v-if="icon" :icon="icon" class="abele-obsidian-button__icon" />
    {{ text }}
  </button>
</template>

<script setup lang="ts">
import Icon from './Icon.vue'

defineProps<{
  text: string
  icon?: string
  accent?: boolean
  disabled?: boolean
}>()

defineEmits<{
  (e: 'click'): void
}>()
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
