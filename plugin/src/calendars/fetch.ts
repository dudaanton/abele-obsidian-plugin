/**
 * Reading one calendar, whichever way it is connected, into its events in a window.
 */
import type { CalendarEvent } from './events'
import { header, statusMessage, type Requester } from './http'
import { parseIcs, type TimeWindow } from './ics'
import { discoverCalendars, readCaldavCalendar } from './caldav'
import { normalizeCalendarUrl, type CalendarFeed } from './settings'

export interface FeedRead {
  events: CalendarEvent[]
  /** What the link's server said identifies this version; sent back next time. */
  etag?: string
  /** The link has not changed since `etag`: the events kept from last time still stand. */
  unchanged?: boolean
}

/**
 * @param secret the link, or the CalDAV password, out of the keychain
 * @param etag what the last successful read of this link was tagged with
 * @throws with a message fit for the settings screen
 */
export async function readFeed(
  feed: CalendarFeed,
  secret: string,
  window: TimeWindow,
  request: Requester,
  etag?: string
): Promise<FeedRead> {
  if (feed.source === 'caldav') return readCaldav(feed, secret, window, request)

  const url = normalizeCalendarUrl(secret)
  if (!url) throw new Error('No link is set for this calendar.')
  if (!/^https?:\/\//i.test(url))
    throw new Error('The link should start with https:// or webcal://.')

  let response
  try {
    response = await request({
      url,
      method: 'GET',
      headers: {
        Accept: 'text/calendar, */*;q=0.5',
        ...(etag ? { 'If-None-Match': etag } : {}),
      },
    })
  } catch (e) {
    throw new Error(`The calendar could not be reached: ${(e as Error)?.message ?? e}`)
  }
  if (response.status === 304 && etag) return { events: [], etag, unchanged: true }
  if (response.status >= 400) throw new Error(statusMessage(response.status, 'link'))
  return {
    events: parseIcs(response.text, feed.id, window),
    etag: header(response, 'etag') || undefined,
  }
}

async function readCaldav(
  feed: CalendarFeed,
  password: string,
  window: TimeWindow,
  request: Requester
): Promise<FeedRead> {
  if (!feed.username) throw new Error('No username is set for this calendar.')
  if (!password) throw new Error('No password is set for this calendar.')
  const account = { server: feed.server, username: feed.username, password }
  try {
    const urls = feed.calendarUrl
      ? [feed.calendarUrl]
      : (await discoverCalendars(account, request)).map((c) => c.url)
    const events = new Map<string, CalendarEvent>()
    for (const url of urls) {
      for (const text of await readCaldavCalendar(account, url, window, request)) {
        for (const event of parseIcs(text, feed.id, window)) events.set(event.id, event)
      }
    }
    return { events: [...events.values()] }
  } catch (e) {
    const message = (e as Error)?.message ?? String(e)
    // `requestUrl` throws on a network failure rather than answering with a status.
    if (/net::|ENOTFOUND|ECONNREFUSED|timed out|Failed to fetch/i.test(message)) {
      throw new Error(`The server could not be reached: ${message}`)
    }
    throw e
  }
}
