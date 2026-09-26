<template>
  <div
    class="abele-calendar-event"
    :class="`abele-calendar-event_color-${feed.color}`"
    role="button"
    tabindex="0"
    :aria-label="`${event.title}, ${timeText}, from ${calendarName}`"
    @click="openMenu"
    @contextmenu.prevent="openMenu"
    @keydown.enter="openMenu"
  >
    <div class="abele-calendar-event__bar" />
    <div class="abele-calendar-event__content">
      <div class="abele-calendar-event__title">{{ event.title }}</div>
      <div class="abele-calendar-event__info">
        <b>{{ timeText }}</b>
        <span v-if="event.location" class="abele-calendar-event__location">{{
          event.location
        }}</span>
        <Badge :text="calendarName" :color="feed.color" />
      </div>
      <div v-if="showDescription && event.description" class="abele-calendar-event__description">
        {{ event.description }}
      </div>
    </div>
    <ObsidianIcon
      v-if="event.description"
      :icon="showDescription ? 'chevron-up' : 'chevron-down'"
      :tooltip="showDescription ? 'Hide the description' : 'Show the description'"
      @click.stop="showDescription = !showDescription"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * One event from an external calendar in a list of tasks. Read only, and made to look it: no
 * checkbox, a bar in the calendar's colour where a task has none, and the calendar's name.
 * A click offers what can be done with it — a note about it, its link.
 */
import { computed, ref } from 'vue'
import { Menu, Notice } from 'obsidian'
import ObsidianIcon from './obsidian/Icon.vue'
import Badge from './obsidian/Badge.vue'
import type { CalendarEvent } from '@/calendars/events'
import { eventDays, localDay } from '@/calendars/events'
import { feedLabel, type CalendarFeed } from '@/calendars/settings'
import { clockTime, createMeetingNote, eventTimeText } from '@/calendars/meetingNote'

const props = defineProps<{
  event: CalendarEvent
  feed: CalendarFeed
  /** The day of the list it is shown under, `YYYY-MM-DD`: a long event says where it stands. */
  day: string
}>()

const showDescription = ref(false)

const calendarName = computed(() => feedLabel(props.feed))

const timeText = computed(() => {
  const event = props.event
  if (event.allDay) {
    const days = eventDays(event)
    return days.length > 1 ? `All day, ${days.indexOf(props.day) + 1} of ${days.length}` : 'All day'
  }
  const startsToday = localDay(event.start) === props.day
  const endsToday = localDay(Math.max(event.start, event.end - 1)) === props.day
  if (startsToday && endsToday) return eventTimeText(event)
  if (startsToday) return `From ${clockTime(event.start)}`
  if (endsToday) return `Until ${clockTime(event.end)}`
  return 'All day'
})

const openMenu = (e: MouseEvent | KeyboardEvent) => {
  const menu = new Menu()
  menu.addItem((item) =>
    item
      .setTitle('Create meeting note')
      .setIcon('file-plus')
      .onClick(() => {
        createMeetingNote(props.event, props.day).catch((err) => {
          new Notice(`The meeting note could not be created: ${(err as Error).message}`)
        })
      })
  )
  if (props.event.url) {
    menu.addItem((item) =>
      item
        .setTitle('Open the event link')
        .setIcon('external-link')
        .onClick(() => window.open(props.event.url, '_blank'))
    )
  }
  if (e instanceof MouseEvent) menu.showAtMouseEvent(e)
  else {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
    menu.showAtPosition({ x: box.left, y: box.bottom })
  }
}
</script>

<style lang="scss">
.abele-calendar-event {
  display: flex;
  align-items: flex-start;
  gap: 0.5em;
  margin-bottom: 0.25em;
  padding: 0.25em 0;
  cursor: pointer;
  border-radius: var(--radius-s);

  &:hover {
    background-color: var(--background-modifier-hover);
  }
}

// Where a task has its checkbox: a mark that cannot be ticked, in the calendar's colour.
.abele-calendar-event__bar {
  flex: 0 0 auto;
  align-self: stretch;
  width: var(--size-2-2);
  margin-inline-start: var(--size-2-2);
  margin-inline-end: var(--size-2-1);
  border-radius: var(--radius-s);
  background-color: var(--text-faint);
}

$colors: red, orange, yellow, green, cyan, blue, purple, pink;
@each $name in $colors {
  .abele-calendar-event_color-#{$name} .abele-calendar-event__bar {
    background-color: var(--color-#{$name});
  }
}

.abele-calendar-event__content {
  flex: 1;
  min-width: 0;
  overflow-wrap: break-word;
}

.abele-calendar-event__info {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--size-2-2);
  margin-top: var(--size-2-1);
  font-size: var(--font-smaller);
  color: var(--text-muted);
}

.abele-calendar-event__location {
  min-width: 0;
  overflow-wrap: anywhere;
}

.abele-calendar-event__description {
  margin-top: var(--size-2-2);
  white-space: pre-wrap;
  color: var(--text-muted);
  font-size: var(--font-smaller);
  user-select: text;
}
</style>
