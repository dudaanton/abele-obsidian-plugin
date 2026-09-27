<template>
  <div ref="card" class="abele-timeline-card" :style="place" aria-hidden="true">
    <img v-if="item.cover" class="abele-timeline-card__cover" :src="item.cover" alt="" />
    <div class="abele-timeline-card__text">
      <div class="abele-timeline-card__title">{{ item.title }}</div>
      <div class="abele-timeline-card__dates">{{ written }}</div>
      <div v-if="length" class="abele-timeline-card__line">{{ length }}</div>
      <div v-if="then" class="abele-timeline-card__line">{{ then }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The card beside the pointer over a bar or a point: its picture, its dates as the note wrote
 * them, how long it lasted, and how old the person was at the year under the pointer — or, with
 * someone picked, how old they were when this happened.
 */
import { computed, ref } from 'vue'
import { formatYear, type HistLang } from '@/bases/historyDates'
import { ageAt, isPoint, lifeOf, type TimelineItem } from '@/bases/timelineLayout'

const props = defineProps<{
  item: TimelineItem
  x: number
  y: number
  /** The year under the pointer. */
  t: number
  selected: TimelineItem | null
  lang: HistLang
}>()

const card = ref<HTMLElement>()
const years = (n: number) => (n === 1 ? '1 year' : `${n} years`)

const written = computed(() => {
  const { start, end } = props.item
  return end ? `${start.text} – ${end.text}` : start.text
})

const length = computed(() => {
  const item = props.item
  if (isPoint(item) || item.ending === 'none') return ''
  const life = lifeOf(item)
  if (!life) return 'End unknown'
  const n = Math.floor(life[1] - life[0] + 1e-9)
  const about = item.start.fuzzy || item.end?.fuzzy ? 'about ' : ''
  return item.kind === 'person' ? `Lived ${about}${years(n)}` : `Lasted ${about}${years(n)}`
})

const then = computed(() => {
  const item = props.item
  const picked = props.selected
  if (picked && picked !== item && isPoint(item)) {
    const age = ageAt(picked, item.start.at)
    return age === null ? '' : `${picked.title} was ${age}`
  }
  if (item.kind !== 'person') return ''
  const age = ageAt(item, props.t)
  return age === null ? '' : `Aged ${age} in ${formatYear(props.t, props.lang)}`
})

/** Beside the pointer, turned to the other side near the window's edges. */
const place = computed(() => {
  const win = card.value?.ownerDocument.defaultView ?? window
  const w = 280
  const h = 120
  const left = props.x + 16 + w > win.innerWidth ? props.x - 16 - w : props.x + 16
  const top = props.y + 16 + h > win.innerHeight ? props.y - 16 - h : props.y + 16
  return { left: `${Math.max(4, left)}px`, top: `${Math.max(4, top)}px` }
})
</script>

<style lang="scss">
.abele-timeline-card {
  position: fixed;
  z-index: var(--layer-tooltip);
  display: flex;
  align-items: center;
  gap: var(--size-4-3);
  max-width: 280px;
  padding: var(--size-4-2) var(--size-4-3);
  border: var(--border-width) solid var(--background-modifier-border);
  border-radius: var(--radius-m);
  background-color: var(--background-primary);
  box-shadow: var(--shadow-s);
  pointer-events: none;
}

.abele-timeline-card__cover {
  flex: 0 0 auto;
  width: var(--size-4-12);
  height: var(--size-4-12);
  border-radius: 50%;
  object-fit: cover;
}

.abele-timeline-card__text {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-1);
  min-width: 0;
}

.abele-timeline-card__title {
  font-weight: var(--font-semibold);
}

.abele-timeline-card__dates,
.abele-timeline-card__line {
  font-size: var(--font-ui-small);
  color: var(--text-muted);
}
</style>
