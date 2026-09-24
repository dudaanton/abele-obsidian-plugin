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
import { LINE_CONTEXT, pinIntoView } from '@/github/scrollTo'

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
let unpin = () => {}

const draw = async () => {
  await nextTick()
  unpin()
  viewer?.destroy()
  viewer = null
  if (!editorEl.value) return
  const drawn = mountCode(editorEl.value, props.text, props.path, props.range)
  viewer = drawn
  if (props.range) unpin = pinIntoView(editorEl.value, () => drawn.targetTop(), LINE_CONTEXT)
}

onMounted((): void => void draw())
// A link to the same lines again is a new range object: it scrolls back to them.
watch(
  () => [props.text, props.range],
  (): void => void draw()
)
onBeforeUnmount(() => {
  unpin()
  viewer?.destroy()
})
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
