<template>
  <div
    class="abele-calendar-chip"
    :class="{
      [`abele-calendar-chip_color-${placed.item.color}`]: !!placed.item.color,
      'abele-calendar-chip_event': placed.item.kind === 'event',
      'abele-calendar-chip_done': placed.item.completed,
      'abele-calendar-chip_from-before': placed.fromBefore,
      'abele-calendar-chip_goes-on': placed.goesOn,
    }"
    role="button"
    tabindex="0"
    :aria-label="label"
    @click.stop="emit('open', placed, $event)"
    @keydown.enter.stop="emit('open', placed, $event)"
    @mouseover="emit('hover', placed, $event)"
    @pointerdown="drag?.press(placed, $event)"
  >
    <span v-if="time" class="abele-calendar-chip__time">{{ time }}</span>
    <span class="abele-calendar-chip__title">{{ placed.item.title }}</span>
  </div>
</template>

<script setup lang="ts">
/**
 * One thing on the calendar: a note or an event, as a short line with the colour of its group
 * (or of its calendar) down the side — the same bar the timeline gives an event. A span that
 * goes on past the day loses its rounded corners on that side.
 */
import { computed } from 'vue'
import { clock, type PlacedItem } from '@/bases/calendarLayout'
import { useCalendarDrag } from './calendarDrag'

const props = defineProps<{
  placed: PlacedItem
  /** Show the start time before the title; the week's hour grid says it by position instead. */
  withTime?: boolean
}>()

const emit = defineEmits<{
  (e: 'open', placed: PlacedItem, event: MouseEvent | KeyboardEvent): void
  (e: 'hover', placed: PlacedItem, event: MouseEvent): void
}>()

/** The view's drag, which every chip starts from; none where the chip is drawn on its own. */
const drag = useCalendarDrag()

const time = computed(() => {
  const { item, fromBefore } = props.placed
  if (!props.withTime || fromBefore || item.startMinute === null) return ''
  return clock(item.startMinute)
})

const label = computed(() =>
  [time.value, props.placed.item.title, props.placed.item.completed ? 'done' : '']
    .filter(Boolean)
    .join(', ')
)
</script>

<style lang="scss">
.abele-calendar-chip {
  display: flex;
  align-items: baseline;
  gap: var(--size-2-2);
  min-width: 0;
  padding: 0 var(--size-2-2) 0 var(--size-4-1);
  border-inline-start: var(--size-2-1) solid var(--interactive-accent);
  border-radius: var(--radius-s);
  background-color: var(--background-modifier-hover);
  font-size: var(--font-smaller);
  line-height: 1.6;
  cursor: var(--cursor-link);
  white-space: nowrap;
  // Held to be picked up on a phone, a note is not text to select or a link to preview.
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;

  &:hover,
  &:focus-visible {
    background-color: var(--background-modifier-active-hover);
  }
}

.abele-calendar-chip_lifted {
  opacity: 0.4;
}

.abele-calendar-chip_event {
  background-color: transparent;
  border-inline-start-color: var(--text-faint);
}

.abele-calendar-chip_from-before {
  border-start-start-radius: 0;
  border-end-start-radius: 0;
}

.abele-calendar-chip_goes-on {
  border-start-end-radius: 0;
  border-end-end-radius: 0;
}

.abele-calendar-chip_done .abele-calendar-chip__title {
  text-decoration: line-through;
  color: var(--text-muted);
}

.abele-calendar-chip__time {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.abele-calendar-chip__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

$colors: red, orange, yellow, green, cyan, blue, purple, pink;
@each $name in $colors {
  .abele-calendar-chip_color-#{$name} {
    border-inline-start-color: var(--color-#{$name});
  }
}
</style>
