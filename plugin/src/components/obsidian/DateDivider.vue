<template>
  <GroupHeading class="abele-date-divider" :strong="isToday">
    <template #label
      ><span class="abele-date-divider__label">{{ label }}</span></template
    >
    <span v-if="$slots.default" class="abele-date-divider__summary"><slot /></span>
  </GroupHeading>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import dayjs from 'dayjs'
import { DISPLAY_DATE_FORMAT, DATE_FORMAT } from '@/constants/dates'
import { relativeDayLabel } from '@/helpers/displayFormat'
import GroupHeading from './GroupHeading.vue'

const props = defineProps<{
  date: string
}>()

const day = computed(() => dayjs(props.date, DATE_FORMAT))
const isToday = computed(() => day.value.isValid() && day.value.isSame(dayjs(), 'day'))

// A day as the timeline says it: the near ones by name first, then the date.
const label = computed(() => {
  const d = day.value
  if (!d.isValid()) return props.date
  const diff = d.startOf('day').diff(dayjs().startOf('day'), 'day')
  const formatted = d.format(DISPLAY_DATE_FORMAT)
  const relative = relativeDayLabel(diff)
  return relative ? `${relative} · ${formatted}` : formatted
})
</script>

<style lang="scss">
// A day's heading, as every group heading: see GroupHeading. Apart from the rows above it by more
// than the rows are apart from each other, and close to its own.
.abele-date-divider {
  margin-top: var(--size-4-6);

  // Measured glyph to glyph: under an entry with a line of times below its name, that step read
  // as close to the entry above as to the day's own first entry.
  .abele-entry-row + & {
    margin-top: var(--size-4-9);
  }

  &:first-child {
    margin-top: 0;
  }
}

// A day is one name: "Today · 15.10.2026" never breaks, the totals give way instead.
.abele-date-divider .abele-group-heading__label {
  flex: none;
  white-space: nowrap;
}

.abele-date-divider__summary {
  display: contents;
}
</style>
