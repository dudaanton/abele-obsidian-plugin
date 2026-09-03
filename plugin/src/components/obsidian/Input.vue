<template>
  <component
    :is="asTextArea ? 'textarea' : 'input'"
    class="abele-obsidian-input"
    :class="{
      'abele-obsidian-input_multiline': asTextArea,
      'abele-obsidian-input_sized': asTextArea && rows !== undefined,
    }"
    :value="modelValue"
    type="text"
    :rows="asTextArea ? rows : undefined"
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
  /**
   * How many lines tall the field stands, for a caller that grows it with its content.
   * Ignored on a single-line input, which has no such attribute.
   */
  rows?: number
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

/**
 * A field told how many rows it stands at is being sized by its caller, so the floor a
 * free-standing textarea gets would only push it open, and a handle to drag would fight the
 * caller for the same property.
 */
.abele-obsidian-input_sized {
  min-height: auto;
  resize: none;
}
</style>
