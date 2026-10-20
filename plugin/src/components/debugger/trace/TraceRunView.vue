<template>
  <!-- A recorded run in its tab of the main area, read the way DevTools reads its Network panel:
       the steps in time on the left, the one picked on the right. Steps of one request stand
       together under the first, folding as the search results do. On a phone the step opens over
       the list, and back returns to it. -->
  <div
    class="abele-trace-run"
    :class="{ 'abele-trace-run_phone': phone, 'abele-trace-run_picked': !!picked || !!trail }"
  >
    <div v-if="debuggerAvailable" class="nav-header">
      <div class="nav-buttons-container">
        <Icon icon="bug-play" :tooltip="t('streamC.84822d88013675a1')" @click="emit('debugger')" />
      </div>
    </div>
    <div class="abele-trace-run__body">
      <div class="abele-trace-run__list">
        <div class="abele-trace-run__tools">
          <Search
            v-model="query"
            :placeholder="t('streamC.9fac49d7c6068756')"
            :label="t('streamC.9fac49d7c6068756')"
          />
          <div
            class="abele-trace-run__filters"
            role="group"
            :aria-label="t('streamC.a8d71c9610054181')"
          >
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
          <span>{{ t('streamC.9f0d328ca5e59604') }}</span>
        </div>
        <div
          class="abele-trace-run__steps"
          role="tree"
          :aria-label="t('streamC.1de3df70ddf4faab')"
          @keydown="keys"
        >
          <template v-for="row in rows" :key="row.step.id">
            <TreeItem
              class="abele-trace-run__step"
              :class="{
                'abele-trace-run__step_on-trail': onTrail.has(row.step.id),
              }"
              :text="stepLabel(row.step)"
              :where="row.step.kind === 'http' ? row.step.host : undefined"
              :active="row.step.id === picked"
              :collapsible="row.children.length > 0"
              :collapsed="folded.has(row.step.id)"
              :fold-apart="row.children.length > 0"
              @toggle="toggle(row.step.id)"
              @click="openStep(row.step)"
            >
              <template #leading
                ><TraceStepGlyph :step="row.step" @click="openStep(row.step)"
              /></template>
              <template #end><StepEnd :step="row.step" /></template>
              <TreeItem
                v-for="child in row.children"
                :key="child.id"
                class="abele-trace-run__step"
                :class="{ 'abele-trace-run__step_on-trail': onTrail.has(child.id) }"
                :text="stepLabel(child)"
                :active="child.id === picked"
                @click="openStep(child)"
              >
                <template #leading
                  ><TraceStepGlyph :step="child" @click="openStep(child)"
                /></template>
                <template #end><StepEnd :step="child" /></template>
              </TreeItem>
            </TreeItem>
          </template>
          <EmptyState
            v-if="!rows.length"
            :text="
              filter === 'browser' && !run.steps.some((s) => s.kind === 'http')
                ? t('debug.requestsBrowserOnly')
                : query || filter
                  ? t('streamC.5209d2d7f12c56b7')
                  : t('streamC.92fdf94dd7bb7e27')
            "
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
        <EmptyState v-else :text="t('streamC.65604f36088a877e')" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'

// Every view of the run is worked out on the node and comes small: a step's values as rows with
// their shapes, the full text only when a value is opened whole in its own tab. The filters are
// glyphs, named in their tooltips: only the code, only the browser, only what failed, only what
// you marked.
import { computed, defineComponent, h, reactive, ref, watch, type PropType } from 'vue'
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
    debuggerAvailable?: boolean
    valueMatches?: string[]
    /** The step shown on the right. */
    picked?: string
    /** A value followed through the run: its trail takes the right side. */
    trail?: Trail
  }>(),
  { picked: undefined, trail: undefined, debuggerAvailable: false, valueMatches: () => [] }
)

const emit = defineEmits<{
  (e: 'debugger'): void
  (e: 'search', query: string): void
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
  { id: 'code', icon: 'diamond', tooltip: t('streamC.9540f36dd0716eac') },
  { id: 'browser', icon: 'arrow-right-left', tooltip: t('streamC.0476591b7543e100') },
  { id: 'failed', icon: 'circle-x', tooltip: t('streamC.f27d62aa1d155f70') },
  { id: 'marked', icon: 'flag', tooltip: t('streamC.c731de9cd8ee89ec') },
]
const query = ref('')
watch(query, (q, _old, cleanup) => {
  const timer = window.setTimeout(() => emit('search', q), q.trim() ? 200 : 0)
  cleanup(() => window.clearTimeout(timer))
})
const filter = ref<Filter | null>(null)
const stepLabel = (s: TraceStep) => {
  const readable = s.values.filter((v) => !v.masked && !v.failed)
  const changed = readable.filter((v) => !v.same)
  const brief =
    s.kind === 'probe'
      ? (changed.length ? changed : readable).map((v) => `${v.name}: ${v.brief}`).join(', ')
      : ''
  return brief ? `${brief} · ${s.label}` : s.label
}

function shown(s: TraceStep) {
  const f = filter.value
  if (f === 'code' && s.kind !== 'probe') return false
  if (f === 'browser' && s.kind !== 'http') return false
  if (f === 'failed' && !(s.kind === 'error' || (s.status ?? 0) >= 400)) return false
  if (f === 'marked' && !s.marked) return false
  const q = query.value.trim().toLowerCase()
  return (
    !q ||
    props.valueMatches?.includes(s.id) ||
    s.label.toLowerCase().includes(q) ||
    [...s.values, ...(s.request ?? []), ...(s.response ?? [])].some(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        (!v.masked && !v.failed && v.brief.toLowerCase().includes(q))
    )
  )
}

/** The first step of each request with the rest of it under it; a step of no request alone. */
const rows = computed(() => {
  const out: { step: TraceStep; children: TraceStep[] }[] = []
  const heads = new Map<string, { step: TraceStep; children: TraceStep[] }>()
  // HTTP steps are completed after the code they caused, and may arrive after it.
  const requests = new Map(
    props.run.steps.filter((s) => s.kind === 'http' && s.chain).map((s) => [s.chain, s])
  )
  for (const s of props.run.steps) {
    const request = s.chain ? requests.get(s.chain) : undefined
    if (filter.value === 'browser' && request) {
      if (!shown(request)) continue
    } else if (!shown(s)) continue
    const head = s.chain ? heads.get(s.chain) : undefined
    if (head) {
      if (s.id !== head.step.id) head.children.push(s)
    } else {
      const first = request && shown(request) ? request : s
      const row = { step: first, children: first.id === s.id ? [] : [s] }
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
function openStep(step: TraceStep) {
  pick(step.id)
  if (props.trail) emit('unfollow')
}
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
      // Under its request by time only: the node suggests it, a header would prove it.
      p.step.byTime
        ? h(Icon, {
            icon: 'clock',
            size: 'xs',
            noHover: true,
            class: 'abele-trace-run__by-time',
            tooltip: t('streamC.0cf75be03da7c5b6'),
          })
        : null,
      p.step.marked
        ? h(Icon, { icon: 'flag', size: 'xs', noHover: true, class: 'abele-trace-run__flag' })
        : null,
      p.step.direction
        ? h(
            'span',
            {},
            t(p.step.direction === 'incoming' ? 'debug.httpIncoming' : 'debug.httpOutgoing')
          )
        : null,
      p.step.status !== undefined ? h('span', {}, String(p.step.status)) : null,
      p.step.durationMs !== undefined ? h('span', {}, `${p.step.durationMs} ms`) : null,
      h('span', { class: 'abele-trace-run__size' }, same ? '=' : size ? bytes(size) : ''),
      h('span', { class: 'abele-trace-run__time' }, since(p.step.at)),
    ])
  },
})
</script>

<style lang="scss">
.abele-trace-run__by-time {
  color: var(--text-faint);
}
.abele-trace-run {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  container-type: inline-size;
}
.abele-trace-run__body {
  flex: 1;
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
  // Under the base rule below, which would otherwise win: one class more.
  .abele-trace-run__body > .abele-trace-run__list {
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
