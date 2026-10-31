<template>
  <div
    ref="host"
    class="abele-github-code abele-debug-source"
    :class="{ 'abele-debug-source_stale': stale }"
  />
  <!-- A record point is set up under its own line, as a conditional breakpoint is in VS Code. -->
  <Teleport v-if="editorHost && editing" :to="editorHost">
    <slot name="point-editor" :line="editing" />
  </Teleport>
  <!-- Selected code goes to the agent or into a note with the lines it spans. -->
  <SelectionBar
    :scope="host"
    within=".cm-content"
    :actions="[ASK, ADD, NOTE]"
    @pick="(a, s) => emit('selection', a as 'ask' | 'add' | 'note', { ...s, path })"
  />
</template>

<script setup lang="ts">
import { t } from '@/i18n'

// The source file in its tab of the main area, in the plugin's code viewer, with what a debugger
// adds: a margin before the line numbers where a press sets or removes a breakpoint, and the line
// the program stands on, marked across the whole width. The marks are the panel's: a red disc,
// a hollow ring, a struck ring, a diamond for a record point. A right-click on the margin offers
// both kinds; a record point toggles off too, and after a run says at the end of
// its line, faintly, what it took the last time. Selected code gets the selection bar: ask, add
// to the chat, note.
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import {
  EditorView,
  GutterMarker,
  gutter,
  lineNumbers,
  Decoration,
  WidgetType,
} from '@codemirror/view'
import { Compartment, Prec, StateEffect } from '@codemirror/state'
import { setTooltip } from 'obsidian'
import { mountCode, type CodeViewer } from '@/github/codeViewer'
import type { LineRange } from '@/github/urls'
import SelectionBar, { type Selected } from '../obsidian/SelectionBar.vue'
import { ADD, ASK, NOTE } from '../obsidian/selectionActions'
import type { DebugBreakpoint } from './types'

const props = withDefaults(
  defineProps<{
    text: string
    path: string
    breakpoints: DebugBreakpoint[]
    /** The line the program stands on; none while it runs. */
    line?: number
    /** Navigation destination, independent of the program execution line. */
    range?: LineRange
    /** Last known, while the node is away: nothing can be changed. */
    stale?: boolean
    /** The line whose record point is being set up, under it. */
    editing?: number
    /** What each record point took the last time, at the end of its line. */
    tails?: boolean
  }>(),
  { line: undefined, range: undefined, stale: false, editing: undefined, tails: false }
)

const emit = defineEmits<{
  (e: 'breakpoint', line: number): void
  /** A press on a record point: set it up. */
  (e: 'edit-point', line: number): void
  /** A right-click on the margin, for the menu of what to put there. */
  (e: 'margin-menu', line: number, event: MouseEvent): void
  /** A press on what a record point took: its steps in the run. */
  (e: 'open-hits', line: number): void
  /** Selected code, to ask about, add to the open chat or insert into a note. */
  (e: 'selection', action: 'ask' | 'add' | 'note', selected: Selected & { path: string }): void
}>()

const host = ref<HTMLElement>()
let viewer: CodeViewer | undefined
let editor: EditorView | null = null
const marks = new Compartment()
const refreshMarks = StateEffect.define<null>()
const current = new Compartment()
const extras = new Compartment()
/** Where the setup of a record point is drawn: a block under its line. */
const editorHost = shallowRef<HTMLElement | null>(null)

const words = {
  disabled: t('debug.breakpointDisabled'),
  set: t('streamC.e8041f01a8c14622'),
  pending: t('streamC.96584d78f43835f6'),
  rejected: t('streamC.3f1facb79cc50b40'),
}
const recordWords = {
  disabled: t('debug.breakpointDisabled'),
  set: t('streamC.06905f2ac0915241'),
  pending: t('streamC.0ea0c8ad44c38c29'),
  rejected: t('streamC.6adbfde88c55906a'),
}

class Mark extends GutterMarker {
  constructor(
    readonly line: number,
    readonly point: DebugBreakpoint | undefined,
    readonly here: boolean,
    readonly locked: boolean
  ) {
    super()
    // Equality compares rendered values even when the caller mutates a reactive point in place.
    this.point = point ? { ...point } : undefined
  }
  eq(o: Mark) {
    return (
      o.line === this.line &&
      o.point?.state === this.point?.state &&
      o.point?.kind === this.point?.kind &&
      o.point?.logMessage === this.point?.logMessage &&
      o.point?.reason === this.point?.reason &&
      o.point?.condition === this.point?.condition &&
      o.here === this.here &&
      o.locked === this.locked
    )
  }
  toDOM() {
    // The gutter's width spacer: as wide as a mark, but nothing to press or to read out.
    if (this.line === 0)
      return createSpan({ cls: 'abele-debug-source__point', attr: { 'aria-hidden': 'true' } })
    const el = createEl('button')
    el.type = 'button'
    el.className = 'abele-debug-source__point'
    el.dataset.line = String(this.line)
    el.disabled = this.locked
    const record = this.point?.kind === 'record'
    const log = this.point?.kind === 'log'
    const dot = el.createSpan({
      cls: `abele-breakpoint-mark abele-breakpoint-mark_${this.point?.state ?? 'none'}${record || log ? ' abele-breakpoint-mark_record' : ''}`,
    })
    dot.setAttribute('aria-hidden', 'true')
    if (this.here) el.addClass('abele-debug-source__point_here')
    const said = this.point
      ? log && this.point.state === 'set'
        ? t('debug.logPoint', { message: this.point.logMessage ?? '' })
        : `${(record ? recordWords : words)[this.point.state]}${this.point.reason ? `: ${this.point.reason}` : ''}${this.point.condition ? ` · ${this.point.condition}` : ''}`
      : ''
    const label = this.point
      ? t('streamC.38b9d675845ab96b', { v1: String(said) })
      : t('streamC.eb19cd4d6df5378c', { v1: String(this.line) })
    el.setAttribute('aria-label', label)
    setTooltip(el, label)
    const line = this.line
    el.onclick = () => emit('breakpoint', line)
    el.oncontextmenu = (e) => {
      e.preventDefault()
      e.stopPropagation()
      emit('margin-menu', line, e)
    }
    return el
  }
}

const margin = () =>
  Prec.high(
    gutter({
      class: 'abele-debug-source__margin',
      // Keep the gutter configuration (and equal markers' DOM) across prop updates.
      lineMarkerChange: (update) =>
        update.transactions.some((transaction) =>
          transaction.effects.some((effect) => effect.is(refreshMarks))
        ),
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
/** What a record point took the last time, faint after the end of its line. */
class Tail extends WidgetType {
  constructor(
    readonly line: number,
    readonly text: string,
    readonly hits: number
  ) {
    super()
  }
  eq(o: Tail) {
    return o.line === this.line && o.text === this.text && o.hits === this.hits
  }
  toDOM() {
    const el = createEl('button', { cls: 'abele-debug-source__tail' })
    el.type = 'button'
    el.setText(this.hits > 1 ? `${this.text} · ×${this.hits}` : this.text)
    const label =
      this.hits > 1
        ? t('streamC.9a684a03320b4ca2', { v1: String(this.hits) })
        : t('streamC.8f4c910e565cad23')
    el.setAttribute('aria-label', label)
    setTooltip(el, label)
    el.onclick = () => emit('open-hits', this.line)
    return el
  }
}
/** The block under a line where its record point is set up; the component is teleported in. */
class EditorBlock extends WidgetType {
  private observer?: ResizeObserver
  constructor(readonly line: number) {
    super()
  }
  eq(o: EditorBlock) {
    return o.line === this.line
  }
  toDOM(view: EditorView) {
    const el = createDiv({ cls: 'abele-debug-source__point-editor' })
    const size = () => {
      const gutters = view.scrollDOM.querySelector<HTMLElement>('.cm-gutters')?.offsetWidth ?? 0
      el.style.width = `${Math.max(0, view.scrollDOM.clientWidth - gutters - 8)}px`
    }
    size()
    this.observer = new ResizeObserver(size)
    this.observer.observe(view.scrollDOM)
    queueMicrotask(() => (editorHost.value = el))
    return el
  }
  destroy(el: HTMLElement) {
    this.observer?.disconnect()
    if (editorHost.value === el) editorHost.value = null
  }
  ignoreEvent() {
    return true
  }
}
const extra = () => {
  if (!editor) return []
  const doc = editor.state.doc
  const ranges = []
  if (props.tails)
    for (const b of props.breakpoints)
      if (b.kind === 'record' && b.last && b.line <= doc.lines)
        ranges.push(
          Decoration.widget({ widget: new Tail(b.line, b.last, b.hits ?? 1), side: 1 }).range(
            doc.line(b.line).to
          )
        )
  if (props.editing && props.editing <= doc.lines)
    ranges.push(
      Decoration.widget({ widget: new EditorBlock(props.editing), block: true, side: 1 }).range(
        doc.line(props.editing).to
      )
    )
  return ranges.length ? EditorView.decorations.of(Decoration.set(ranges, true)) : []
}

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
  viewer = mountCode(host.value, props.text, props.path, props.range, {}, props.line)
  editor = EditorView.findFromDOM(host.value.querySelector('.cm-editor'))
  editor?.dispatch({
    effects: StateEffect.appendConfig.of([
      lineNumbers({
        domEventHandlers: {
          contextmenu(view, block, event) {
            event.preventDefault()
            event.stopPropagation()
            emit('margin-menu', view.state.doc.lineAt(block.from).number, event)
            return true
          },
          click(view, block) {
            if (props.stale) return false
            emit('breakpoint', view.state.doc.lineAt(block.from).number)
            return true
          },
        },
      }),
      marks.of(margin()),
      current.of(here()),
      extras.of(extra()),
    ]),
  })
  console.debug('[debugger] Source mounted', props.path, props.line)
}
onMounted(draw)
watch(() => [props.text, props.path, props.range], draw)
watch(
  () => [props.breakpoints, props.stale, props.line, props.editing, props.tails],
  (values, previous) => {
    if (values[2] !== previous[2])
      console.debug(
        '[debugger] Source decorations',
        props.path,
        props.line,
        !!host.value?.offsetParent
      )
    editor?.dispatch({
      effects: [refreshMarks.of(null), current.reconfigure(here()), extras.reconfigure(extra())],
    })
    if (values[2] !== previous[2])
      queueMicrotask(() =>
        console.debug(
          '[debugger] Source rendered',
          props.path,
          props.line,
          host.value?.querySelector('.abele-debug-source__line_here')?.textContent
        )
      )
  },
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

  &:disabled {
    cursor: default;
  }
  .abele-breakpoint-mark_none {
    width: var(--size-4-2);
    height: var(--size-4-2);
    border-radius: 50%;
  }
  &:not(:disabled):hover .abele-breakpoint-mark_none {
    box-shadow: inset 0 0 0 var(--border-width) var(--text-faint);
  }
}
// The line the program stands on: Obsidian's own highlight across the whole line, as a marked
// passage in a note. No edge down its side: a stripe there is the one mark these screens never use.
.abele-debug-source .cm-content .cm-line.abele-debug-source__line_here {
  background-color: var(
    --text-highlight-bg,
    color-mix(in srgb, var(--color-yellow) 35%, transparent)
  );
}
// What a record point took, after its line: quiet, the size of a line number, pressable.
.abele-debug-source .abele-debug-source__tail {
  margin-inline-start: var(--size-4-4);
  padding: 0 var(--size-2-2);
  height: auto;
  border: none;
  border-radius: var(--radius-s);
  background: none;
  box-shadow: none;
  color: var(--text-faint);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
  cursor: var(--cursor);

  &:hover {
    background-color: var(--background-modifier-hover);
    color: var(--text-muted);
  }
}
.abele-debug-source .abele-debug-source__point-editor {
  box-sizing: border-box;
  position: sticky;
  left: 0;
  padding: var(--size-4-2) var(--size-4-3);
  border-block: var(--border-width) solid var(--background-modifier-border);
  background-color: var(--background-secondary);
  font-family: var(--font-interface);
  white-space: normal;
}
.abele-debug-source_stale .cm-content {
  opacity: 0.7;
}
body.is-phone .abele-debug-source .abele-debug-source__point {
  width: var(--size-4-8);
}
</style>
