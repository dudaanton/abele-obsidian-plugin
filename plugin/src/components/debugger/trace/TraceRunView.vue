<template>
  <!-- A recorded run in its tab of the main area, read the way DevTools reads its Network panel:
       the steps in time on the left, the one picked on the right. Steps of one request stand
       together under the first, folding as the search results do. On a phone the step opens over
       the list, and back returns to it. -->
  <div
    class="abele-trace-run"
    :class="{ 'abele-trace-run_phone': phone, 'abele-trace-run_picked': !!picked || !!trail }"
  >
    <div class="abele-trace-run__body">
      <div class="abele-trace-run__list">
        <div class="abele-trace-run__tools">
          <Search v-model="query" placeholder="Find in the steps" label="Find in the steps" />
          <div class="abele-trace-run__filters" role="group" aria-label="Show only">
            <Icon
              v-for="f in FILTERS"
              :key="f.id"
              :icon="f.icon"
              :tooltip="f.tooltip"
              :active="filter === f.id"
              @click="filter = filter === f.id ? null : f.id"
            />
          </div>
        </div>
        <div v-if="run.cut" class="abele-trace-run__notice" role="status">
          <Icon icon="scissors" size="xs" no-hover />
          <span>Cut short: the node went away. The steps before it are kept.</span>
        </div>
        <div class="abele-trace-run__steps" role="tree" aria-label="Steps" @keydown="keys">
          <template v-for="row in rows" :key="row.step.id">
            <TreeItem
              class="abele-trace-run__step"
              :class="{
                'abele-trace-run__step_on-trail': onTrail.has(row.step.id),
              }"
              :text="row.step.label"
              :active="row.step.id === picked"
              :collapsible="row.children.length > 0"
              :collapsed="folded.has(row.step.id)"
              :fold-apart="row.children.length > 0"
              @toggle="toggle(row.step.id)"
              @click="pick(row.step.id)"
            >
              <template #leading><TraceStepGlyph :step="row.step" /></template>
              <template #end><StepEnd :step="row.step" /></template>
              <TreeItem
                v-for="child in row.children"
                :key="child.id"
                class="abele-trace-run__step"
                :class="{ 'abele-trace-run__step_on-trail': onTrail.has(child.id) }"
                :text="child.label"
                :active="child.id === picked"
                @click="pick(child.id)"
              >
                <template #leading><TraceStepGlyph :step="child" /></template>
                <template #end><StepEnd :step="child" /></template>
              </TreeItem>
            </TreeItem>
          </template>
          <EmptyState
            v-if="!rows.length"
            :text="query || filter ? 'No step matches.' : 'Nothing was recorded.'"
          />
        </div>
      </div>

      <div class="abele-trace-run__detail">
        <TraceTrail
          v-if="trail"
          :trail="trail"
          :steps="run.steps"
          @close="emit('unfollow')"
          @open-value="(s, p) => emit('open-value', s, nameAt(s, p), p)"
        />
        <TraceStepDetail
          v-else-if="current"
          :key="current.id"
          :step="current"
          @reveal="(f, l) => emit('reveal', f, l)"
          @open-value="(s, n, p) => emit('open-value', s, n, p)"
          @open-changes="(s, n) => emit('open-changes', s, n)"
          @open-step="pick"
          @follow="(v) => emit('follow', v)"
          @mark="(s, at) => emit('mark', s, at)"
          @link="(l, ok) => emit('link', current!.id, l, ok)"
        />
        <EmptyState v-else text="Pick a step to see what it took." />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Every view of the run is worked out on the node and comes small: a step's values as rows with
// their shapes, the full text only when a value is opened whole in its own tab. The filters are
// glyphs, named in their tooltips: only the code, only the browser, only what failed, only what
// you marked.
import { computed, defineComponent, h, reactive, ref, type PropType } from 'vue'
import { Platform } from 'obsidian'
import EmptyState from '../../obsidian/EmptyState.vue'
import Icon from '../../obsidian/Icon.vue'
import Search from '../../obsidian/Search.vue'
import TreeItem from '../../obsidian/TreeItem.vue'
import TraceStepDetail from './TraceStepDetail.vue'
import TraceStepGlyph from './TraceStepGlyph.vue'
import TraceTrail from './TraceTrail.vue'
import { bytes, since, stepBytes } from './format'
import type { TraceLink, TraceRun, TraceStep, TraceTrail as Trail } from './types'

const props = withDefaults(
  defineProps<{
    run: TraceRun
    /** The step shown on the right. */
    picked?: string
    /** A value followed through the run: its trail takes the right side. */
    trail?: Trail
  }>(),
  { picked: undefined, trail: undefined }
)

const emit = defineEmits<{
  (e: 'pick', step: string | undefined): void
  (e: 'reveal', file: string, line: number): void
  (e: 'open-value', step: string, name: string, path?: string): void
  (e: 'open-changes', step: string, name: string): void
  (e: 'follow', value: string): void
  (e: 'unfollow'): void
  (e: 'mark', step: string, at: string): void
  (e: 'link', step: string, link: TraceLink, confirmed: boolean): void
}>()

const phone = Platform.isPhone

type Filter = 'code' | 'browser' | 'failed' | 'marked'
const FILTERS: { id: Filter; icon: string; tooltip: string }[] = [
  { id: 'code', icon: 'diamond', tooltip: 'Only what the record points took' },
  { id: 'browser', icon: 'arrow-right-left', tooltip: "Only the browser's requests" },
  { id: 'failed', icon: 'circle-x', tooltip: 'Only what failed' },
  { id: 'marked', icon: 'flag', tooltip: 'Only what you marked' },
]
const query = ref('')
const filter = ref<Filter | null>(null)

function shown(s: TraceStep) {
  const f = filter.value
  if (f === 'code' && s.kind !== 'probe') return false
  if (f === 'browser' && s.kind !== 'http') return false
  if (f === 'failed' && !(s.kind === 'error' || (s.status ?? 0) >= 400)) return false
  if (f === 'marked' && !s.marked) return false
  const q = query.value.trim().toLowerCase()
  return (
    !q ||
    s.label.toLowerCase().includes(q) ||
    s.values.some((v) => v.name.toLowerCase().includes(q))
  )
}

/** The first step of each request with the rest of it under it; a step of no request alone. */
const rows = computed(() => {
  const out: { step: TraceStep; children: TraceStep[] }[] = []
  const heads = new Map<string, { step: TraceStep; children: TraceStep[] }>()
  for (const s of props.run.steps) {
    if (!shown(s)) continue
    const head = s.chain ? heads.get(s.chain) : undefined
    if (head) head.children.push(s)
    else {
      const row = { step: s, children: [] as TraceStep[] }
      out.push(row)
      if (s.chain) heads.set(s.chain, row)
    }
  }
  return out
})

const folded = reactive(new Set<string>())
const toggle = (id: string) => (folded.has(id) ? folded.delete(id) : folded.add(id))

const current = computed(() => props.run.steps.find((s) => s.id === props.picked))
const onTrail = computed(() => new Set(props.trail?.stops.map((s) => s.step) ?? []))
const pick = (id: string) => emit('pick', id)
/** Back to the steps on a phone: the host puts it on its header's back arrow, as views do. */
function back() {
  if (props.trail) emit('unfollow')
  else emit('pick', undefined)
}
defineExpose({ back })
const nameAt = (step: string, path: string) =>
  path.split(/[./[]/)[0] || props.run.steps.find((s) => s.id === step)?.values[0]?.name || ''

/** Up and down move through the steps in the order they are listed. */
function keys(e: KeyboardEvent) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  const order = rows.value.flatMap((r) =>
    folded.has(r.step.id) ? [r.step] : [r.step, ...r.children]
  )
  const at = order.findIndex((s) => s.id === props.picked)
  const next = order[Math.max(0, Math.min(order.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]
  if (next) {
    e.preventDefault()
    pick(next.id)
  }
}

/** A step's end: its time from the start, faint, and what it took. */
const StepEnd = defineComponent({
  props: { step: { type: Object as PropType<TraceStep>, required: true } },
  setup: (p) => () => {
    const size = stepBytes(p.step)
    const same = p.step.values.length > 0 && p.step.values.every((v) => v.same)
    return h('span', { class: 'abele-trace-run__end' }, [
      p.step.marked
        ? h(Icon, { icon: 'flag', size: 'xs', noHover: true, class: 'abele-trace-run__flag' })
        : null,
      h('span', { class: 'abele-trace-run__size' }, same ? '=' : size ? bytes(size) : ''),
      h('span', { class: 'abele-trace-run__time' }, since(p.step.at)),
    ])
  },
})
</script>

<style lang="scss">
.abele-trace-run {
  height: 100%;
  min-height: 0;
  container-type: inline-size;
}
.abele-trace-run__body {
  display: grid;
  grid-template-columns: minmax(18em, 2fr) minmax(0, 3fr);
  gap: var(--size-4-4);
  height: 100%;
  min-height: 0;
}
// A tab too narrow for both side by side puts the step under the list, as wide as the tab:
// beside it a megabyte of XML and the names of its values would be cut to a few letters.
@container (max-width: 44em) {
  .abele-trace-run__body {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(8em, 2fr) minmax(0, 3fr);
    gap: 0;
  }
  .abele-trace-run__list {
    padding-inline-end: var(--size-2-2);
    border-inline-end: none;
    border-block-end: var(--border-width) solid var(--background-modifier-border);
  }
}
.abele-trace-run__list,
.abele-trace-run__detail {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
}
// A little room inside the scrolling edge, so a focused field keeps its whole ring.
.abele-trace-run__list,
.abele-trace-run__detail {
  padding: var(--size-2-2);
}
.abele-trace-run__list {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  padding-inline-end: var(--size-4-2);
  border-inline-end: var(--border-width) solid var(--background-modifier-border);
}
.abele-trace-run__tools {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);

  .search-input-container {
    flex: 1 1 auto;
  }
}
.abele-trace-run__filters {
  display: flex;
  gap: var(--size-2-1);
}
.abele-trace-run__notice {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  padding: var(--size-4-1) var(--size-4-2);
  border-radius: var(--radius-s);
  background-color: var(--background-modifier-hover);
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
.abele-trace-run__step .abele-tree-item__leading {
  display: inline-flex;
  margin-inline-end: var(--size-4-2);
}
.abele-trace-run__step .abele-tree-item__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
// A step the followed value passes through: a dot of the accent beside its time.
.abele-trace-run__step_on-trail > .tree-item-self .abele-trace-run__end::before {
  content: '';
  width: var(--size-2-3);
  height: var(--size-2-3);
  border-radius: 50%;
  background-color: var(--interactive-accent);
}
.abele-trace-run__end {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.abele-trace-run__size {
  color: var(--text-muted);
}
.abele-trace-run__flag {
  color: var(--text-muted);
}
// On a phone one side at a time: the list, or the step over it.
.abele-trace-run_phone {
  .abele-trace-run__body {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
    gap: 0;
  }
  .abele-trace-run__list {
    padding-inline-end: 0;
    border: none;
  }
  &.abele-trace-run_picked .abele-trace-run__list,
  &:not(.abele-trace-run_picked) .abele-trace-run__detail {
    display: none;
  }
}
</style>
