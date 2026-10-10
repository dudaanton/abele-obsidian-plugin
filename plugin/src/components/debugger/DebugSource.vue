<template>
  <div
    ref="host"
    class="abele-github-code abele-debug-source"
    :class="{ 'abele-debug-source_stale': stale }"
  />
</template>

<script setup lang="ts">
// The source file in its tab of the main area, in the plugin's code viewer, with what a debugger
// adds: a margin before the line numbers where a press sets or removes a breakpoint, and the line
// the program stands on, marked across the whole width. The marks are the panel's: a red disc,
// a hollow ring, a struck ring.
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorView, GutterMarker, gutter, Decoration } from '@codemirror/view'
import { Compartment, Prec, StateEffect } from '@codemirror/state'
import { setTooltip } from 'obsidian'
import { mountCode, type CodeViewer } from '@/github/codeViewer'
import type { DebugBreakpoint } from './types'

const props = withDefaults(
  defineProps<{
    text: string
    path: string
    breakpoints: DebugBreakpoint[]
    /** The line the program stands on; none while it runs. */
    line?: number
    /** Last known, while the node is away: nothing can be changed. */
    stale?: boolean
  }>(),
  { line: undefined, stale: false }
)

const emit = defineEmits<{ (e: 'breakpoint', line: number): void }>()

const host = ref<HTMLElement>()
let viewer: CodeViewer | undefined
let editor: EditorView | null = null
const marks = new Compartment()
const current = new Compartment()

const words = { set: 'Stops here', pending: 'Not confirmed yet', rejected: 'Cannot stop here' }

class Mark extends GutterMarker {
  constructor(
    readonly line: number,
    readonly point: DebugBreakpoint | undefined,
    readonly here: boolean,
    readonly locked: boolean
  ) {
    super()
  }
  eq(o: Mark) {
    return (
      o.line === this.line &&
      o.point?.state === this.point?.state &&
      o.here === this.here &&
      o.locked === this.locked
    )
  }
  toDOM() {
    const el = createEl('button')
    el.type = 'button'
    el.className = 'abele-debug-source__point'
    el.disabled = this.locked
    const dot = el.createSpan({
      cls: `abele-breakpoint-mark abele-breakpoint-mark_${this.point?.state ?? 'none'}`,
    })
    dot.setAttribute('aria-hidden', 'true')
    if (this.here) el.addClass('abele-debug-source__point_here')
    const label = this.point
      ? `${words[this.point.state]}${this.point.reason ? `: ${this.point.reason}` : ''} · press to remove`
      : `Stop at line ${this.line}`
    el.setAttribute('aria-label', label)
    setTooltip(el, label)
    el.onclick = () => emit('breakpoint', this.line)
    return el
  }
}

const margin = () =>
  Prec.high(
    gutter({
      class: 'abele-debug-source__margin',
      lineMarker(view, block) {
        const line = view.state.doc.lineAt(block.from).number
        return new Mark(
          line,
          props.breakpoints.find((b) => b.line === line),
          line === props.line,
          props.stale
        )
      },
      initialSpacer: () => new Mark(0, undefined, false, true),
    })
  )
const here = () =>
  props.line && editor
    ? EditorView.decorations.of(
        Decoration.set([
          Decoration.line({ class: 'abele-debug-source__line_here' }).range(
            editor.state.doc.line(Math.min(props.line, editor.state.doc.lines)).from
          ),
        ])
      )
    : []

async function draw() {
  await nextTick()
  viewer?.destroy()
  if (!host.value) return
  viewer = mountCode(host.value, props.text, props.path, undefined, {}, props.line)
  editor = EditorView.findFromDOM(host.value.querySelector('.cm-editor'))
  editor?.dispatch({
    effects: StateEffect.appendConfig.of([marks.of(margin()), current.of(here())]),
  })
}
onMounted(draw)
watch(() => [props.text, props.path], draw)
watch(
  () => [props.breakpoints, props.stale, props.line],
  () => editor?.dispatch({ effects: [marks.reconfigure(margin()), current.reconfigure(here())] }),
  { deep: true }
)
onBeforeUnmount(() => viewer?.destroy())
</script>

<style lang="scss">
.abele-debug-source {
  border: var(--border-width) solid var(--background-modifier-border);
  border-radius: var(--radius-l);
  overflow: hidden;
  font-family: var(--font-monospace);
  font-size: var(--font-ui-small);
}
.abele-debug-source .cm-gutters {
  border: none;
  background-color: var(--background-secondary);
  color: var(--text-faint);
}
.abele-debug-source__margin .cm-gutterElement {
  display: flex;
  align-items: center;
  justify-content: center;
}
// The press target is the whole margin cell; the mark is a small disc in it.
.abele-debug-source .abele-debug-source__point {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--size-4-5);
  height: 100%;
  padding: 0;
  border: none;
  background: none;
  box-shadow: none;
  cursor: var(--cursor);

  .abele-breakpoint-mark_none {
    width: var(--size-4-2);
    height: var(--size-4-2);
    border-radius: 50%;
  }
  &:not(:disabled):hover .abele-breakpoint-mark_none {
    box-shadow: inset 0 0 0 var(--border-width) var(--text-faint);
  }
}
// The line the program stands on: the highlight colour across the line, an accent edge.
.abele-debug-source .cm-content .cm-line.abele-debug-source__line_here {
  background-color: color-mix(in oklch, var(--interactive-accent) 14%, transparent);
  box-shadow: inset var(--size-2-1) 0 var(--interactive-accent);
}
.abele-debug-source_stale .cm-content {
  opacity: 0.7;
}
body.is-phone .abele-debug-source .abele-debug-source__point {
  width: var(--size-4-8);
}
</style>
