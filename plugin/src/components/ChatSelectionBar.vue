<template>
  <div
    v-if="shown"
    ref="bar"
    class="abele-chat-selection"
    :class="{ 'abele-chat-selection_placed': placed }"
    :style="{ top: `${place.top}px`, left: `${place.left}px` }"
    @pointerdown="onPress"
    @mousedown.prevent
  >
    <Button
      text="Ask here"
      icon="message-circle-plus"
      tooltip="Start a comment on the selected words, kept with them in this chat"
      @click="ask"
    />
    <div v-if="shown.highlight" class="abele-chat-selection__colors" aria-label="Highlight colour">
      <Button
        v-for="color in HIGHLIGHT_COLORS"
        :key="color"
        text="ab"
        :data-highlight-color="color"
        :aria-label="`Highlight in ${color}`"
        :tooltip="`Highlight in ${color}`"
        @click="highlight(color)"
        ><span :class="`abele-highlight abele-highlight--${color}`">ab</span></Button
      >
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from 'vue'
import { Platform } from 'obsidian'
import Button from './obsidian/Button.vue'
import { HIGHLIGHT_COLORS, type HighlightColor } from '@/reader/highlights'
import { selectionAnchor } from '@/ai/messageComments'
import { SettledSelection } from '@/helpers/settledSelection'
import { placeSelectionBar } from '@/helpers/selectionBarPlace'

/**
 * "Ask here" over words selected in a chat, on a phone or a tablet. A computer has it in the
 * right-click menu of the words; a touch screen's long press is what selects, so a menu there
 * jumped up under the finger before the words were chosen. This bar waits until the finger is
 * lifted and the words — handles included — have stopped moving, and sits under them, clear of
 * the handles and of the system's own menu.
 *
 * Only words inside one message a comment can be kept on count: the message marks its text
 * with `data-ask-message`.
 */
const props = defineProps<{
  /** The chat's scrolling list of messages. The bar is drawn beside it, in its parent. */
  scroller: HTMLElement
}>()

const emit = defineEmits<{
  (e: 'ask', messageId: string, quote: string, start: number): void
  (e: 'highlight', messageId: string, quote: string, start: number, color: HighlightColor): void
}>()

interface Asked {
  id: string
  quote: string
  start: number
  range: Range
  highlight: boolean
}

const shown = shallowRef<Asked | null>(null)
const bar = ref<HTMLElement>()
const place = reactive({ top: 0, left: 0 })
const placed = ref(false)
const doc = props.scroller.ownerDocument

/** The words selected now, if they lie inside one message that can be asked about. */
function read(): Asked | null {
  const selection = doc.getSelection()
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null
  const range = selection.getRangeAt(0)
  const start = range.startContainer
  const el = (
    start.nodeType === 1 ? (start as Element) : start.parentElement
  )?.closest<HTMLElement>('[data-ask-message]')
  if (!el || !props.scroller.contains(el)) return null
  const anchor = selectionAnchor(el, range)
  if (!anchor) return null
  return {
    id: el.dataset.askMessage,
    ...anchor,
    range,
    highlight: el.dataset.highlightReply === 'true',
  }
}

async function position() {
  const asked = shown.value
  const el = bar.value
  const frameEl = props.scroller.parentElement
  if (!asked || !el || !frameEl) return
  const frame = frameEl.getBoundingClientRect()
  const view = props.scroller.getBoundingClientRect()
  const words = asked.range.getBoundingClientRect()
  // Scrolled out of sight: nothing to point at until it is back.
  if (words.bottom < view.top || words.top > view.bottom) {
    placed.value = false
    return
  }
  const at = placeSelectionBar(
    { top: words.top - frame.top, bottom: words.bottom - frame.top, left: words.left - frame.left },
    { width: el.offsetWidth, height: el.offsetHeight },
    { width: frameEl.clientWidth, top: view.top - frame.top, bottom: view.bottom - frame.top },
    true
  )
  place.top = at.top
  place.left = at.left
  placed.value = true
  await nextTick()
}

/** A press on the bar lets a finger's selection go before the click: the words are kept. */
let pressing = false
function onPress() {
  pressing = true
  doc.defaultView?.setTimeout(() => (pressing = false), 600)
}

function ask() {
  const asked = shown.value
  pressing = false
  shown.value = null
  if (asked) emit('ask', asked.id, asked.quote, asked.start)
}

function highlight(color: HighlightColor) {
  const asked = shown.value
  pressing = false
  shown.value = null
  if (asked?.highlight) emit('highlight', asked.id, asked.quote, asked.start, color)
  doc.getSelection()?.removeAllRanges()
}

let watcher: SettledSelection | null = null
let frame = 0
const onScroll = () => {
  if (!shown.value || frame) return
  frame = window.requestAnimationFrame(() => {
    frame = 0
    void position()
  })
}

onMounted(() => {
  if (!Platform.isMobile) return
  watcher = new SettledSelection(doc, {
    settled: () => {
      const asked = read()
      shown.value = asked
      placed.value = false
      if (asked) void nextTick(position)
    },
    cleared: () => {
      if (!pressing) shown.value = null
    },
    ignore: (node) => !!bar.value?.contains(node),
  })
  props.scroller.addEventListener('scroll', onScroll, { passive: true })
})

onBeforeUnmount(() => {
  watcher?.destroy()
  props.scroller.removeEventListener('scroll', onScroll)
  if (frame) window.cancelAnimationFrame(frame)
})
</script>

<style lang="scss">
.abele-chat-selection {
  position: absolute;
  z-index: var(--layer-popover);
  display: flex;
  flex-wrap: wrap;
  max-width: calc(100% - var(--size-4-2));
  gap: var(--size-4-1);
  padding: var(--size-4-1);
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-s);
  visibility: hidden;
  user-select: none;
  -webkit-user-select: none;

  &__colors {
    display: flex;
    flex-wrap: wrap;
    gap: var(--size-2-1);
  }

  &_placed {
    visibility: visible;
  }
}
</style>
