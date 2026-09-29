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
import { Component, Keymap, MarkdownRenderer } from 'obsidian'
import { onBeforeUnmount, onMounted, onUnmounted, ref, watch } from 'vue'
import { offer, recordInto, stopRecording, take, type Part } from './markdownParts'

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
  /**
   * For text still being written — a reply streaming in. What was drawn is handed to the
   * markdown that shows the finished text.
   */
  streaming?: boolean
}>()

let component: Component | null = null

const target = ref<HTMLElement>()

const handleClick = (event: MouseEvent) => {
  const el = (event.target as HTMLElement).closest('a.internal-link')
  if (el) {
    event.preventDefault()
    const href = el.getAttribute('data-href')
    // Through `openLink`, which sends a chat to the sidebar: `openLinkText` would put it in the
    // leaf being read and the note there would be closed. Loaded on click, so the kit does not
    // pull the chat services in with it.
    // Mod-click asks for a new tab, split or window, as it does on a link in a note.
    const mod = Keymap.isModEvent(event)
    const pane = mod === true ? 'tab' : mod
    if (href) void import('@/ai/openChat').then((m) => m.openLink(href, props.filePath || '', pane))
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

/**
 * What is on the page, block by block, and the render each block came from.
 *
 * Each render gets a component of its own and hands it to Obsidian — which is what every chart,
 * map, diagram, gallery and embed in the text is attached to. A block that comes back the same
 * in the next render stays on the page (see `markdownParts.ts`), so a render lives for as long
 * as any of its blocks is still shown, and is let go when the last one is replaced. With one
 * component for all of them, a reply streamed in fifty pieces kept fifty sets of those alive
 * until the chat closed, and a map is a WebGL context, of which a window only gets a handful.
 */
let parts: Part[] = []
/** The text of what is on the page, and whether a block of it was held back or not yet drawn. */
let shownText = ''
let shownPath = ''
let shownPartial = false

const ownersOf = (list: Part[]) => new Set(list.map((p) => p.owner))

/**
 * Lets go of what a render drew inside `nodes`, which are leaving the page or never reach it:
 * the chart, map or diagram a block had, while the render's other blocks stay.
 */
const releaseInside = (owner: Component, nodes: ChildNode[]) => {
  if (!nodes.length) return
  const children = (owner as unknown as { _children?: Component[] })._children
  if (!Array.isArray(children)) return
  for (const child of children.slice()) {
    const el = (child as { containerEl?: Node }).containerEl
    if (el && nodes.some((node) => node === el || node.contains(el))) owner.removeChild(child)
  }
}

const renderContent = async () => {
  if (!target.value || !component) return

  const mine = ++generation
  const source = props.text || ''
  const path = props.filePath || ''
  const text = source
  // Built away from the page and swapped in. Emptying the element first left it with no height
  // until the render landed, which in a chat being streamed into collapses the scroll range
  // several times a second: the browser clamps the reader's position and drags them down.
  const next = createDiv()
  const owner = component
  // Loaded on its own until it is the one on screen: a render still in flight when the
  // markdown goes is let go here, by this call, rather than by a parent that has already
  // unloaded and would leave whatever the render attached afterwards running.
  const own = new Component()
  own.load()

  recordInto(next)
  let sigs: Array<string | null> = []
  try {
    await MarkdownRenderer.render(
      GlobalStore.getInstance().app,
      text,
      next,
      path,
      own
    )
  } finally {
    sigs = stopRecording(next)
  }

  // Overtaken, or the markdown is gone.
  if (mine !== generation || !target.value || component !== owner) {
    own.unload()
    return
  }

  const fresh = Array.from(next.childNodes)
  // The blocks at the start that came back the same stay where they are — unless the note the
  // text belongs to changed, and its links and embeds resolve against another one.
  let same = 0
  while (
    path === shownPath &&
    same < fresh.length &&
    same < parts.length &&
    parts[same].sig !== null &&
    parts[same].sig === sigs[same]
  ) {
    same++
  }
  releaseInside(own, fresh.slice(0, same))
  const leaving = parts.slice(same)
  for (const o of ownersOf(leaving)) {
    releaseInside(
      o,
      leaving.filter((p) => p.owner === o).map((p) => p.node)
    )
  }
  const nextParts: Part[] = [
    ...parts.slice(0, same),
    ...fresh.slice(same).map((node, i) => ({ node, sig: sigs[same + i] ?? null, owner: own })),
  ]

  const el = target.value
  for (const part of parts.slice(same)) part.node.remove()
  // Anything else found in the element — nothing is expected — goes too.
  for (const node of Array.from(el.childNodes)) {
    if (!nextParts.some((p) => p.node === node)) node.remove()
  }
  for (const part of nextParts.slice(same)) el.appendChild(part.node)

  const keep = ownersOf(nextParts)
  for (const o of ownersOf(parts)) if (!keep.has(o)) o.unload()
  if (!keep.has(own)) own.unload()
  parts = nextParts
  shownText = source
  shownPath = path
  shownPartial = false
  // For whoever draws over the result — comments on an answer — since this replaced it.
  emit('rendered')
}

/**
 * Takes over what a streaming markdown drew for this text, when this one replaces it — a reply
 * that has just ended becoming a message. Rendered again only when that fell short of the text.
 */
const adopt = (): boolean => {
  const el = target.value
  if (!el || props.streaming || !props.text) return false
  const offered = take(props.text, el.doc)
  if (!offered) return false
  parts = offered.parts
  for (const part of parts) el.appendChild(part.node)
  shownText = offered.text
  shownPath = props.filePath || ''
  shownPartial = offered.partial
  if (shownPartial || shownText !== props.text) void renderContent()
  else emit('rendered')
  return true
}

/** The element, kept past unmounting: Vue clears the template ref before `onUnmounted` runs. */
let host: HTMLElement | null = null

onMounted(() => {
  host = target.value ?? null
  component = new Component()
  component.load()
  if (adopt()) return
  // Or a microtask later, should the streaming markdown it replaces go after it in the pass.
  queueMicrotask(() => {
    if (!component || adopt()) return
    void renderContent()
  })
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
const win = () => target.value?.win ?? host?.win ?? window

watch(
  () => [props.text, props.filePath, props.streaming],
  () => {
    win().clearTimeout(renderTimer)
    renderTimer = win().setTimeout(() => void renderContent(), 0)
  },
  { deep: true }
)

/**
 * A streaming markdown offers what it drew as it goes, while it is still on the page: the
 * markdown that replaces it mounts in the same pass, and finds it there when it does.
 */
onBeforeUnmount(() => {
  const doc = host?.doc
  if (!props.streaming || !parts.length || !shownText || !doc) return
  const owners = ownersOf(parts)
  // Short of the text if a render for newer text was still to come.
  const partial = shownPartial || shownText !== (props.text || '')
  offer({ text: shownText, partial, doc, parts }, () => {
    for (const o of owners) o.unload()
  })
  parts = []
})

onUnmounted(() => {
  win().clearTimeout(renderTimer)
  generation++
  component?.unload()
  component = null
  for (const o of ownersOf(parts)) o.unload()
  parts = []
})

const emit = defineEmits<{
  (e: 'click'): void
  /** A render has landed in the element. */
  (e: 'rendered'): void
}>()
</script>

<style scoped>
.abele-markdown {
  white-space-collapse: collapse;
}
</style>
