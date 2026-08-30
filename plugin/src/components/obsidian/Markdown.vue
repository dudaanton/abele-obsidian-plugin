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

/**
 * Which render is the current one.
 *
 * Rendering goes through Obsidian and takes as long as it takes, while the text it was asked
 * about can change again meanwhile — a streamed reply changes it on every token. Without this
 * an earlier render finishing late writes its older text over a newer one.
 */
let generation = 0

const renderContent = async () => {
  if (!target.value || !component) return

  const mine = ++generation
  // Built away from the page and swapped in whole. Emptying the element first left it with no
  // height until the render landed, which in a chat being streamed into collapses the scroll
  // range several times a second: the browser clamps the reader's position and drags them
  // down, and they cannot read what has already arrived until the reply ends.
  const next = createDiv()

  await MarkdownRenderer.render(
    GlobalStore.getInstance().app,
    props.text || '',
    next,
    props.filePath || '',
    component
  )

  if (mine !== generation || !target.value) return

  target.value.empty()
  while (next.firstChild) target.value.appendChild(next.firstChild)
}

onMounted(() => {
  component = new Component()
  component.load()
  void renderContent()
})

/**
 * One render per burst, and one that stops when the component does.
 *
 * A stream changes the text faster than a render takes, and every change used to queue a
 * render of its own that nothing could call off — so a reply arriving in fifty tokens left
 * fifty renders racing into the same element, and any of them still pending when the chat
 * closed fired at an element that had gone.
 */
let renderTimer = 0
const win = () => target.value?.win ?? window

watch(
  () => [props.text, props.filePath],
  () => {
    win().clearTimeout(renderTimer)
    renderTimer = win().setTimeout(() => void renderContent(), 0)
  },
  { deep: true }
)

onUnmounted(() => {
  win().clearTimeout(renderTimer)
  generation++
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
