<template>
  <div ref="root" class="abele-script-html" :class="node.cls">
    <Teleport v-for="slot in slots" :key="slot.key" :to="slot.target">
      <ScriptNode :node="slot.node" :view="view" />
    </Teleport>
  </div>
</template>

<script setup lang="ts">
/**
 * The script's own markup, sanitised by Obsidian and put in place; the kit nodes the script
 * named by selector are teleported into the elements those selectors find.
 *
 * Events are delegated: one listener per event name on the root, matched with `closest`
 * against each selector the script registered. That survives the markup being replaced,
 * which a listener on the element itself would not. `sanitizeHTMLToDom` drops `<script>` and
 * inline `on*` attributes; the docs say so and point at `on:` instead.
 */
import { onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { sanitizeHTMLToDom } from 'obsidian'
import type { View } from '@/scripting/view/View'
import type { Html, ViewNode } from '@/scripting/view/components'
import ScriptNode from './ScriptNode.vue'

const props = defineProps<{ node: Html; view: View }>()

const root = ref<HTMLElement>()
const slots = shallowRef<Array<{ key: string; node: ViewNode; target: Element }>>([])
let generation = 0
let reportedFor = ''
/** The nodes the markup became, so a re-render can take exactly those out again. */
let placed: ChildNode[] = []

function render() {
  const el = root.value
  if (!el) return
  // Only the markup goes, and the teleported nodes inside it go with it; the new slot list
  // below remounts them. The root is not emptied: Vue keeps the anchors of the `v-for` there
  // and patches against them, and with those detached the next patch has no parent to insert
  // into.
  slots.value = []
  for (const node of placed) node.remove()
  const fragment = sanitizeHTMLToDom(props.node.html)
  placed = Array.from(fragment.childNodes)
  el.appendChild(fragment)
  generation++
  const found: typeof slots.value = []
  const missing: string[] = []
  for (const [selector, node] of Object.entries(props.node.slots)) {
    const target = el.querySelector(selector)
    if (target) found.push({ key: `${generation}:${selector}`, node, target })
    else missing.push(selector)
  }
  slots.value = found
  if (missing.length && reportedFor !== props.node.html) {
    reportedFor = props.node.html
    props.view.report(new Error(`Html: nothing matches ${missing.map((s) => `"${s}"`).join(', ')}`))
  }
  void props.view.run(() => props.node.emit('mount', el))
}

const listening = new Set<string>()
const listeners: Array<[string, (e: Event) => void]> = []

function listen() {
  const el = root.value
  if (!el) return
  for (const { event } of props.node.delegates) {
    if (listening.has(event)) continue
    listening.add(event)
    const handler = (e: Event) => {
      const target = e.target as Element | null
      if (!target) return
      for (const d of props.node.delegates) {
        if (d.event !== event) continue
        const hit = target.closest(d.selector)
        if (hit && el.contains(hit)) void props.view.run(() => d.fn(e, hit))
      }
    }
    el.addEventListener(event, handler)
    listeners.push([event, handler])
  }
}

onMounted(() => {
  render()
  listen()
})

watch(() => props.node.html, render)
watch(() => props.node.delegates.length, listen)
watch(() => Object.keys(props.node.slots).join('\n'), render)

onUnmounted(() => {
  const el = root.value
  if (el) for (const [event, handler] of listeners) el.removeEventListener(event, handler)
})
</script>
