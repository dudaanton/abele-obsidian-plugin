<template>
  <div
    ref="root"
    class="abele-calendar-base"
    :class="{ 'abele-calendar-base_narrow': narrow }"
    :data-mode="mode"
  >
    <div class="abele-calendar-base__header">
      <div class="abele-calendar-base__title">{{ title }}</div>
      <div class="abele-calendar-base__controls">
        <Icon icon="chevron-left" :tooltip="`Previous ${mode}`" @click="step(-1)" />
        <Button text="Today" tooltip="Go to today" @click="goToday" />
        <Icon icon="chevron-right" :tooltip="`Next ${mode}`" @click="step(1)" />
      </div>
      <Tabs
        class="abele-calendar-base__modes"
        level="secondary"
        :tabs="MODE_TABS"
        :model-value="mode"
        @update:model-value="(m) => instance.setMode(m as CalendarMode)"
      />
    </div>

    <div v-if="groups.length || undated" class="abele-calendar-base__legend">
      <Badge v-for="g in groups" :key="g.label" :text="g.label" :color="g.color" />
      <span v-if="undated" class="abele-calendar-base__undated">
        {{ undated === 1 ? '1 note has' : `${undated} notes have` }} no date
      </span>
    </div>

    <CalendarMonth
      v-if="mode === 'month'"
      :year="anchorYear"
      :month="anchorMonth"
      :monday-first="mondayFirst"
      :items="allItems"
      :today="today"
      :narrow="narrow"
      :selected="selected"
      :can-create="canCreate"
      @open="open"
      @hover="hover"
      @more="showMore"
      @create="(day) => instance.create(day, null)"
      @select="(day) => (selected = day)"
    />
    <CalendarWeek
      v-else-if="mode === 'week'"
      :days="weekDays(anchor, mondayFirst)"
      :items="allItems"
      :today="today"
      :now-minute="nowMinute"
      :narrow="narrow"
      :can-create="canCreate"
      @open="open"
      @hover="hover"
      @create="(day, minute) => instance.create(day, minute)"
    />
    <CalendarYear
      v-else
      :year="anchorYear"
      :monday-first="mondayFirst"
      :items="allItems"
      :today="today"
      :selected="selected"
      @month="zoomToMonth"
      @day="pickInYear"
    />

    <div
      v-if="mode !== 'week' && selected"
      class="abele-calendar-base__agenda"
      :data-day="selected"
    >
      <div class="abele-calendar-base__agenda-head">
        <span class="abele-calendar-base__agenda-date">{{ agendaTitle }}</span>
        <div class="abele-calendar-base__agenda-actions">
          <Button
            text="Week"
            icon="calendar-range"
            tooltip="Show the week of this day"
            class="abele-calendar-base__agenda-week"
            @click="zoomToWeek(selected)"
          />
          <Button
            v-if="canCreate"
            text="New note"
            icon="plus"
            tooltip="Make a note on this day"
            class="abele-calendar-base__agenda-new"
            @click="instance.create(selected, null)"
          />
        </div>
      </div>
      <div v-if="agenda.length" class="abele-calendar-base__agenda-list">
        <CalendarChip
          v-for="p in agenda"
          :key="p.item.id"
          :placed="p"
          with-time
          class="abele-calendar-base__agenda-item"
          @open="open"
          @hover="hover"
        />
      </div>
      <EmptyState v-else text="Nothing on this day." />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The calendar view of a base: the header — where you are, back, today, on, and which layout —
 * and the month, week or year under it. The notes come from the base through the instance its
 * view hands over; events from the external calendars are added here when the view asks for
 * them, and pressing one gives the same menu as in the timeline.
 *
 * Narrow is the view's own width, not the window's: a base in a sidebar is as narrow as a phone.
 */
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { Menu } from 'obsidian'
import { useNow } from '@vueuse/core'
import dayjs from 'dayjs'
import Tabs, { type Tab } from '../obsidian/Tabs.vue'
import Icon from '../obsidian/Icon.vue'
import Button from '../obsidian/Button.vue'
import Badge from '../obsidian/Badge.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import CalendarChip from './CalendarChip.vue'
import CalendarMonth from './CalendarMonth.vue'
import CalendarWeek from './CalendarWeek.vue'
import CalendarYear from './CalendarYear.vue'
import { CALENDAR_DRAG, createCalendarDrag } from './calendarDrag'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { calendars } from '@/calendars/CalendarService'
import type { CalendarEvent } from '@/calendars/events'
import { openEventMenu } from '@/calendars/eventMenu'
import type { CalendarBaseInstance } from '@/bases/CalendarView'
import {
  addDays,
  eventToItem,
  placeByDay,
  startOfWeek,
  weekDays,
  type CalendarItem,
  type CalendarMode,
  type PlacedItem,
} from '@/bases/calendarLayout'

/** Below this width of the view a month shows dots and a list, and a week scrolls sideways. */
const NARROW = 520

const MODE_TABS: Tab[] = [
  { id: 'month', label: 'Month', tooltip: 'Show a month' },
  { id: 'week', label: 'Week', tooltip: 'Show a week, by the hour' },
  { id: 'year', label: 'Year', tooltip: 'Show the whole year' },
]

const props = defineProps<{ instance: CalendarBaseInstance }>()

const mode = computed(() => props.instance.mode.value)
const groups = computed(() => props.instance.groups.value)
const undated = computed(() => props.instance.undated.value)
const canCreate = computed(() => props.instance.canCreate.value)
const mondayFirst = computed(() => GlobalStore.getInstance().weekStartsOnMonday.value)

const nowDate = useNow({ interval: 60_000 })
const today = computed(() => dayjs(nowDate.value).format('YYYY-MM-DD'))
const nowMinute = computed(() => nowDate.value.getHours() * 60 + nowDate.value.getMinutes())

/** The day the view is on; it opens on today and is not stored. */
const anchor = ref(today.value)
const anchorYear = computed(() => Number(anchor.value.slice(0, 4)))
const anchorMonth = computed(() => Number(anchor.value.slice(5, 7)) - 1)
/** The picked day of the month or the year, whose items are listed under it. */
const selected = ref<string | null>(today.value)

// ---- the external calendars' events --------------------------------------------------------

const config = AbeleConfig.getInstance()
const eventsById = computed(() => {
  const out = new Map<string, { event: CalendarEvent; item: CalendarItem }>()
  if (!props.instance.showEvents.value) return out
  void config.version.value
  for (const shown of calendars().byDay().values()) {
    for (const { event, feed } of shown) {
      if (out.has(event.id)) continue
      const item = eventToItem(event, feed.color)
      if (item) out.set(event.id, { event, item: Object.freeze(item) })
    }
  }
  return out
})

const allItems = computed<readonly CalendarItem[]>(() => {
  const events = eventsById.value
  const notes = props.instance.items.value
  if (!events.size) return notes
  return [...notes, ...[...events.values()].map((e) => e.item)]
})

// ---- where the view is ---------------------------------------------------------------------

const title = computed(() => {
  const at = dayjs(anchor.value)
  if (mode.value === 'year') return at.format('YYYY')
  if (mode.value === 'month') return at.format('MMMM YYYY')
  const first = dayjs(startOfWeek(anchor.value, mondayFirst.value))
  const last = first.add(6, 'day')
  if (first.month() === last.month()) return `${first.format('MMMM D')} – ${last.format('D, YYYY')}`
  if (first.year() === last.year())
    return `${first.format('MMM D')} – ${last.format('MMM D, YYYY')}`
  return `${first.format('MMM D, YYYY')} – ${last.format('MMM D, YYYY')}`
})

const step = (by: number) => {
  const at = dayjs(anchor.value)
  if (mode.value === 'week') anchor.value = addDays(anchor.value, 7 * by)
  else if (mode.value === 'year') {
    anchor.value = at.add(by, 'year').format('YYYY-MM-DD')
    selected.value = null
  } else {
    anchor.value = at.startOf('month').add(by, 'month').format('YYYY-MM-DD')
    selected.value = null
  }
}

const goToday = () => {
  anchor.value = today.value
  selected.value = today.value
}

const zoomToWeek = (day: string) => {
  anchor.value = day
  props.instance.setMode('week')
}

/** A day of the year picked: listed under it, and the month that opens next is its month. */
const pickInYear = (day: string) => {
  anchor.value = day
  selected.value = day
}

const zoomToMonth = (month: number) => {
  anchor.value = `${anchorYear.value}-${String(month + 1).padStart(2, '0')}-01`
  selected.value = null
  props.instance.setMode('month')
}

// ---- dragging a note -----------------------------------------------------------------------

provide(
  CALENDAR_DRAG,
  createCalendarDrag({
    enabled: () => props.instance.canCreate.value,
    drop: (placed, to) => {
      props.instance.move(placed.item, placed.day, to.day, to.minute)
      // The list under the month follows the note to where it went.
      if (mode.value !== 'week' && selected.value) selected.value = to.day
    },
  })
)

// ---- the picked day's list -----------------------------------------------------------------

const agenda = computed(() => {
  const day = selected.value
  if (!day) return []
  return placeByDay(allItems.value, day, day).get(day) ?? []
})

const agendaTitle = computed(() =>
  selected.value ? dayjs(selected.value).format('dddd, D MMMM') : ''
)

// ---- pressing things -----------------------------------------------------------------------

const open = (placed: PlacedItem, event: MouseEvent | KeyboardEvent) => {
  if (placed.item.kind === 'event') {
    const found = eventsById.value.get(placed.item.id)
    if (found) openEventMenu(found.event, placed.day, event)
    return
  }
  props.instance.open(placed.item, event)
}

const hover = (placed: PlacedItem, event: MouseEvent) => {
  if (placed.item.kind === 'note') props.instance.hover(placed.item, event)
}

/** The rest of a full day, in Obsidian's own menu: each one opens as if pressed in the grid. */
const showMore = (_day: string, rest: PlacedItem[], event: MouseEvent | KeyboardEvent) => {
  const menu = new Menu()
  for (const placed of rest) {
    menu.addItem((item) =>
      item
        .setTitle(placed.item.title)
        .setIcon(placed.item.kind === 'event' ? 'calendar' : 'file-text')
        .onClick((clicked) => open(placed, clicked instanceof MouseEvent ? clicked : event))
    )
  }
  if (event instanceof MouseEvent) menu.showAtMouseEvent(event)
  else {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    menu.showAtPosition({ x: box.left, y: box.bottom })
  }
}

// ---- how wide it is ------------------------------------------------------------------------

const root = ref<HTMLElement>()
const narrow = ref(false)
let observer: ResizeObserver | null = null

onMounted(() => {
  const el = root.value
  if (!el) return
  observer = new ResizeObserver((entries) => {
    const width = entries[0]?.contentRect.width ?? el.clientWidth
    if (width > 0) narrow.value = width < NARROW
  })
  observer.observe(el)
  if (el.clientWidth > 0) narrow.value = el.clientWidth < NARROW
})

onBeforeUnmount(() => observer?.disconnect())

// A new month picked on a narrow screen starts with nothing listed, unless it holds today.
watch(anchorMonth, () => {
  if (selected.value && !selected.value.startsWith(anchor.value.slice(0, 7))) selected.value = null
})
</script>

<style lang="scss">
.abele-calendar-base {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);
  padding: var(--size-4-2) var(--size-4-4) var(--size-4-6);
}

.abele-calendar-base__header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--size-4-2) var(--size-4-4);
}

// The mini calendar's header, at the size of a page rather than a sidebar.
.abele-calendar-base__title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--font-ui-large);
  font-weight: bold;
}

.abele-calendar-base__controls {
  display: flex;
  align-items: center;
  gap: var(--size-2-2);
}

.abele-calendar-base__legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--size-2-3);
}

.abele-calendar-base__undated {
  font-size: var(--font-smallest);
  color: var(--text-muted);
}

.abele-calendar-base__agenda {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
}

.abele-calendar-base__agenda-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--size-4-2);
}

.abele-calendar-base__agenda-date {
  flex: 1 1 auto;
  font-weight: bold;
}

// The buttons stay side by side; on a phone they drop under the date together.
.abele-calendar-base__agenda-actions {
  display: flex;
  flex: 0 0 auto;
  gap: var(--size-2-3);
}

.abele-calendar-base__agenda-list {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
}

// A row a finger can press: the chip at the size of body text.
.abele-calendar-base__agenda-item {
  padding-block: var(--size-4-1);
  font-size: var(--font-ui-small);
}

// Where a dragged note would land, and the note itself under the pointer.
.abele-calendar-drop-target {
  background-color: var(--background-modifier-hover);
  box-shadow: inset 0 0 0 1px var(--interactive-accent);
}

.abele-calendar-drag-ghost,
.abele-calendar-drop-marker {
  position: fixed;
  z-index: var(--layer-dragged-item);
  pointer-events: none;
  font-size: var(--font-smaller);
}

.abele-calendar-drag-ghost {
  max-width: 16em;
  padding: var(--size-2-1) var(--size-4-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-inline-start: var(--size-2-1) solid var(--interactive-accent);
  border-radius: var(--radius-s);
  background-color: var(--background-primary);
  box-shadow: var(--shadow-s);
}

.abele-calendar-drop-marker {
  padding: 0 var(--size-2-2);
  border-radius: var(--radius-s);
  background-color: var(--background-modifier-active-hover);
  border: 1px dashed var(--interactive-accent);
  color: var(--text-normal);
  font-variant-numeric: tabular-nums;
}

body.abele-calendar-dragging,
body.abele-calendar-dragging * {
  cursor: grabbing !important;
}

// Narrow, the title takes its own line and the controls and layouts share the next.
.abele-calendar-base_narrow {
  padding-inline: var(--size-4-2);
  .abele-calendar-base__title {
    flex-basis: 100%;
  }
}
</style>
