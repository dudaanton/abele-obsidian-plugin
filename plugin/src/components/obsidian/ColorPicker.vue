<template>
  <div ref="containerEl" class="abele-obsidian-color-picker" />
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { ColorComponent } from 'obsidian'

const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  (e: 'update:model-value', value: string): void
}>()

const containerEl = ref<HTMLElement | null>(null)
let colorComponent: ColorComponent | null = null

onMounted(() => {
  if (!containerEl.value) return
  colorComponent = new ColorComponent(containerEl.value)
  colorComponent.setValue(props.modelValue)
  colorComponent.onChange((value) => {
    emit('update:model-value', value)
  })
})

watch(
  () => props.modelValue,
  (val) => {
    if (colorComponent && colorComponent.getValue() !== val) {
      colorComponent.setValue(val)
    }
  }
)

onUnmounted(() => {
  colorComponent = null
})
</script>
