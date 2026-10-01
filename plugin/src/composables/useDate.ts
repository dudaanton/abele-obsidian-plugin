import dayjs from 'dayjs'
import { customRef, watch, type MaybeRefOrGetter } from 'vue'
import { useDisplayClock } from './useDisplayClock'

export function useDate(active: MaybeRefOrGetter<boolean> = true, owner?: () => Document) {
  const time = useDisplayClock('day', active, owner)
  let date = dayjs(time.value)
  const now = customRef<dayjs.Dayjs>((track, trigger) => {
    watch(time, () => trigger(), { flush: 'sync' })
    return {
      get() {
        track()
        if (date.valueOf() !== time.value) date = dayjs(time.value)
        return date
      },
      set() {
        /* read-only local day */
      },
    }
  })
  return { now }
}
