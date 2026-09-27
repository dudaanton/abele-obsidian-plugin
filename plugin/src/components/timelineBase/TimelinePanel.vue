<template>
  <div class="abele-timeline-panel" :data-selected="selected.path">
    <div class="abele-timeline-panel__head">
      <div class="abele-timeline-panel__title">{{ selected.title }}</div>
      <Icon icon="x" tooltip="Let go of the pick" @click="emit('close')" />
    </div>
    <div class="abele-timeline-panel__dates">{{ summary }}</div>

    <div v-if="rows.length" class="abele-timeline-panel__caption">{{ caption }}</div>
    <div class="abele-timeline-panel__list">
      <div
        v-for="row in shown"
        :key="row.item.id"
        class="abele-timeline-panel__row"
        tabindex="0"
        role="button"
        @click="emit('select', row.item)"
        @keydown.enter.prevent="emit('select', row.item)"
      >
        <span class="abele-timeline-panel__dot" :class="dotClass(row.item)" />
        <span class="abele-timeline-panel__name">{{ row.item.title }}</span>
        <span class="abele-timeline-panel__years">{{ datesOf(row.item, lang) }}</span>
        <span class="abele-timeline-panel__together">{{ row.text }}</span>
      </div>
      <div v-if="rows.length > shown.length" class="abele-timeline-panel__more">
        and {{ rows.length - shown.length }} more
      </div>
    </div>

    <div class="abele-timeline-panel__actions">
      <Button
        text="Open note"
        icon="file-text"
        accent
        tooltip="Open this note"
        @click="emit('open', selected, null)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * What the pick is and who shares its time: for a life or a period, everyone who lived at the
 * same time and for how many years, most first; for an event, who was alive then and how old;
 * for an era, who lived in it. A row picks that note in turn; the note itself opens from the
 * button — on a phone a tap on the drawing picks, it never opens, so a finger that lands on a
 * neighbour costs nothing.
 */
import { computed } from 'vue'
import Button from '../obsidian/Button.vue'
import Icon from '../obsidian/Icon.vue'
import type { HistLang } from '@/bases/historyDates'
import { ageAt, isPoint, lifeOf, together, type TimelineItem } from '@/bases/timelineLayout'
import { datesOf } from './timelineText'

/** A list longer than this is cut, with how many are left out. */
const MAX_ROWS = 200

const props = defineProps<{
  selected: TimelineItem
  items: readonly TimelineItem[]
  lang: HistLang
}>()

const emit = defineEmits<{
  (e: 'select', item: TimelineItem): void
  (e: 'open', item: TimelineItem, event: MouseEvent | KeyboardEvent | null): void
  (e: 'close'): void
}>()

const years = (n: number) => (n < 1 ? 'under a year' : n === 1 ? '1 year' : `${n} years`)

const summary = computed(() => {
  const s = props.selected
  const dates = datesOf(s, props.lang)
  const life = lifeOf(s)
  if (!life || isPoint(s) || s.ending === 'none') return dates
  return `${dates} · ${s.start.fuzzy || s.end?.fuzzy ? 'about ' : ''}${years(Math.floor(life[1] - life[0] + 1e-9))}`
})

interface Row {
  item: TimelineItem
  text: string
}

const rows = computed<Row[]>(() => {
  const s = props.selected
  if (isPoint(s) || s.ending === 'none') {
    // Who was alive when it happened, and how old.
    const out: Row[] = []
    for (const item of props.items) {
      if (item === s || item.kind === 'era' || item.ending === 'none') continue
      const age = ageAt(item, s.start.at)
      if (age === null) continue
      out.push({ item, text: item.kind === 'person' ? `aged ${age}` : `year ${age + 1}` })
    }
    return out.sort((a, b) => a.item.from - b.item.from)
  }
  return together(s, props.items).map((t) => ({
    item: t.item,
    text: `${t.approx ? 'about ' : ''}${years(t.years)}`,
  }))
})

const shown = computed(() => rows.value.slice(0, MAX_ROWS))

const caption = computed(() => {
  const n = rows.value.length
  const s = props.selected
  if (isPoint(s) || s.ending === 'none') return `Alive at the time: ${n}`
  if (s.kind === 'era') return `Lived in it: ${n}. Years in the era:`
  return `Contemporaries: ${n}. Years lived at the same time:`
})

const dotClass = (item: TimelineItem) =>
  item.color ? `abele-timeline-panel__dot_${item.color}` : 'abele-timeline-panel__dot_accent'
</script>

<style lang="scss">
.abele-timeline-panel {
  display: flex;
  flex-direction: column;
  flex: 0 0 18rem;
  gap: var(--size-4-2);
  min-height: 0;
  padding: var(--size-4-3) 0 var(--size-4-2);
}

.abele-timeline-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--size-4-2);
}

.abele-timeline-panel__title {
  min-width: 0;
  font-size: var(--font-ui-medium);
  font-weight: var(--font-semibold);
  overflow-wrap: anywhere;
}

.abele-timeline-panel__dates,
.abele-timeline-panel__caption {
  font-size: var(--font-ui-small);
  color: var(--text-muted);
}

.abele-timeline-panel__list {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.abele-timeline-panel__row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  grid-template-areas:
    'dot name together'
    '. years years';
  align-items: baseline;
  column-gap: var(--size-4-2);
  padding: var(--size-4-1) var(--size-2-3);
  border-block-end: var(--border-width) solid var(--background-modifier-border);
  border-radius: var(--radius-s);
  font-size: var(--font-ui-small);
  cursor: var(--cursor-link);

  &:hover,
  &:focus-visible {
    background-color: var(--background-modifier-hover);
  }
}

.abele-timeline-panel__dot {
  grid-area: dot;
  width: var(--size-4-2);
  height: var(--size-4-2);
  border-radius: 50%;
  background-color: var(--interactive-accent);
}

$colors: red, orange, yellow, green, cyan, blue, purple, pink;
@each $name in $colors {
  .abele-timeline-panel__dot_#{$name} {
    background-color: var(--color-#{$name});
  }
}

.abele-timeline-panel__name {
  grid-area: name;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.abele-timeline-panel__years {
  grid-area: years;
  font-size: var(--font-smallest);
  color: var(--text-faint);
}

.abele-timeline-panel__together {
  grid-area: together;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.abele-timeline-panel__more {
  padding: var(--size-4-1) var(--size-2-3);
  font-size: var(--font-smallest);
  color: var(--text-faint);
}

.abele-timeline-panel__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-2-3);
}

// Under the drawing on a narrow view: a sheet of its own, half the height at most.
.abele-timeline-base_stacked .abele-timeline-panel {
  flex: 1 1 0;
  padding-block-start: var(--size-4-2);
  border-block-start: var(--border-width) solid var(--background-modifier-border);
}
</style>
