import { computed, type ComputedRef } from 'vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { calendars, type ShownEvent } from '@/calendars/CalendarService'

/**
 * The external calendars' events by day, redrawn when the calendars are read again and when
 * their settings change — a colour, a name, one switched off.
 *
 * @param keep which days to keep, `YYYY-MM-DD`; all of them when absent
 */
export function useCalendarDays(
  keep?: (day: string) => boolean
): ComputedRef<Map<string, ShownEvent[]>> {
  const config = AbeleConfig.getInstance()
  return computed(() => {
    void config.version.value
    void calendars().state.version
    const days = calendars().byDay()
    if (!keep) return days
    for (const day of [...days.keys()]) if (!keep(day)) days.delete(day)
    return days
  })
}
