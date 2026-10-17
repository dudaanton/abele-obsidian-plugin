<template>
  <!-- Over words selected in code or a file, the way a note's selection gets its menu: glyphs for
       what is done with them, named in their tooltips. In the body, as Obsidian's own menus are:
       a pane's containment would otherwise shift where a fixed bar lands. -->
  <Teleport v-if="picked" to="body">
    <div
      ref="bar"
      class="abele-selection-bar"
      :class="{ 'abele-selection-bar_placed': placed }"
      role="toolbar"
      :aria-label="t('kit.selection')"
      :style="{ top: `${at.top}px`, left: `${at.left}px` }"
      @pointerdown="onPress"
      @mousedown.prevent
    >
      <Icon
        v-for="a in actions"
        :key="a.id"
        :icon="a.icon"
        :tooltip="a.tooltip"
        :data-action="a.id"
        @click="pick(a.id)"
      />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
// Words selected inside `scope` — part of a line, several lines — and what can be done with them:
// ask the agent, add them to the open chat, insert them into a note, whatever the host adds. The
// bar says which action was picked, with the words and, inside a code view, the lines they span.
// It waits for a drag or the phone's handles to settle, stands above the words with a mouse and
// under them with a finger, clear of the system's own menu, and a right-click offers the same.
import { nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from 'vue'
import { Platform } from 'obsidian'
import { EditorView } from '@codemirror/view'
import { SettledSelection } from '@/helpers/settledSelection'
import { placeSelectionBar } from '@/helpers/selectionBarPlace'
import Icon from './Icon.vue'

import type { SelectionAction } from './selectionActions'
export type { SelectionAction }

/** What was selected: the words, and in a code view the first and last line they touch. */
export interface Selected {
  text: string
  from?: number
  to?: number
}

const props = defineProps<{
  /** The element whose selections the bar is for. */
  scope: HTMLElement | undefined
  actions: SelectionAction[]
  /** Only words inside an element matching this count — `.cm-editor` for code alone. */
  within?: string
  /** What above the words the bar must not cover, as a selector inside the scope: a header. */
  under?: string
}>()

const emit = defineEmits<{ (e: 'pick', action: string, selected: Selected): void }>()

const bar = ref<HTMLElement>()
const picked = shallowRef<Selected | null>(null)
const at = reactive({ top: 0, left: 0 })
/** Measured and moved into place: until then it is drawn, but not seen. */
const placed = ref(false)
const touch = Platform.isMobile

/** The lines a range spans, when it lies in a CodeMirror view. */
function lines(range: Range): Pick<Selected, 'from' | 'to'> {
  const host = range.startContainer.parentElement?.closest('.cm-editor')
  const view = host ? EditorView.findFromDOM(host as HTMLElement) : null
  if (!view) return {}
  try {
    const doc = view.state.doc
    const from = doc.lineAt(view.posAtDOM(range.startContainer, range.startOffset)).number
    const to = doc.lineAt(view.posAtDOM(range.endContainer, range.endOffset)).number
    return { from, to }
  } catch {
    return {}
  }
}

/** The selection, if it is words inside the scope. */
function read(): { selected: Selected; range: Range } | null {
  const sel = window.getSelection()
  const scope = props.scope
  if (!sel || !scope || !sel.rangeCount || sel.isCollapsed) return null
  const range = sel.getRangeAt(0)
  if (!scope.contains(range.startContainer) || !scope.contains(range.endContainer)) return null
  if (props.within) {
    const inside = (n: Node) => (n.instanceOf(Element) ? n : n.parentElement)?.closest(props.within)
    if (!inside(range.startContainer) || !inside(range.endContainer)) return null
  }
  const text = sel.toString().trim()
  return text ? { selected: { text, ...lines(range) }, range } : null
}

/**
 * The highest the bar may stand: under what the caller names as not to be covered — a file's
 * header over its first line — and not past the top of the pane the words scroll in.
 */
function ceiling(range: Range, words: DOMRect): number {
  let top = 0
  if (props.under && props.scope)
    for (const el of Array.from(props.scope.querySelectorAll(props.under))) {
      const box = el.getBoundingClientRect()
      if (box.bottom <= words.top + 1) top = Math.max(top, box.bottom)
    }
  const start = range.startContainer
  for (
    let el: Element | null = start.instanceOf(Element) ? start : start.parentElement;
    el && el !== document.body;
    el = el.parentElement
  ) {
    const overflow = getComputedStyle(el).overflowY
    if (overflow === 'auto' || overflow === 'scroll') {
      top = Math.max(top, el.getBoundingClientRect().top)
      break
    }
  }
  return top
}

async function position(range: Range) {
  placed.value = false
  await nextTick()
  const el = bar.value
  if (!el) return
  const box = range.getBoundingClientRect()
  const spot = placeSelectionBar(
    { top: box.top, bottom: box.bottom, left: box.left },
    { width: el.offsetWidth, height: el.offsetHeight },
    { width: window.innerWidth, top: ceiling(range, box), bottom: window.innerHeight },
    touch
  )
  at.top = spot.top
  at.left = spot.left
  placed.value = true
}

let pressing = false
/** A press on the bar must not count as the selection going: a finger's tap lets it go first. */
function onPress() {
  pressing = true
  window.setTimeout(() => (pressing = false), 600)
}

function update() {
  if (pressing) return
  const now = read()
  picked.value = now?.selected ?? null
  if (now) void position(now.range)
}

function pick(action: string) {
  const p = picked.value
  pressing = false
  picked.value = null
  if (!p) return
  emit('pick', action, p)
  window.getSelection()?.removeAllRanges()
}

let watcher: SettledSelection | null = null
const onScroll = () => {
  const now = picked.value && read()
  if (now) void position(now.range)
}
onMounted(() => {
  watcher = new SettledSelection(document, {
    settled: update,
    cleared: () => {
      if (!pressing) picked.value = null
    },
    ignore: (node) => !!bar.value?.contains(node),
  })
  document.addEventListener('scroll', onScroll, true)
})
onBeforeUnmount(() => {
  watcher?.destroy()
  document.removeEventListener('scroll', onScroll, true)
})
</script>

<style lang="scss">
// Fixed to the window, so a pane's clipping never cuts it; it follows the words on scroll.
.abele-selection-bar {
  position: fixed;
  z-index: var(--layer-popover);
  display: flex;
  align-items: center;
  gap: var(--size-2-2);
  padding: var(--size-2-2);
  border: var(--border-width) solid var(--background-modifier-border);
  border-radius: var(--radius-m);
  background-color: var(--background-primary);
  box-shadow: var(--shadow-s);
  visibility: hidden;
  user-select: none;
  -webkit-user-select: none;

  &_placed {
    visibility: visible;
  }
}
</style>
