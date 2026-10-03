import dayjs from 'dayjs'
import { DATE_FORMAT } from '@/constants/dates'

/** Named-data/path templates: a supplied date, unknown fields empty, no execution or forms. */
export function renderDataTemplate(template: string, data: Record<string, string>): string {
  return template.replace(/{{(.*?)}}/g, (match, key) => {
    const trimmedKey = key.trim()
    if (trimmedKey.startsWith('date:')) {
      const formatString = trimmedKey.substring(5)
      try {
        return dayjs(data?.date, DATE_FORMAT).format(formatString)
      } catch (e) {
        console.error(`Error formatting date with dayjs: ${formatString}`, e)
        return ''
      }
    }
    return data[trimmedKey] || ''
  })
}
