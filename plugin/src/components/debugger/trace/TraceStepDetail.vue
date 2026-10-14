<template>
  <!-- One step of a run, read: what it is and where — the place in the code as a link to its
       line, or the request's address and status — and what it took, as rows to open. A browser
       request has what went out and what came back; a value the node found again elsewhere says
       where it came from, for you to confirm. -->
  <div class="abele-trace-step">
    <div class="abele-trace-step__head">
      <TraceStepGlyph :step="step" />
      <span class="abele-trace-step__title">{{ step.label }}</span>
      <Icon
        :icon="step.marked ? 'flag' : 'flag'"
        :active="step.marked"
        :tooltip="step.marked ? 'Marked: press to take the mark off' : 'Mark this step'"
        @click="emit('mark', step.id, '')"
      />
    </div>
    <div class="abele-trace-step__facts">
      <span ref="idEl" class="abele-trace-step__id">{{ step.id }}</span>
      <a
        v-if="step.place"
        class="abele-trace-step__place"
        role="button"
        tabindex="0"
        @click="emit('reveal', step.place.file, step.place.line)"
        @keydown.enter="emit('reveal', step.place.file, step.place.line)"
        >{{ fileName(step.place.file) }}:{{ step.place.line
        }}{{ step.place.fn ? ` · ${step.place.fn}` : '' }}</a
      >
      <span v-if="step.host" class="abele-trace-step__host">{{ step.host }}</span>
      <span v-if="step.status">{{ step.status }}</span>
      <span>{{ since(step.at) }}</span>
      <span v-if="step.pausedMs" ref="pausedEl">paused {{ step.pausedMs }} ms</span>
    </div>

    <div class="abele-trace-step__groups">
      <TreeItem
        v-if="step.stack?.length"
        class="abele-trace-step__group"
        text="Stack"
        :flair="String(step.stack.length)"
        collapsible
        :collapsed="!stackOpen"
        @click="stackOpen = !stackOpen"
      >
        <TreeItem
          v-for="(f, i) in step.stack"
          :key="i"
          class="abele-trace-step__frame"
          :text="f"
          plain
        />
      </TreeItem>

      <TreeItem
        v-for="g in groups"
        :key="g.id"
        class="abele-trace-step__group"
        :text="g.name"
        :flair="String(g.values.length)"
        collapsible
        :collapsed="folded.has(g.id)"
        @click="toggle(g.id)"
      >
        <TraceValueRow
          v-for="(v, i) in g.values"
          :key="v.name"
          :value="v"
          :initially-open="g.id === 'values' && i === 0"
          @open-whole="(p) => emit('open-value', step.id, v.name, p)"
          @open-changes="emit('open-changes', step.id, v.name)"
          @follow="(p, value) => emit('follow', value)"
          @mark="(p) => emit('mark', step.id, `${v.name}/${p}`)"
        />
      </TreeItem>

      <TreeItem
        v-if="step.links?.length"
        class="abele-trace-step__group"
        text="Came from"
        :flair="String(step.links.length)"
        collapsible
        :collapsed="folded.has('links')"
        @click="toggle('links')"
      >
        <TreeItem
          v-for="l in step.links"
          :key="l.value + l.from"
          class="abele-trace-step__link"
          :class="{ 'abele-trace-step__link_suggested': !l.confirmed }"
          :text="l.value"
          :note="l.label"
          @click="emit('open-step', l.from)"
        >
          <template #end>
            <Icon
              :icon="l.confirmed ? 'link' : 'wand-sparkles'"
              size="xs"
              :tooltip="linkWords(l)"
              no-hover
              class="abele-trace-step__link-mark"
            />
          </template>
          <template v-if="!l.confirmed" #actions>
            <Icon
              icon="check"
              size="xs"
              tooltip="It came from there"
              @click.stop="emit('link', l, true)"
            />
            <Icon icon="x" size="xs" tooltip="Not related" @click.stop="emit('link', l, false)" />
          </template>
        </TreeItem>
      </TreeItem>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { setTooltip } from 'obsidian'
import Icon from '../../obsidian/Icon.vue'
import TreeItem from '../../obsidian/TreeItem.vue'
import TraceStepGlyph from './TraceStepGlyph.vue'
import TraceValueRow from './TraceValueRow.vue'
import { since } from './format'
import type { TraceLink, TraceStep } from './types'

const props = defineProps<{ step: TraceStep }>()
const emit = defineEmits<{
  (e: 'reveal', file: string, line: number): void
  (e: 'open-value', step: string, name: string, path?: string): void
  (e: 'open-changes', step: string, name: string): void
  (e: 'open-step', step: string): void
  (e: 'follow', value: string): void
  (e: 'mark', step: string, at: string): void
  (e: 'link', link: TraceLink, confirmed: boolean): void
}>()

const fileName = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const stackOpen = ref(false)
const folded = reactive(new Set<string>())
const toggle = (id: string) => (folded.has(id) ? folded.delete(id) : folded.add(id))

const groups = computed(() =>
  [
    { id: 'values', name: 'Values', values: props.step.values },
    { id: 'request', name: 'Request', values: props.step.request ?? [] },
    { id: 'response', name: 'Response', values: props.step.response ?? [] },
  ].filter((g) => g.values.length)
)

const linkWords = (l: TraceLink) =>
  l.confirmed
    ? `Confirmed: ${l.value} came from ${l.label}`
    : `Suggested by the node: the same value in both · confirm or dismiss`

const pausedEl = ref<HTMLElement>()
const linkEls = ref<HTMLElement[]>([])
function tips() {
  if (pausedEl.value)
    setTooltip(pausedEl.value, 'How long the program stood while the values were taken')
  linkEls.value.forEach((el, i) => {
    const l = props.step.links?.[i]
    if (l) setTooltip(el, linkWords(l))
  })
}
onMounted(tips)
watch(
  () => props.step,
  () => queueMicrotask(tips),
  { deep: true }
)
</script>

<style lang="scss">
.abele-trace-step {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
  min-width: 0;
}
.abele-trace-step__head {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  padding: var(--size-2-2) var(--size-4-2) 0;
}
.abele-trace-step__title {
  flex: 1 1 auto;
  min-width: 0;
  font-weight: var(--font-semibold);
  overflow-wrap: anywhere;
}
.abele-trace-step__facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-2-2) var(--size-4-3);
  padding: 0 var(--size-4-2) var(--size-4-2) calc(var(--icon-s) + var(--size-4-4));
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  font-variant-numeric: tabular-nums;
}
.abele-trace-step__host {
  overflow-wrap: anywhere;
}
.abele-trace-step__place {
  font-family: var(--font-monospace);
  text-decoration: none;
  cursor: var(--cursor);
}
.abele-trace-step__group > .tree-item-self {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  --abele-tree-item-weight: var(--font-semibold);
}
.abele-trace-step__frame .tree-item-inner,
.abele-trace-step__link .tree-item-inner {
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
}
body.is-phone .abele-trace-step__frame .tree-item-inner,
body.is-phone .abele-trace-step__link .tree-item-inner {
  font-size: inherit;
}
.abele-trace-step__link .abele-tree-item__text {
  flex: 0 0 auto;
}
.abele-trace-step__link .abele-tree-item__note {
  margin-inline-start: var(--size-4-2);
}
// A link the node found by itself is faint, with the wand; once confirmed, a chain link.
.abele-trace-step__link_suggested > .tree-item-self {
  color: var(--text-muted);
}
.abele-trace-step__link-mark {
  color: var(--text-muted);
}
.abele-trace-step__id {
  font-family: var(--font-monospace);
}
</style>
