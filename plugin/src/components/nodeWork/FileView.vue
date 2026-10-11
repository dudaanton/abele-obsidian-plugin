<template>
  <div class="abele-file-view" @contextmenu="onMenu">
    <Diff
      v-if="mode === 'diff' && change"
      :text-left="change.before"
      :text-right="change.after"
      :layout="layout"
      class="abele-file-view__card"
    >
      <template #title>
        <span class="abele-file-view__title">
          <ChangeCodes :change="change" />
          <span class="abele-file-view__path"
            >{{ change.from ? `${change.from} → ` : '' }}{{ path }}</span
          >
          <span v-if="change.when" class="abele-file-view__when">{{ change.when }}</span>
        </span>
      </template>
    </Diff>

    <div v-else class="abele-file-view__card abele-file-view__file">
      <div class="abele-file-view__header">
        <span class="abele-file-view__title">
          <ChangeCodes v-if="change" :change="change" />
          <span class="abele-file-view__path">{{ path }}</span>
          <span v-if="change?.when" class="abele-file-view__when">{{ change.when }}</span>
        </span>
        <span class="abele-file-view__size">{{ plural(lines.length, 'line') }}</span>
      </div>
      <div class="abele-file-view__body" :style="{ '--abele-file-view-digits': digits }">
        <div v-for="(line, i) in lines" :key="i" class="abele-file-view__line">
          <span class="abele-file-view__number" aria-hidden="true">{{ i + 1 }}</span
          ><span class="abele-file-view__text">{{ line }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// A file of the node in the main area. A changed file opens on its comparison, the way a commit
// page does; the whole file is one switch away in the view's header, beside opening it in the
// code editor and the arrows to the previous and next changed file. A selection, or the whole
// file, goes to a chat from the context menu, as in a note.
import { computed } from 'vue'
import Diff from '../Diff.vue'
import ChangeCodes from './ChangeCodes.vue'
import { plural } from './codes'
import type { FileChange } from './types'

const props = withDefaults(
  defineProps<{
    path: string
    /** The file as it is now; the last version, for a deleted file. */
    text: string
    change?: FileChange
    mode?: 'diff' | 'file'
    layout?: 'unified' | 'split'
  }>(),
  { change: undefined, mode: 'diff', layout: 'unified' }
)

const emit = defineEmits<{
  /** The context menu, with the selected text, or empty for the whole file. */
  (e: 'menu', event: MouseEvent, selection: string): void
}>()

const lines = computed(() => props.text.split('\n'))
const digits = computed(() => String(lines.value.length).length)

function onMenu(e: MouseEvent) {
  e.preventDefault()
  emit('menu', e, window.getSelection()?.toString() ?? '')
}
</script>

<style lang="scss">
.abele-file-view {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-4);
  min-width: 0;
}
.abele-file-view__title {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: var(--size-4-2);
  min-width: 0;
}
.abele-file-view__path {
  min-width: 0;
  overflow: hidden;
  color: var(--text-normal);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.abele-file-view__when {
  flex: 0 0 auto;
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
}

// The whole file in the same card as the comparison: header band, line numbers, monospace.
.abele-file-view__file {
  min-width: 0;
  border: var(--border-width) solid var(--background-modifier-border);
  border-radius: var(--radius-l);
  overflow: hidden;
  background-color: var(--background-primary);
  font-size: var(--font-ui-small);
  line-height: var(--line-height-normal);
}
.abele-file-view__header {
  position: sticky;
  top: 0;
  display: flex;
  align-items: center;
  gap: var(--size-4-3);
  padding: var(--size-4-2) var(--size-4-3);
  border-bottom: var(--border-width) solid var(--background-modifier-border);
  background-color: var(--background-secondary);
}
.abele-file-view__size {
  flex: 0 0 auto;
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
}
.abele-file-view__body {
  padding-block: var(--size-4-2);
}
.abele-file-view__line {
  display: flex;
  padding: var(--size-2-1) var(--size-4-3);
}
.abele-file-view__number {
  flex: 0 0 auto;
  width: calc(var(--abele-file-view-digits) * 1ch);
  margin-inline-end: var(--size-4-3);
  color: var(--text-faint);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
  text-align: end;
  user-select: none;
}
.abele-file-view__text {
  min-width: 0;
  color: var(--text-normal);
  font-family: var(--font-monospace);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
@container (max-width: 30em) {
  .abele-file-view__title {
    flex-wrap: wrap;
  }
  .abele-file-view__path {
    flex: 1 1 12ch;
    white-space: normal;
    overflow: visible;
    overflow-wrap: anywhere;
  }
  .abele-file-view__when {
    flex-basis: 100%;
    color: var(--text-muted);
    font-weight: var(--font-normal);
  }
  .abele-file-view__number {
    display: none;
  }
}
.abele-file-view {
  container-type: inline-size;
}
</style>
