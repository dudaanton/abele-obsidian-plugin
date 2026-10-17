import { areaDate } from '@/helpers/areaDateFormat'
import type dayjs from 'dayjs'

/**
 * A period as the period picker over a sidebar names it: a whole month by its name and year, any
 * other range by its first and last day.
 */
export function periodName(start: dayjs.Dayjs, end: dayjs.Dayjs): string {
  const wholeMonth =
    start.isSame(start.startOf('month'), 'day') &&
    end.isSame(end.endOf('month'), 'day') &&
    start.isSame(end, 'month')
  return wholeMonth
    ? areaDate(start, 'MMMM YYYY')
    : `${areaDate(start, 'MMM D, YYYY')} — ${areaDate(end, 'MMM D, YYYY')}`
}
