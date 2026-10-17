<template>
  <EntryRow
    class="abele-calendar-event"
    :class="[`abele-calendar-event_color-${feed.color}`, { 'is-checked': done }]"
    :data-task="done ? 'x' : undefined"
    role="button"
    tabindex="0"
    :aria-label="
      t('area.eventLabel', { title: event.title, time: timeText, calendar: calendarName })
    "
    :more="event.description ? showDescription : undefined"
    @update:more="showDescription = $event"
    @click="openMenu"
    @contextmenu.prevent="openMenu"
    @keydown.enter="openMenu"
  >
    <template #leading>
      <label class="task-list-label" contenteditable="false">
        <input
          class="task-list-item-checkbox"
          type="checkbox"
          :checked="done"
          :aria-label="`${done ? t('area.markUndone') : t('area.markDone')}: ${event.title}`"
          @click.stop.prevent="toggleEventDone(event)"
          @keydown.stop
        />
      </label>
    </template>
    <div class="abele-calendar-event__title">{{ event.title }}</div>
    <!-- The same codes as a task row: when, and which calendar as a dot of its colour. -->
    <template #codes>
      <span
        class="abele-calendar-event__time"
        :aria-label="t('area.calendarFrom', { calendar: calendarName })"
      >
        <span class="abele-calendar-event__bar" />{{ timeText }}
      </span>
    </template>
    <template v-if="event.location" #meta>
      <span class="abele-calendar-event__location">{{ event.location }}</span>
    </template>
    <template v-if="showDescription && event.description" #detail>
      <div class="abele-calendar-event__description">{{ event.description }}</div>
    </template>
  </EntryRow>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
/**
 * One external occurrence beside tasks. The checkbox is the owner's local mark, not a
 * calendar edit. Pressing the card offers that mark, a meeting note and its link.
 */
import { computed, ref } from 'vue'
import EntryRow from './obsidian/EntryRow.vue'
import type { CalendarEvent } from '@/calendars/events'
import { eventDays, localDay } from '@/calendars/events'
import { feedLabel, type CalendarFeed } from '@/calendars/settings'
import { clockTime, eventTimeText } from '@/calendars/meetingNote'
import { openEventMenu, toggleEventDone } from '@/calendars/eventMenu'
import { calendars } from '@/calendars/CalendarService'

const props = defineProps<{
  event: CalendarEvent
  feed: CalendarFeed
  /** The day of the list it is shown under, `YYYY-MM-DD`: a long event says where it stands. */
  day: string
}>()

const showDescription = ref(false)
const done = computed(() => calendars().isDone(props.event))

const calendarName = computed(() => feedLabel(props.feed))

const timeText = computed(() => {
  const event = props.event
  if (event.allDay) {
    const days = eventDays(event)
    return days.length > 1
      ? t('area.allDayIndex', { index: days.indexOf(props.day) + 1, total: days.length })
      : t('area.allDay')
  }
  const startsToday = localDay(event.start) === props.day
  const endsToday = localDay(Math.max(event.start, event.end - 1)) === props.day
  if (startsToday && endsToday) return eventTimeText(event)
  if (startsToday) return t('area.fromTime', { time: clockTime(event.start) })
  if (endsToday) return t('area.untilTime', { time: clockTime(event.end) })
  return t('area.allDay')
})

const openMenu = (e: MouseEvent | KeyboardEvent) => openEventMenu(props.event, props.day, e)
</script>

<style lang="scss">
.abele-calendar-event.is-checked .abele-calendar-event__title {
  text-decoration: var(--checklist-done-decoration);
  color: var(--checklist-done-color);
}

// The calendar's colour, as a dot before the time; its name is in the row's label.
.abele-calendar-event__bar {
  display: inline-block;
  width: var(--size-2-3);
  height: var(--size-2-3);
  margin-inline-end: var(--size-2-2);
  border-radius: 50%;
  vertical-align: middle;
  background-color: var(--text-faint);
}

$colors: red, orange, yellow, green, cyan, blue, purple, pink;
@each $name in $colors {
  .abele-calendar-event_color-#{$name} .abele-calendar-event__bar {
    background-color: var(--color-#{$name});
  }
}

.abele-calendar-event__description {
  white-space: pre-wrap;
  color: var(--text-muted);
  font-size: var(--font-smaller);
  user-select: text;
}
</style>
