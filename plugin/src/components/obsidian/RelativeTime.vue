<template>
  <span class="abele-relative-time" :class="{ 'abele-relative-time_unknown': !formatted.datetime }">
    <time
      v-if="formatted.datetime"
      class="abele-relative-time__label"
      :datetime="formatted.datetime"
      :aria-label="formatted.exact"
      :title="formatted.exact"
      >{{ formatted.label }}</time
    >
    <span v-else class="abele-relative-time__label">{{ formatted.label }}</span>
    <!-- The exact moment folded under the same fold as every other detail in the kit. -->
    <Disclosure
      v-if="formatted.datetime && formatted.label !== formatted.exact"
      v-model="opened"
      class="abele-relative-time__detail"
      :label="t('kit.exactTime')"
    >
      <span class="abele-relative-time__exact">{{ formatted.exact }}</span>
    </Disclosure>
  </span>
</template>
<script setup lang="ts">
import { t } from '@/i18n'
import { computed, ref } from 'vue'
import Disclosure from './Disclosure.vue'
import { formatTimestamp, type TimestampValue } from '@/helpers/displayFormat'
const props = defineProps<{
  value?: TimestampValue
  now?: Date
  mode?: 'relative' | 'absolute'
  diagnostic?: boolean
  timeZone?: string
}>()
const formatted = computed(() => formatTimestamp(props.value, props))
const opened = ref(false)
</script>
<style>
.abele-relative-time {
  display: inline-flex;
  align-items: flex-start;
  gap: var(--size-4-1);
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  overflow-wrap: anywhere;
}
.abele-relative-time__detail {
  min-width: 0;
}
.abele-relative-time__exact {
  display: block;
}
</style>
