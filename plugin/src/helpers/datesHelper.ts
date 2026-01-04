import { DATE_FORMAT, DATE_REGEX, DISPLAY_DATE_FORMAT } from '@/constants/dates'
import dayjs from 'dayjs'

export const today = () => {
  const day = dayjs()

  return day.format(DATE_FORMAT)
}

export const year = (date?: string) => {
  const day = date ? dayjs().set('year', parseInt(date)) : dayjs()

  return day.format('YYYY')
}

// Format date for display
export const formatDateToDisplay = (date: dayjs.Dayjs): string => {
  return date.format(DISPLAY_DATE_FORMAT)
}

/**
 * Extracts a date from a filename using a specific pattern (YYYY-MM-DD).
 * @param filename - The name of the file to extract the date from.
 * @returns A Dayjs object representing the extracted date, or null if no date is found.
 */
export function extractDateFromFilename(filename: string): dayjs.Dayjs | null {
  const dateMatch = filename.match(DATE_REGEX)
  return dateMatch ? (dayjs(dateMatch[0]) as dayjs.Dayjs) : null
}

export function parseDateOrNull(date: string | null | undefined): dayjs.Dayjs | null {
  const parsedDate = date ? dayjs(date, DATE_FORMAT) : null

  return parsedDate && parsedDate.isValid() ? parsedDate : null
}

export function parseDateTimeOrNull(date: string, time: string): dayjs.Dayjs | null {
  if (!date || !time) {
    return null
  }
  const dateTime = dayjs(`${date} ${time}`, `${DATE_FORMAT} HH:mm`)

  return dateTime.isValid() ? dateTime : null
}

export function applyTimeToDate(date: dayjs.Dayjs, time: dayjs.Dayjs): dayjs.Dayjs {
  if (!date || !time || !date.isValid() || !time.isValid()) {
    return date
  }
  return date.hour(time.hour()).minute(time.minute())
}
