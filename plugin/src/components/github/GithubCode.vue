<template>
  <div class="abele-github-blob">
    <div v-if="range" class="abele-github-blob__range">
      {{ range.start === range.end ? `Line ${range.start}` : `Lines ${range.start}–${range.end}` }}
      <span v-if="range.start > lineCount" class="abele-github-blob__warning">
        — the file has only {{ lineCount }} lines.
      </span>
    </div>
    <div ref="editorEl" class="abele-github-code abele-github-blob__code" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { LineRange } from '@/github/urls'
import { mountCode, type Viewer } from '@/github/codeViewer'

const props = withDefaults(
  defineProps<{
    text: string
    path: string
    range?: LineRange
  }>(),
  { range: undefined }
)

const editorEl = ref<HTMLElement>()
const lineCount = computed(() => props.text.split('\n').length)
let viewer: Viewer | null = null

const draw = async () => {
  await nextTick()
  viewer?.destroy()
  viewer = null
  if (!editorEl.value) return
  viewer = mountCode(editorEl.value, props.text, props.path, props.range)
  // After a frame: the scroll has to be measured against a laid-out pane.
  const win = editorEl.value.win ?? window
  win.requestAnimationFrame(() => viewer?.reveal())
}

onMounted((): void => void draw())
watch(
  () => [props.text, props.range?.start, props.range?.end],
  (): void => void draw()
)
onBeforeUnmount(() => viewer?.destroy())
</script>

<style lang="scss">
.abele-github-blob {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);

  &__range {
    color: var(--text-muted);
    font-size: var(--font-ui-small);
  }

  &__warning {
    color: var(--text-error);
  }

  &__code {
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m);
    overflow: hidden;
  }
}
</style>
