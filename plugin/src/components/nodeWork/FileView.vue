<template>
  <div ref="root" class="abele-file-view" @contextmenu="onMenu">
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
        <span class="abele-file-view__size">{{ plural(text.split('\n').length, 'line') }}</span>
      </div>
      <!-- The plugin's code viewer: the file's own colours, line numbers, selection, search. -->
      <div ref="code" class="abele-github-code abele-file-view__code" />
    </div>

    <!-- Over selected text, the way a note offers it: ask the agent about it, or hand it over. -->
    <SelectionToolbar
      v-if="picked"
      ref="bar"
      class="abele-file-view__selection"
      :top="picked.top"
      :left="picked.left"
    >
      <Button
        text="Ask here"
        icon="message-circle-plus"
        tooltip="Ask the agent about the selected lines"
        @click="send('ask')"
      />
      <Button
        text="Add to chat"
        icon="message-square-plus"
        tooltip="Add the selected lines to the open chat"
        @click="send('add')"
      />
    </SelectionToolbar>
  </div>
</template>

<script setup lang="ts">
// A file of the node in the main area. A changed file opens on its comparison, the way a commit
// page does; the whole file is one switch away in the view's header, beside opening it in the
// code editor and the arrows to the previous and next changed file. Selected text — in the
// comparison or in the file — gets a small bar over it to ask the agent about it or add it to the
// chat, on a phone as on a computer; the context menu offers the same.
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Platform } from 'obsidian'
import { fileSelection, type FileSelection } from './fileSelection'
import { mountCode, type CodeViewer } from '@/github/codeViewer'
import Diff from '../Diff.vue'
import Button from '../obsidian/Button.vue'
import SelectionToolbar from '../obsidian/SelectionToolbar.vue'
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
  /** Selected text to ask about in a new chat, or to add to the open one. */
  (e: 'ask', selection: FileSelection): void
  (e: 'add', selection: FileSelection): void
}>()

const root = ref<HTMLElement>()
const code = ref<HTMLElement>()
let viewer: CodeViewer | undefined
let stopped = false

async function draw() {
  picked.value = null
  await nextTick()
  if (stopped) return
  viewer?.destroy()
  viewer = undefined
  if (code.value) viewer = mountCode(code.value, props.text, props.path)
}
onMounted(draw)
watch(() => [props.text, props.path, props.mode, props.change], draw)

// The selection bar: shown while text inside this view is selected, under the selection on a
// phone (the system's own menu sits over it), over it elsewhere.
const bar = ref<InstanceType<typeof SelectionToolbar>>()
const picked = ref<{ selection: FileSelection; top: number; left: number } | null>(null)
let owner = document
let frame = window
let resize: ResizeObserver | undefined
watch(
  () => bar.value?.element,
  () => {
    if (picked.value) onSelection()
  },
  { flush: 'post' }
)
function onSelection() {
  const sel = owner.getSelection()
  const selection = root.value ? fileSelection(root.value, sel) : null
  if (!sel || !selection) {
    picked.value = null
    return
  }
  const rect = sel.getRangeAt(0).getBoundingClientRect()
  if (rect.bottom <= rect.top) {
    picked.value = null
    return
  }
  const width = bar.value?.element?.offsetWidth || 240
  const height = bar.value?.element?.offsetHeight || 36
  const phone = Platform.isPhone || owner.body.classList.contains('is-phone')
  const header = root.value?.querySelector('.abele-file-view__header, .abele-diff__header')
  const content = root.value?.querySelector('.abele-file-view__code, .abele-diff__body')
  const contentTop = Math.max(
    8,
    header?.getBoundingClientRect().bottom ?? 0,
    content?.getBoundingClientRect().top ?? 0
  )
  const above = rect.top - height - 8
  const desiredTop = phone || above < contentTop ? rect.bottom + 8 : above
  const lastTop = frame.innerHeight - height - 8
  if (lastTop < contentTop) {
    picked.value = null
    return
  }
  picked.value = {
    selection,
    // A first-line selection has no space above it inside the content, so use the space below.
    top: Math.max(contentTop, Math.min(desiredTop, lastTop)),
    left: Math.max(8, Math.min(rect.left, frame.innerWidth - width - 8)),
  }
}
onMounted(() => {
  owner = root.value?.ownerDocument ?? document
  frame = owner.defaultView ?? window
  owner.addEventListener('selectionchange', onSelection)
  frame.addEventListener('scroll', onSelection, true)
  frame.addEventListener('resize', onSelection)
  resize = new frame.ResizeObserver(onSelection)
  if (root.value) resize.observe(root.value)
  const header = root.value?.querySelector('.abele-file-view__header, .abele-diff__header')
  if (header) resize.observe(header)
})
onBeforeUnmount(() => {
  stopped = true
  owner.removeEventListener('selectionchange', onSelection)
  frame.removeEventListener('scroll', onSelection, true)
  frame.removeEventListener('resize', onSelection)
  resize?.disconnect()
  viewer?.destroy()
})

function send(kind: 'ask' | 'add') {
  if (!picked.value) return
  if (kind === 'ask') emit('ask', picked.value.selection)
  else emit('add', picked.value.selection)
  owner.getSelection()?.removeAllRanges()
  picked.value = null
}

function onMenu(e: MouseEvent) {
  e.preventDefault()
  emit('menu', e, root.value ? (fileSelection(root.value, owner.getSelection())?.text ?? '') : '')
}
</script>

<style lang="scss">
.abele-file-view {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--size-4-4);
  min-width: 0;
}
// Obsidian makes its interface unselectable and gives selection back only to a note; a file here
// is there to be read, quoted and handed to the agent, so it gives it back itself — code and
// comparison. Line numbers, signs and buttons stay out, so a drag copies the text alone.
.abele-file-view {
  user-select: text;
  -webkit-user-select: text;

  button,
  [role='button'],
  .abele-obsidian-icon,
  .cm-gutters,
  .abele-diff__gutter,
  .abele-diff__sign,
  .abele-file-view__selection {
    user-select: none;
    -webkit-user-select: none;
  }
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

// The whole file in the same card as the comparison: header band, then the code viewer.
.abele-file-view__file {
  min-width: 0;
  border: var(--border-width) solid var(--background-modifier-border);
  border-radius: var(--radius-l);
  overflow: hidden;
  background-color: var(--background-primary);
}
.abele-file-view__header {
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
.abele-file-view__code {
  font-family: var(--font-monospace);
  font-size: var(--font-ui-small);

  .cm-gutters {
    border: none;
    background-color: var(--background-primary);
    color: var(--text-faint);
  }
}
.abele-file-view {
  container-type: inline-size;
}
// A narrow pane: the path wraps rather than hides, and when it changed takes a line of its own.
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
}
</style>
