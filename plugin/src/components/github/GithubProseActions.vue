<template>
  <div
    v-if="shown"
    ref="bar"
    class="abele-github-prose"
    :class="{ 'abele-github-prose_placed': placed }"
    :style="{ top: `${place.top}px`, left: `${place.left}px` }"
    data-find-skip
    data-prose-skip
    @pointerdown="onPress"
    @mousedown.prevent
  >
    <Button
      v-if="linker.canAsk()"
      text="Ask here"
      icon="message-circle-plus"
      tooltip="Open a new chat with a link to where this is and the selected words quoted in its input"
      @click="ask"
    />
    <Icon icon="link" :tooltip="`Copy a link to ${shown.where}`" with-bg @click="copyLink" />
    <Icon
      icon="quote"
      tooltip="Insert the selected words into the note you were last in, as a quote with a link to where they are from"
      with-bg
      @click="insertQuote"
    />
  </div>
</template>

<script setup lang="ts">
import { inject, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { Menu, Platform } from 'obsidian'
import Button from '../obsidian/Button.vue'
import Icon from '../obsidian/Icon.vue'
import { LINKER } from '@/github/linking'
import { SCREEN } from '@/github/screen'
import { proseQuote, proseSnippet, readProse, type ProseSelection } from '@/github/proseSelection'

/**
 * The small bar over words selected in a GitHub tab's prose: ask about them in a new chat, copy a
 * link to the comment they are in, or quote them into the note. The same three are in the menu a
 * right-click on the selection opens.
 *
 * A phone's own menu over a selection cannot be given an item, so there the bar is the way in:
 * it sits below the selection, clear of the handles and of the system's menu above it, and waits
 * for the handles to stop moving before it shows.
 *
 * What the selection is part of — which comment, or the item — is `proseSelection`'s. The tab's
 * screen keeps the last one for `github_views`, also once the person has gone to the chat to ask.
 */
const props = defineProps<{
  /** The tab's own element: only a selection inside it counts. */
  root: HTMLElement
}>()

// Both are provided by the tab this bar is drawn in.
const linker = inject(LINKER)
const screen = inject(SCREEN)

const shown = shallowRef<ProseSelection | null>(null)
const bar = ref<HTMLElement>()
const place = reactive({ top: 0, left: 0 })
/** Measured and moved into place: until then it is drawn, but not seen. */
const placed = ref(false)

const doc = props.root.ownerDocument
const touch = Platform.isMobile

/** What text in no comment is, by what the tab shows. */
const pageName = () =>
  screen.kind === 'commit' ? 'the commit message' : screen.kind === 'blob' ? 'the file' : 'the page'

/** The selection as it is now, if it is prose in this tab; `inside` whether it is in the tab at all. */
function read(): { prose: ProseSelection | null; range: Range | null; inside: boolean } {
  const selection = doc.getSelection()
  if (!selection || !selection.rangeCount) return { prose: null, range: null, inside: false }
  const range = selection.getRangeAt(0)
  const inside = props.root.contains(range.startContainer)
  if (!inside || selection.isCollapsed) return { prose: null, range: null, inside }
  const prose = readProse(props.root, range, selection.toString(), screen.link, pageName())
  return { prose, range, inside }
}

/** Puts the bar above the selection, or below it on a touch screen and where there is no room. */
async function position(range: Range) {
  placed.value = false
  await nextTick()
  const el = bar.value
  if (!el) return
  const box = range.getBoundingClientRect()
  const frame = props.root.getBoundingClientRect()
  const gap = 6
  // A finger's selection has handles hanging under its last line and the system's menu over it.
  const below = box.bottom - frame.top + (touch ? 36 : gap)
  const above = box.top - frame.top - el.offsetHeight - gap
  place.top = touch || above < 0 ? below : above
  const room = Math.max(0, props.root.clientWidth - el.offsetWidth)
  place.left = Math.min(Math.max(0, box.left - frame.left), room)
  placed.value = true
}

let pressing = false
let mouseDown = false
let timer: number | undefined

function update() {
  if (pressing) return
  const { prose, range, inside } = read()
  // A click back in the tab lets the words go; the chat the question is typed in does not.
  if (inside) screen.prose = prose
  shown.value = prose
  if (prose && range) void position(range)
}

/** Waits for a drag or the handles to stop before showing anything. */
function onSelectionChange() {
  const view = doc.defaultView
  if (!view) return
  if (timer !== undefined) view.clearTimeout(timer)
  // Gone at once when the selection goes, so it never floats over nothing.
  if (doc.getSelection()?.isCollapsed && !pressing) shown.value = null
  if (mouseDown) return
  timer = view.setTimeout(update, touch ? 350 : 120)
}

const onDocDown = (e: PointerEvent) => {
  if (e.pointerType === 'mouse' && e.button === 0 && !bar.value?.contains(e.target as Node))
    mouseDown = true
}
const onDocUp = (e: PointerEvent) => {
  if (e.pointerType !== 'mouse' || !mouseDown) return
  mouseDown = false
  onSelectionChange()
}

/** A press on the bar must not count as the selection going: a finger's tap lets it go first. */
function onPress() {
  pressing = true
  doc.defaultView?.setTimeout(() => (pressing = false), 600)
}

const done = () => {
  pressing = false
  shown.value = null
}

function ask() {
  const p = shown.value
  if (p) void linker.ask(p.link, proseQuote(p))
  done()
}

function copyLink() {
  const p = shown.value
  if (p) void linker.copy(p.link)
  done()
}

function insertQuote() {
  const p = shown.value
  if (p) void linker.insertSnippet(proseSnippet(p))
  done()
}

/** Right-click on selected words: the same actions, beside a plain copy. Not on a touch screen. */
function onContextMenu(e: MouseEvent) {
  if (touch) return
  const { prose } = read()
  if (!prose) return
  e.preventDefault()
  screen.prose = prose
  const menu = new Menu()
  const item = (title: string, icon: string, run: () => void) =>
    menu.addItem((i) => i.setTitle(title).setIcon(icon).onClick(run))
  item('Copy', 'copy', () => void navigator.clipboard.writeText(prose.text))
  if (linker.canAsk())
    item('Ask here', 'message-circle-plus', () => void linker.ask(prose.link, proseQuote(prose)))
  item('Copy link to this', 'link', () => void linker.copy(prose.link))
  item('Insert as quote', 'quote', () => void linker.insertSnippet(proseSnippet(prose)))
  menu.showAtMouseEvent(e)
}

onMounted(() => {
  doc.addEventListener('selectionchange', onSelectionChange)
  doc.addEventListener('pointerdown', onDocDown, true)
  doc.addEventListener('pointerup', onDocUp, true)
  props.root.addEventListener('contextmenu', onContextMenu)
})

onBeforeUnmount(() => {
  doc.removeEventListener('selectionchange', onSelectionChange)
  doc.removeEventListener('pointerdown', onDocDown, true)
  doc.removeEventListener('pointerup', onDocUp, true)
  props.root.removeEventListener('contextmenu', onContextMenu)
  if (timer !== undefined) doc.defaultView?.clearTimeout(timer)
  screen.prose = null
})

// Another item: its words are not this one's.
watch(
  () => screen.link?.url,
  () => {
    screen.prose = null
    shown.value = null
  }
)
</script>

<style lang="scss">
.abele-github-prose {
  position: absolute;
  z-index: var(--layer-popover);
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
  padding: var(--size-4-1);
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-m);
  box-shadow: var(--shadow-s);
  font-family: var(--font-interface);
  font-size: var(--font-ui-small);
  visibility: hidden;
  user-select: none;
  -webkit-user-select: none;

  &_placed {
    visibility: visible;
  }
}
</style>
