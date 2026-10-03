/** Date consumers can import this module without relying on the plugin's startup order. */
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import dayOfYear from 'dayjs/plugin/dayOfYear'
import isoWeek from 'dayjs/plugin/isoWeek'
import updateLocale from 'dayjs/plugin/updateLocale'
import weekday from 'dayjs/plugin/weekday'

dayjs.extend(customParseFormat)
dayjs.extend(dayOfYear)
dayjs.extend(isoWeek)
dayjs.extend(updateLocale)
dayjs.extend(weekday)

export default dayjs
export type { Dayjs } from 'dayjs'
