import dayjs from 'dayjs'

/** A timestamp from GitHub, the way the rest of the plugin writes dates. */
export function formatDate(iso: string | undefined): string {
  if (!iso) return ''
  const d = dayjs(iso)
  return d.isValid() ? d.format('D MMM YYYY, HH:mm') : ''
}

/** The first line of a commit message, and the rest. */
export function splitMessage(message: string): { title: string; body: string } {
  const at = message.indexOf('\n')
  if (at === -1) return { title: message, body: '' }
  return { title: message.slice(0, at), body: message.slice(at + 1).trim() }
}
