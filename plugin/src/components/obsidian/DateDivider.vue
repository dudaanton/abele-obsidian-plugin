<template>
  <div class="abele-date-divider">
    <span class="abele-date-divider__label">{{ label }}</span>
    <div class="abele-date-divider__line" />
    <span v-if="$slots.default" class="abele-date-divider__summary"><slot /></span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import dayjs from 'dayjs'
import { DISPLAY_DATE_FORMAT, DATE_FORMAT } from '@/constants/dates'

const props = defineProps<{
  date: string
}>()

const label = computed(() => {
  const d = dayjs(props.date, DATE_FORMAT)
  if (!d.isValid()) return props.date

  const now = dayjs()
  const diff = d.startOf('day').diff(now.startOf('day'), 'day')

  const formatted = d.format(DISPLAY_DATE_FORMAT)
  if (diff === 0) return `${formatted} — Today`
  if (diff === -1) return `${formatted} — Yesterday`
  if (diff === 1) return `${formatted} — Tomorrow`
  return formatted
})
</script>

<style lang="scss">
.abele-date-divider {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  margin: var(--size-4-2) 0;
}

.abele-date-divider__label {
  font-size: var(--font-ui-smaller);
  color: var(--text-faint);
  white-space: nowrap;
}

.abele-date-divider__line {
  flex: 1;
  height: 1px;
  background-color: var(--background-modifier-border);
}

.abele-date-divider__summary {
  font-size: var(--font-ui-smaller);
  color: var(--text-faint);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
</style>
