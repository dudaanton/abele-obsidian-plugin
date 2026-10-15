<template>
  <!-- Finding words on the canvas in Obsidian's own find bar, the one a note has: the field with
       its count, the steps to the previous and next match, and a way out. -->
  <div ref="root" class="document-search-container abele-canvas-find" @keydown.stop>
    <div class="document-search">
      <div class="document-search-input abele-canvas-find__field" :class="{ 'mod-no-match': !!query && !matches.length }">
        <Search
          ref="field"
          :model-value="query"
          label="Find on the canvas"
          placeholder="Find on the canvas…"
          autofocus
          @update:model-value="change"
          @keydown="key"
        />
        <div v-if="query" class="document-search-count">
          {{ matches.length ? `${at + 1} / ${matches.length}` : 'No results' }}
        </div>
      </div>
      <div class="document-search-buttons">
        <Icon icon="arrow-up" tooltip="Previous match (Shift+Enter)" :disabled="!matches.length" @click="step(-1)" />
        <Icon icon="arrow-down" tooltip="Next match (Enter)" :disabled="!matches.length" @click="step(1)" />
        <Icon icon="x" tooltip="Close (Esc)" @click="close" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { CanvasEditor } from '@/canvas/Editor'
import type { CanvasViewer } from '@/canvas/Viewer'
import { findOnCanvas } from '@/canvas/core/find'
import Search from '../obsidian/Search.vue'
import Icon from '../obsidian/Icon.vue'

const props = defineProps<{ editor: CanvasEditor; viewer: CanvasViewer; tick: number }>()
const emit = defineEmits<{ (e: 'height', value: number): void }>()
/** The bar's height, for the column of zoom and undo to stand clear under it. */
const root = ref<HTMLElement>()
let size: ResizeObserver | undefined
onMounted(() => {
  if (!root.value || typeof ResizeObserver === 'undefined') return
  size = new ResizeObserver(() => emit('height', root.value?.offsetHeight ?? 0))
  size.observe(root.value)
})
onBeforeUnmount(() => {
  size?.disconnect()
  emit('height', 0)
})
const c = props.editor.controls
const query = ref('')
const at = ref(0)
/** What a note on the canvas says, as its card shows it. */
const said = (id: string) => props.viewer.scroller(id)?.textContent ?? undefined
const matches = computed(() => (props.tick, findOnCanvas(props.viewer.graph, query.value, said)))
function change(value: string) {
  query.value = value
  at.value = 0
  if (matches.value.length) c.show(matches.value[0].id)
}
function step(by: number) {
  const n = matches.value.length
  if (!n) return
  at.value = (at.value + by + n) % n
  c.show(matches.value[at.value].id)
}
function close() {
  c.setFinding(false)
}
function key(e: KeyboardEvent) {
  if (e.isComposing) return
  if (e.key === 'Enter') {
    e.preventDefault()
    step(e.shiftKey ? -1 : 1)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    close()
  }
}
</script>

<style lang="scss">
// Under the tools' row, across the canvas's top, as a note's find bar stands under its header.
.abele-canvas-find.document-search-container {
  position: absolute;
  inset-inline: 0;
  top: var(--abele-canvas-bar, 0px);
  margin: 0;
  padding-inline: var(--size-4-4);
  background-color: var(--background-primary);
  border-bottom: var(--border-width) solid var(--background-modifier-border);
}
.abele-canvas-find__field {
  position: relative;
  // The count stands left of the field's clear button, as in a note's find bar.
  .document-search-count {
    inset-inline-end: var(--size-4-8);
  }
  .abele-obsidian-search {
    width: 100%;
  }
}
</style>
