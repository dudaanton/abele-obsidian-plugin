<template>
  <div ref="target" class="abele-markdown" @click="emit('click')"></div>
</template>

<script setup lang="ts">
import { GlobalStore } from '@/stores/GlobalStore'
import { Component, MarkdownRenderer } from 'obsidian'
import { onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps<{
  text: string
  filePath?: string
}>()

let component: Component | null = null

const target = ref<HTMLElement>()

const renderContent = async () => {
  if (!target.value || !component) return

  target.value?.empty()
  await MarkdownRenderer.render(
    GlobalStore.getInstance().app,
    props.text || '',
    target.value,
    props.filePath || '',
    component
  )
}

onMounted(() => {
  component = new Component()
  renderContent()
})

watch(
  () => [props.text, props.filePath],
  () => {
    setTimeout(() => {
      renderContent()
    }, 0)
  },
  { immediate: true, deep: true }
)

onUnmounted(() => {
  component?.unload()
  component = null
})

const emit = defineEmits<{
  (e: 'click'): void
}>()
</script>

<style scoped>
.abele-markdown {
  white-space-collapse: collapse;
}
</style>
