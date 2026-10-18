import { streamBGithubDate } from '@/i18n/streamBDate'

/** A timestamp from GitHub, the way the rest of the plugin writes dates. */
export const formatDate = (iso: string | undefined): string => streamBGithubDate(iso)
export const shortDate = (iso: string | undefined): string => streamBGithubDate(iso, true)

/** The first line of a commit message, and the rest. */
export function splitMessage(message: string): { title: string; body: string } {
  const at = message.indexOf('\n')
  if (at === -1) return { title: message, body: '' }
  return { title: message.slice(0, at), body: message.slice(at + 1).trim() }
}
