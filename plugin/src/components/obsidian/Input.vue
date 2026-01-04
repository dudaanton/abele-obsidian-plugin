<template>
  <component
    :is="asTextArea ? 'textarea' : 'input'"
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
.abele-obsidian-input {
  input {
    width: 100%;
    min-width: 150px;
  }
}
</style>
