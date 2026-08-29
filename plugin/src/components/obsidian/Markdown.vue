<template>
  <div
    ref="target"
    class="abele-markdown"
    :class="{ 'markdown-rendered': asDocument }"
    @click="handleClick"
  ></div>
</template>

<script setup lang="ts">
import { GlobalStore } from '@/stores/GlobalStore'
import { Component, MarkdownRenderer } from 'obsidian'
import { onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps<{
  text: string
  filePath?: string
  /**
   * For a whole document rather than a line or two of prose.
   *
   * `MarkdownRenderer` produces the markup of Obsidian's reading view, but the styling for it
   * — code blocks, tables, heading spacing — hangs off `.markdown-rendered`, which nothing
   * adds for us. Without it a code block arrives with no background and its copy button
   * dropped underneath as a block of its own. It is opt-in because those same rules bring
   * reading-view margins, which are wrong for markdown sitting inside a row or a card.
   */
  asDocument?: boolean
}>()

let component: Component | null = null

const target = ref<HTMLElement>()

const handleClick = (event: MouseEvent) => {
  const el = (event.target as HTMLElement).closest('a.internal-link') as HTMLElement | null
  if (el) {
    event.preventDefault()
    const href = el.getAttribute('data-href')
    if (href) {
      GlobalStore.getInstance().app.workspace.openLinkText(href, props.filePath || '')
    }
    return
  }
  emit('click')
}

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
  component.load()
  renderContent()
})

watch(
  () => [props.text, props.filePath],
  () => {
    window.setTimeout(() => {
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
