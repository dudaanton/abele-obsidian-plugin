<template>
  <div ref="el" class="abele-obsidian-dropdown" />
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { DropdownComponent } from 'obsidian'

const props = defineProps<{
  options: { value: string; display: string }[]
  modelValue: string
}>()

const el = ref<HTMLElement>()
const dropdown = ref<DropdownComponent>()

const updateDropdown = () => {
  if (el.value) {
    el.value.empty()

    dropdown.value = new DropdownComponent(el.value)

    props.options.forEach((option) => {
      dropdown.value.addOption(option.value, option.display)
    })

    if (props.modelValue) {
      dropdown.value.setValue(props.modelValue)
    }

    dropdown.value.onChange((value) => {
      emit('update:model-value', value)
    })
  }
}

const updateValue = () => {
  if (props.modelValue !== undefined) {
    dropdown.value?.setValue(props.modelValue)
  }
}

onMounted(() => {
  updateDropdown()
})
watch(() => props.options, updateDropdown)
watch(() => props.modelValue, updateValue)

const emit = defineEmits<{
  (e: 'update:model-value', value: string): void
}>()
</script>

<style lang="scss">
.abele-obsidian-dropdown {
  .dropdown {
    width: 100%;
    min-width: 150px;
  }
}
</style>
