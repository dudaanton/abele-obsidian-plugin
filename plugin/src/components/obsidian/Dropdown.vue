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
/**
 * Obsidian sizes a dropdown by cloning the select into `.dropdown.is-measuring`, which it
 * leaves in the DOM absolutely positioned with an explicit `left`. Without a positioned
 * ancestor here that offset resolves against a container far up the tree, so the clone lands
 * a few hundred pixels past the pane's right edge and gives the whole settings tab a
 * horizontal scrollbar. Positioning the wrapper makes it the clone's containing block; the
 * clip keeps the clone from widening anything.
 */
.abele-obsidian-dropdown {
  position: relative;
  overflow: hidden;

  .dropdown {
    width: 100%;
    min-width: 0;
    max-width: 100%;
    text-overflow: ellipsis;
  }
}
</style>
