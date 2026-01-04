import { useNow } from '@vueuse/core'
import dayjs from 'dayjs'
import { ref, watch } from 'vue'

export function useDate() {
  const nowDate = useNow()
  const now = ref<dayjs.Dayjs>(dayjs(nowDate.value))

  watch(nowDate, (newDate) => {
    if (!now.value.isSame(newDate, 'date')) {
      now.value = dayjs(newDate)
    }
  })

  return {
    now,
  }
}
