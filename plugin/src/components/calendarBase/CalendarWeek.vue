<template>
  <!-- A deliberate sideways scroller on a narrow screen: seven readable columns do not fit a
       phone, so the week moves under the finger instead of squeezing every title to a letter. -->
  <div ref="scroller" class="abele-calendar-week" :class="{ 'abele-calendar-week_narrow': narrow }">
    <div class="abele-calendar-week__inner">
      <div class="abele-calendar-week__row abele-calendar-week__head">
        <div class="abele-calendar-week__gutter" />
        <div
          v-for="day in days"
          :key="day"
          class="abele-calendar-week__day-head"
          :class="{ 'abele-calendar-week__day-head_today': day === today }"
          :data-day="day"
        >
          <span class="abele-calendar-week__weekday">{{ weekdayName(day) }}</span>
          <span class="abele-calendar-week__date">{{ Number(day.slice(8)) }}</span>
        </div>
      </div>
      <div class="abele-calendar-week__row abele-calendar-week__all-day">
        <div class="abele-calendar-week__gutter abele-calendar-week__gutter-label">All day</div>
        <div
          v-for="day in days"
          :key="day"
          class="abele-calendar-week__all-day-cell"
          :data-day="day"
          :data-drop-day="day"
          @click="canCreate && emit('create', day, null)"
        >
          <CalendarChip
            v-for="p in allDay.get(day) ?? []"
            :key="p.item.id"
            :placed="p"
            with-time
            @open="(pl, e) => emit('open', pl, e)"
            @hover="(pl, e) => emit('hover', pl, e)"
          />
        </div>
      </div>
      <div ref="hoursEl" class="abele-calendar-week__hours">
        <div class="abele-calendar-week__row abele-calendar-week__grid">
          <div class="abele-calendar-week__gutter">
            <div v-for="h in 24" :key="h" class="abele-calendar-week__hour-label">
              {{ h === 1 ? '' : clock((h - 1) * 60) }}
            </div>
          </div>
          <div
            v-for="day in days"
            :key="day"
            class="abele-calendar-week__column"
            :class="{ 'abele-calendar-week__column_today': day === today }"
            :data-day="day"
            :data-drop-day="day"
            data-drop-hours
            @click="onColumnClick(day, $event)"
          >
            <div v-for="h in 24" :key="h" class="abele-calendar-week__slot" />
            <div
              v-for="block in timed.get(day) ?? []"
              :key="block.item.id"
              class="abele-calendar-week__block"
              :style="{
                '--abele-block-top': block.top / MINUTES_IN_DAY,
                '--abele-block-height': (block.bottom - block.top) / MINUTES_IN_DAY,
                '--abele-block-column': block.column,
                '--abele-block-columns': block.columns,
              }"
            >
              <CalendarChip
                :placed="{ item: block.item, day, fromBefore: false, goesOn: false }"
                with-time
                class="abele-calendar-week__chip"
                @open="(pl, e) => emit('open', pl, e)"
                @hover="(pl, e) => emit('hover', pl, e)"
              />
            </div>
            <div
              v-if="day === today"
              class="abele-calendar-week__now"
              :style="{ '--abele-block-top': nowMinute / MINUTES_IN_DAY }"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * A week as seven columns: what has no time, or lasts several days, in a row at the top, and
 * the rest on the hours by when it starts and ends. Things at the same time share the width.
 * Pressing an empty hour makes a note at that hour; a note dragged onto the hours takes the one
 * it is let go at, onto the row at the top keeps its time and only changes its day.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import dayjs from 'dayjs'
import CalendarChip from './CalendarChip.vue'
import {
  MINUTES_IN_DAY,
  clock,
  isTimed,
  layoutTimed,
  placeByDay,
  type CalendarItem,
  type PlacedItem,
  type TimedBlock,
} from '@/bases/calendarLayout'

const props = defineProps<{
  days: string[]
  items: readonly CalendarItem[]
  today: string
  nowMinute: number
  narrow: boolean
  canCreate: boolean
}>()

const emit = defineEmits<{
  (e: 'open', placed: PlacedItem, event: MouseEvent | KeyboardEvent): void
  (e: 'hover', placed: PlacedItem, event: MouseEvent): void
  (e: 'create', day: string, minute: number | null): void
}>()

const scroller = ref<HTMLElement>()
const hoursEl = ref<HTMLElement>()

const placed = computed(() => placeByDay(props.items, props.days[0], props.days[6]))

const allDay = computed(() => {
  const out = new Map<string, PlacedItem[]>()
  for (const [day, list] of placed.value)
    out.set(
      day,
      list.filter((p) => !isTimed(p.item))
    )
  return out
})

const timed = computed(() => {
  const out = new Map<string, TimedBlock[]>()
  for (const [day, list] of placed.value) {
    out.set(day, layoutTimed(list.map((p) => p.item)))
  }
  return out
})

const weekdayName = (day: string) => dayjs(day).format('ddd')

/** The hour pressed, to the half hour, from where in the column the press landed. */
const onColumnClick = (day: string, event: MouseEvent) => {
  if (!props.canCreate) return
  const column = event.currentTarget as HTMLElement
  const box = column.getBoundingClientRect()
  if (!box.height) return
  const minute = Math.floor((((event.clientY - box.top) / box.height) * MINUTES_IN_DAY) / 30) * 30
  emit('create', day, Math.max(0, Math.min(MINUTES_IN_DAY - 30, minute)))
}

/**
 * Opens on the morning — or on now, for this week — rather than at midnight, and on a narrow
 * screen with today's column in view.
 */
const scrollToStart = async () => {
  await nextTick()
  const hours = hoursEl.value
  if (hours) {
    const hasToday = props.days.includes(props.today)
    const minute = hasToday ? Math.max(0, props.nowMinute - 120) : 8 * 60
    hours.scrollTop = (hours.scrollHeight * minute) / MINUTES_IN_DAY
  }
  const box = scroller.value
  if (box && props.narrow) {
    const column = box.querySelector<HTMLElement>(
      `.abele-calendar-week__day-head[data-day="${props.today}"]`
    )
    box.scrollLeft = column ? Math.max(0, column.offsetLeft - column.offsetWidth) : 0
  }
}

onMounted(scrollToStart)
watch(() => props.days[0], scrollToStart)
</script>

<style lang="scss">
.abele-calendar-week {
  --abele-calendar-hour: var(--size-4-12);
  --abele-calendar-gutter: 3.2em;
  min-width: 0;
}

// Sideways only where seven columns cannot be read: see the comment in the template.
.abele-calendar-week_narrow {
  overflow-x: auto;
  .abele-calendar-week__inner {
    min-width: calc(var(--abele-calendar-gutter) + 7 * 7.5em);
  }
}

.abele-calendar-week__row {
  display: grid;
  grid-template-columns: var(--abele-calendar-gutter) repeat(7, minmax(0, 1fr));
}

// The hours stay in view while a narrow week is moved sideways.
.abele-calendar-week__gutter {
  position: sticky;
  inset-inline-start: 0;
  z-index: 1;
  background-color: var(--background-primary);
}

.abele-calendar-week__day-head {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-bottom: var(--size-4-1);
  color: var(--text-muted);
}

.abele-calendar-week__weekday {
  font-size: var(--font-ui-smaller);
  font-weight: bold;
}

.abele-calendar-week__date {
  min-width: 1.8em;
  border-radius: var(--radius-s);
  text-align: center;
  font-size: var(--font-ui-medium);
  font-variant-numeric: tabular-nums;
  color: var(--text-normal);
}

.abele-calendar-week__day-head_today .abele-calendar-week__date {
  background-color: var(--interactive-accent);
  color: var(--text-on-accent);
  font-weight: bold;
}

.abele-calendar-week__all-day {
  border-top: 1px solid var(--background-modifier-border);
  border-bottom: 1px solid var(--background-modifier-border);
}

.abele-calendar-week__gutter-label {
  align-self: center;
  font-size: var(--font-smallest);
  color: var(--text-faint);
}

.abele-calendar-week__all-day-cell {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-1);
  min-width: 0;
  min-height: 1.8em;
  padding: var(--size-2-1);
  border-inline-start: 1px solid var(--background-modifier-border);
}

.abele-calendar-week__hours {
  max-height: 60vh;
  overflow-y: auto;
}

.abele-calendar-week__hour-label {
  height: var(--abele-calendar-hour);
  padding-inline-end: var(--size-2-3);
  text-align: end;
  font-size: var(--font-smallest);
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
  transform: translateY(-0.6em);
}

.abele-calendar-week__column {
  position: relative;
  min-width: 0;
  border-inline-start: 1px solid var(--background-modifier-border);
}

.abele-calendar-week__column_today {
  background-color: var(--background-secondary);
}

.abele-calendar-week__slot {
  height: var(--abele-calendar-hour);
  border-bottom: 1px solid var(--background-modifier-border-hover);
}

.abele-calendar-week__block {
  position: absolute;
  top: calc(var(--abele-block-top) * 24 * var(--abele-calendar-hour));
  height: calc(var(--abele-block-height) * 24 * var(--abele-calendar-hour));
  left: calc(100% * var(--abele-block-column) / var(--abele-block-columns));
  width: calc(100% / var(--abele-block-columns));
  padding: 0 var(--size-2-1) var(--size-2-1) 0;
}

// On the hours a chip is the height of its time, and wraps its title rather than cutting it.
.abele-calendar-week__chip {
  height: 100%;
  align-items: flex-start;
  flex-wrap: wrap;
  overflow: hidden;
  white-space: normal;
  background-color: var(--background-primary-alt);
  border-top: 1px solid var(--background-modifier-border);
  border-bottom: 1px solid var(--background-modifier-border);
  border-inline-end: 1px solid var(--background-modifier-border);
}

.abele-calendar-week__now {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(var(--abele-block-top) * 24 * var(--abele-calendar-hour));
  border-top: var(--size-2-1) solid var(--color-red);
  pointer-events: none;
}
</style>
