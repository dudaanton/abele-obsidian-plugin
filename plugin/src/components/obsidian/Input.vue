<template>
  <component
    :is="asTextArea ? 'textarea' : 'input'"
    class="abele-obsidian-input"
    :class="{ 'abele-obsidian-input_multiline': asTextArea }"
    :value="modelValue"
    type="text"
    :placeholder="placeholder"
    :disabled="disabled"
    @input="(e: InputEvent) => emit('update:model-value', (e.target as HTMLInputElement).value)"
  />
</template>

<script setup lang="ts">
defineProps<{
  modelValue?: string
  disabled?: boolean
  placeholder?: string
  asTextArea?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:model-value', value: string): void
}>()
</script>

<style lang="scss">
/**
 * The class goes on the element itself. It used to sit on a wrapper that this component never
 * rendered, so the rules below never applied and every field fell back to the browser's
 * intrinsic width — which is what pushed narrow settings panes sideways.
 */
.abele-obsidian-input {
  width: 100%;
  min-width: 0;
  max-width: 100%;
}

.abele-obsidian-input_multiline {
  min-height: 6em;
  resize: vertical;
}
</style>
