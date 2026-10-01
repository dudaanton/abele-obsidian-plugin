<template>
  <span ref="el">{{ text }}</span>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useOwnerVisibility } from '@/composables/useOwnerVisibility'
import dayjs from 'dayjs'
import { useDisplayClock } from '@/composables/useDisplayClock'

const props = defineProps<{ start: dayjs.Dayjs | null }>()
const el = ref<HTMLElement>()
const visible = useOwnerVisibility(el)
const now = useDisplayClock(
  'second',
  () => visible.value && !!props.start,
  () => el.value?.ownerDocument ?? document
)
const text = computed(() => {
  const seconds = props.start ? dayjs(now.value).diff(props.start, 'second') : 0
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`
})
</script>
