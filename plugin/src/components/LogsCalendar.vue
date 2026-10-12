<template>
  <div class="abele-logs-calendar">
    <div class="abele-logs-calendar__grid">
      <Calendar
        class="abele-logs-calendar__month"
        :selected-date="selected"
        :marks="marks"
        @date-selected="selected = $event"
        @month-changed="month = $event"
      />
      <section class="abele-logs-calendar__day" :aria-label="dayLabel">
        <!-- The day's own note, when it is where the entry was written, is opened from the day. -->
        <ObsidianMarkdown
          v-if="dayNote"
          trusted
          class="abele-logs-calendar__day-title"
          :text="`[[${dayNote}|${dayLabel}]]`"
        />
        <div v-else class="abele-logs-calendar__day-title">{{ dayLabel }}</div>
        <template v-if="dayLogs.length">
          <LogView
            v-for="log in dayLogs"
            :key="log.filePath"
            :data-abele-anchor="'log:' + log.filePath"
            :log="log"
            :hide-source="log.filePath === dayNote"
          />
        </template>
        <div v-else class="abele-logs-calendar__none">
          {{
            emptyMonth ? `Nothing written in ${month.format('MMMM')}.` : 'Nothing written this day.'
          }}
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * A note's logs as a month: a mark under every day something was written about the note — a dot
 * for words, a box ticked or left for a log kept as a checkbox — and the chosen day's entries
 * beside the month on a wide page, under it on a narrow one.
 */
import { computed, ref, shallowRef, watch } from 'vue'
import dayjs from '@/helpers/dateLibrary'
import Calendar from './Calendar.vue'
import LogView from './Log.vue'
import ObsidianMarkdown from './obsidian/Markdown.vue'
import { extractDateFromFilename } from '@/helpers/datesHelper'
import { Log } from '@/entities/Log'
import { DATE_FORMAT } from '@/constants/dates'
import { dayMark, logsByDay, type LogDayMark } from '@/logs/logDays'

const props = defineProps<{ logs: Log[] }>()

const days = computed(() => logsByDay(props.logs, DATE_FORMAT))

/** The day it opens on: today when something is written today, else the last day written. */
const opening = (): dayjs.Dayjs => {
  const today = dayjs()
  if (days.value.has(today.format(DATE_FORMAT)) || !days.value.size) return today
  const last = [...days.value.keys()].sort().at(-1)
  return dayjs(last, DATE_FORMAT)
}

const selected = shallowRef<dayjs.Dayjs>(opening())
const month = shallowRef<dayjs.Dayjs>(selected.value.startOf('month'))

/**
 * Turning to another month moves the chosen day into it, so what is shown beside the month is
 * always of that month: its last day written, else today in this month, else its first day.
 */
watch(month, (shown) => {
  if (selected.value.isSame(shown, 'month')) return
  const written = [...days.value.keys()]
    .filter((key) => key.startsWith(shown.format('YYYY-MM')))
    .sort()
    .at(-1)
  const today = dayjs()
  selected.value = written
    ? dayjs(written, DATE_FORMAT)
    : today.isSame(shown, 'month')
      ? today
      : shown.startOf('month')
})

/** Nothing at all written in the month shown. */
const emptyMonth = computed(
  () => ![...days.value.keys()].some((key) => key.startsWith(month.value.format('YYYY-MM')))
)

/**
 * Whether a log is ticked is in its words, which are read only when needed: those of the month
 * shown (and the weeks around it the grid draws), and of the day chosen.
 */
const loaded = ref(0)
watch(
  [month, selected, () => props.logs],
  async () => {
    const from = month.value.subtract(7, 'day')
    const to = month.value.add(1, 'month').add(7, 'day')
    const wanted = props.logs.filter(
      (log) =>
        log.content === undefined &&
        log.createdAt &&
        ((log.createdAt.isAfter(from) && log.createdAt.isBefore(to)) ||
          log.createdAt.isSame(selected.value, 'day'))
    )
    if (!wanted.length) return
    await Promise.all(wanted.map((log) => log.loadContent()))
    loaded.value++
  },
  { immediate: true }
)

const marks = computed(() => {
  void loaded.value
  const map = new Map<string, LogDayMark>()
  for (const [day, logs] of days.value) {
    const mark = dayMark(logs)
    if (mark) map.set(day, mark)
  }
  return map
})

const dayLogs = computed(() => days.value.get(selected.value.format(DATE_FORMAT)) ?? [])
/** A daily note of the chosen day among the logs: the day's heading links to it. */
const dayNote = computed(
  () =>
    dayLogs.value.find((log) => {
      return extractDateFromFilename(log.filePath)?.isSame(selected.value, 'day')
    })?.filePath ?? ''
)
const dayLabel = computed(() => selected.value.format('ddd D MMMM YYYY'))
</script>

<style lang="scss">
// Side by side once there is room for a month and a column of text beside it; one above the
// other on a phone and in a narrow pane.
.abele-logs-calendar {
  container-type: inline-size;
}

.abele-logs-calendar__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--size-4-4);
}

@container (min-width: 36em) {
  .abele-logs-calendar__grid {
    grid-template-columns: minmax(0, 18em) minmax(0, 1fr);
    align-items: start;
  }
}

.abele-logs-calendar__day {
  display: flex;
  flex-direction: column;
  gap: var(--p-spacing);
  min-width: 0;
}

// The day as a quiet heading over its entries, the way the timeline names its days.
.abele-logs-calendar__day-title {
  color: var(--text-muted);
  font-size: var(--font-ui-small);
  font-weight: var(--font-semibold);
}

// Linked or not, the day reads as a heading, not as a link in the text.
.abele-logs-calendar__day-title {
  p {
    margin: 0;
  }

  .internal-link {
    color: inherit;
    font-weight: inherit;
    text-decoration: none;
  }
}

.abele-logs-calendar__none {
  color: var(--text-muted);
}
</style>
