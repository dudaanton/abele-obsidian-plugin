<template>
  <div
    class="abele-calendar-chip"
    :class="{
      [`abele-calendar-chip_color-${placed.item.color}`]: !!placed.item.color,
      'abele-calendar-chip_event': placed.item.kind === 'event',
      'abele-calendar-chip_done': placed.item.completed,
      'abele-calendar-chip_from-before': placed.fromBefore,
      'abele-calendar-chip_goes-on': placed.goesOn,
      'abele-calendar-chip_row': timeColumn,
    }"
    role="button"
    tabindex="0"
    :aria-label="label"
    @click.stop="emit('open', placed, $event)"
    @keydown.enter.stop="emit('open', placed, $event)"
    @mouseover="emit('hover', placed, $event)"
    @pointerdown="drag?.press(placed, $event)"
  >
    <input
      v-if="placed.item.kind === 'event'"
      class="task-list-item-checkbox"
      type="checkbox"
      :checked="placed.item.completed"
      :aria-label="`${placed.item.completed ? t('area.markUndone') : t('area.markDone')}: ${placed.item.title}`"
      @pointerdown.stop
      @keydown.stop
      @click.stop.prevent="toggleDone"
    />
    <!-- A note's group colour as a dot where an event has its box to tick. -->
    <span v-else class="abele-calendar-chip__dot" aria-hidden="true" />
    <span v-if="time || timeColumn" class="abele-calendar-chip__time">{{ time }}</span>
    <span class="abele-calendar-chip__title">{{ placed.item.title }}</span>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
/**
 * One thing on the calendar: a note or an event, as a short line on a light wash of the colour
 * of its group (or of its calendar), a note led by a dot of that colour and an event by its box
 * to tick. No bar down the side. A span that goes on past the day loses its rounded corners on
 * that side, so the days read as one.
 */
import { computed } from 'vue'
import { clock, type PlacedItem } from '@/bases/calendarLayout'
import { useCalendarDrag } from './calendarDrag'
import { calendars } from '@/calendars/CalendarService'
import { toggleEventDone } from '@/calendars/eventMenu'

const props = defineProps<{
  placed: PlacedItem
  /** Show the start time before the title; the week's hour grid says it by position instead. */
  withTime?: boolean
  /** A list of the day keeps a column for the time, empty where there is none, so titles line up. */
  timeColumn?: boolean
}>()

const emit = defineEmits<{
  (e: 'open', placed: PlacedItem, event: MouseEvent | KeyboardEvent): void
  (e: 'hover', placed: PlacedItem, event: MouseEvent): void
}>()

/** The view's drag, which every chip starts from; none where the chip is drawn on its own. */
const drag = useCalendarDrag()

const toggleDone = () => {
  const found = calendars().eventById(props.placed.item.id)
  if (found) void toggleEventDone(found)
}

const time = computed(() => {
  const { item, fromBefore } = props.placed
  if (!props.withTime || fromBefore || item.startMinute === null) return ''
  return clock(item.startMinute)
})

const label = computed(() =>
  [time.value, props.placed.item.title, props.placed.item.completed ? t('area.doneLower') : '']
    .filter(Boolean)
    .join(', ')
)
</script>

<style lang="scss">
.abele-calendar-chip {
  // The colour of its group or calendar; a wash of it behind, a dot of it in front.
  --abele-chip-color: var(--interactive-accent);
  display: flex;
  align-items: baseline;
  gap: var(--size-2-2);
  min-width: 0;
  padding: 0 var(--size-2-3);
  border-radius: var(--radius-s);
  background-color: color-mix(in srgb, var(--abele-chip-color) 12%, transparent);
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
    background-color: color-mix(in srgb, var(--abele-chip-color) 22%, transparent);
  }

  // The box sits on the words' line, the size of the dot's column.
  > .task-list-item-checkbox {
    flex: 0 0 auto;
    align-self: center;
    margin: 0;
  }
}

.abele-calendar-chip__dot {
  display: flex;
  flex: 0 0 auto;
  align-self: center;
  justify-content: center;

  &::before {
    content: '';
    width: var(--size-4-2);
    height: var(--size-4-2);
    border-radius: 50%;
    background-color: var(--abele-chip-color);
  }
}

// In a list of the day: rows, not washes. The dot stands in the box's column, the time in a
// column of its own, so every title starts at one edge.
.abele-calendar-chip_row {
  gap: var(--size-4-2);
  padding: var(--size-2-2) var(--size-2-3);
  background-color: transparent;
  font-size: var(--font-ui-small);

  &:hover,
  &:focus-visible {
    background-color: var(--background-modifier-hover);
  }

  .abele-calendar-chip__dot {
    width: var(--checkbox-size);
  }

  .abele-calendar-chip__time {
    min-width: 5ch;
  }
}

.abele-calendar-chip_lifted {
  opacity: 0.4;
}

// An event without a calendar colour washes quiet grey.
.abele-calendar-chip_event:not([class*='abele-calendar-chip_color-']) {
  --abele-chip-color: var(--text-faint);
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
    --abele-chip-color: var(--color-#{$name});
  }
}
</style>
