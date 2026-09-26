/**
 * What a pasted calendar link becomes before it is stored: the address of a calendar feed, or a
 * reason it cannot be one.
 *
 * - `webcal://` / `webcals://` is what Apple and Outlook hand out for subscribing, and means
 *   `https://` to anything that is not a calendar app.
 * - Google's embed page (`/calendar/embed?src=…`, one `src` per calendar on it) and its share
 *   link (`?cid=…`, the calendar id in base64, plain, or a subscribed feed's own address) are
 *   web pages; each names calendars whose public feed is at `/calendar/ical/<id>/public/basic.ics`.
 *   A private calendar has no public feed — its "Secret address in iCal format" is the link.
 */
export interface CalendarLinks {
  /** The feeds the link stands for: one, or one per calendar on a Google embed page. */
  urls: string[]
  /** Why nothing can be read from it, for the settings screen. */
  problem?: string
}

const GOOGLE_HOST = /^(www\.)?calendar\.google\.com$/i
const ICAL_HELP =
  'In Google, use the calendar’s “Secret address in iCal format” (or its “Public address in iCal format”), from the calendar’s settings.'

const googleFeed = (calendarId: string) =>
  `https://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`

const webcalToHttps = (url: string) => url.replace(/^webcals?:\/\//i, 'https://')

/** A `cid` as Google writes it: a feed's address, a plain calendar id, or one in base64. */
function fromCid(cid: string): string | null {
  if (/^(webcals?|https?):\/\//i.test(cid)) return webcalToHttps(cid)
  if (cid.includes('@')) return googleFeed(cid)
  try {
    const b64 = cid.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
    if (/^(webcals?|https?):\/\//i.test(decoded)) return webcalToHttps(decoded)
    if (/^[^\s@]+@[^\s@]+$/.test(decoded)) return googleFeed(decoded)
  } catch {
    // not base64 after all
  }
  return null
}

export function calendarLinks(pasted: string): CalendarLinks {
  // A link has no spaces in it; the ones a paste brings along, line breaks included, go.
  const text = webcalToHttps(pasted.replace(/\s+/g, ''))
  if (!text) return { urls: [], problem: 'Paste the calendar’s link first.' }
  if (!/^https?:\/\//i.test(text)) {
    return { urls: [], problem: 'The link should start with https:// or webcal://.' }
  }

  let url: URL
  try {
    url = new URL(text)
  } catch {
    return { urls: [], problem: 'This is not a link that can be read.' }
  }
  if (!GOOGLE_HOST.test(url.hostname) || /\/calendar\/ical\//.test(url.pathname)) {
    return { urls: [text] }
  }

  const sources = url.searchParams.getAll('src').filter(Boolean)
  if (/\/embed$/.test(url.pathname) && sources.length) {
    return { urls: [...new Set(sources.map(googleFeed))] }
  }
  const cid = url.searchParams.get('cid')
  const fromShare = cid ? fromCid(cid) : null
  if (fromShare) return { urls: [fromShare] }

  return {
    urls: [],
    problem: `This is a Google Calendar page, not a calendar feed. ${ICAL_HELP}`,
  }
}

/** The first feed a link stands for; the link itself, trimmed, when it stands for none. */
export function normalizeCalendarUrl(url: string): string {
  return calendarLinks(url).urls[0] ?? url.trim()
}
