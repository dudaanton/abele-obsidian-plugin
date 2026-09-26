/**
 * Reading calendars over CalDAV (RFC 4791): iCloud, Fastmail, Nextcloud, anything that speaks
 * it with a username and a password.
 *
 * Finding the calendars is the usual walk: the address given → the account's principal → its
 * calendar home → the calendars in it. Each step is skipped when the address already is the
 * thing it would find, so a calendar's own address works as well as the server's. Reading asks
 * the server for the events in a window of time (`calendar-query`), and what comes back is one
 * iCalendar text per event, read by the same code as a calendar link.
 */
import { basicAuth, header, statusMessage, type Requester } from './http'
import { findAll, findFirst, childrenOf, parseXml, type XmlElement } from './xml'
import type { TimeWindow } from './ics'

const DAV = 'DAV:'
const CALDAV = 'urn:ietf:params:xml:ns:caldav'

export interface CaldavAccount {
  server: string
  username: string
  password: string
}

export interface CaldavCalendar {
  url: string
  name: string
}

const PROPFIND_START = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:current-user-principal/><c:calendar-home-set/><d:resourcetype/><d:displayname/></d:prop>
</d:propfind>`

const PROPFIND_HOME = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/">
  <d:prop><d:resourcetype/><d:displayname/><a:calendar-color/><c:supported-calendar-component-set/></d:prop>
</d:propfind>`

const stamp = (ms: number) =>
  new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')

const reportBody = (window: TimeWindow) => `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${stamp(window.from)}" end="${stamp(window.to)}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`

interface DavResponse {
  href: string
  prop: XmlElement[]
}

class CaldavClient {
  constructor(
    private readonly account: CaldavAccount,
    private readonly request: Requester
  ) {}

  async multistatus(
    url: string,
    method: 'PROPFIND' | 'REPORT',
    depth: '0' | '1',
    body: string
  ): Promise<{ responses: DavResponse[]; url: string } | { status: number }> {
    const response = await this.request({
      url,
      method,
      headers: {
        Authorization: basicAuth(this.account.username, this.account.password),
        Depth: depth,
        'Content-Type': 'application/xml; charset=utf-8',
      },
      body,
    })
    if (response.status !== 207) {
      if (response.status >= 300 && response.status < 400) {
        const location = header(response, 'location')
        if (location) return this.multistatus(new URL(location, url).href, method, depth, body)
      }
      return { status: response.status }
    }
    let root: XmlElement
    try {
      root = parseXml(response.text)
    } catch {
      throw new Error('The server answered with something that is not a CalDAV answer.')
    }
    const responses = findAll(root, DAV, 'response').map((r) => ({
      href: new URL(findFirst(r, DAV, 'href')?.text.trim() ?? '', url).href,
      // Only what the server found: a `404` propstat lists the properties it does not have.
      prop: childrenOf(r, DAV, 'propstat')
        .filter((ps) => !/\s(4|5)\d\d\s/.test(findFirst(ps, DAV, 'status')?.text ?? ''))
        .flatMap((ps) => childrenOf(ps, DAV, 'prop')),
    }))
    return { responses, url }
  }
}

const hrefIn = (props: XmlElement[], ns: string, name: string): string | null => {
  for (const prop of props) {
    const holder = findFirst(prop, ns, name)
    const href = holder && findFirst(holder, DAV, 'href')
    if (href?.text.trim()) return href.text.trim()
  }
  return null
}

const isCalendar = (props: XmlElement[]) =>
  props.some((p) => {
    const type = findFirst(p, DAV, 'resourcetype')
    return !!type && !!findFirst(type, CALDAV, 'calendar')
  })

/** A calendar that says which kinds of entry it holds holds events only if it says so. */
const holdsEvents = (props: XmlElement[]) => {
  const set = props
    .map((p) => findFirst(p, CALDAV, 'supported-calendar-component-set'))
    .find(Boolean)
  if (!set) return true
  return (
    findAll(set, CALDAV, 'comp').length === 0 ||
    findAll(set, CALDAV, 'comp').some((c) => c.attrs.name?.toUpperCase() === 'VEVENT')
  )
}

const nameIn = (props: XmlElement[]) =>
  props.map((p) => findFirst(p, DAV, 'displayname')?.text.trim()).find(Boolean) ?? ''

function failed(status: number): never {
  throw new Error(statusMessage(status, 'server'))
}

function serverUrl(server: string): string {
  const trimmed = server.trim()
  if (!trimmed) throw new Error('Give the CalDAV server address.')
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    return new URL(withScheme).href
  } catch {
    throw new Error(`"${server}" is not an address.`)
  }
}

/** Every calendar of the account that holds events, with the name the account gives it. */
export async function discoverCalendars(
  account: CaldavAccount,
  request: Requester
): Promise<CaldavCalendar[]> {
  const client = new CaldavClient(account, request)
  const start = serverUrl(account.server)

  let first = await client.multistatus(start, 'PROPFIND', '0', PROPFIND_START)
  if ('status' in first && first.status !== 401 && first.status !== 403) {
    // Servers that keep CalDAV elsewhere say where from the well-known address.
    first = await client.multistatus(
      new URL('/.well-known/caldav', start).href,
      'PROPFIND',
      '0',
      PROPFIND_START
    )
  }
  if ('status' in first) failed(first.status)

  const props = first.responses[0]?.prop ?? []
  if (isCalendar(props)) return [{ url: first.responses[0].href, name: nameIn(props) }]

  let home = hrefIn(props, CALDAV, 'calendar-home-set')
  let base = first.url
  if (!home) {
    const principal = hrefIn(props, DAV, 'current-user-principal')
    if (!principal) throw new Error('The server did not say where this account’s calendars are.')
    const principalUrl = new URL(principal, first.url).href
    const second = await client.multistatus(principalUrl, 'PROPFIND', '0', PROPFIND_START)
    if ('status' in second) failed(second.status)
    home = hrefIn(second.responses[0]?.prop ?? [], CALDAV, 'calendar-home-set')
    base = second.url
    if (!home) throw new Error('The server did not say where this account’s calendars are.')
  }

  const homeUrl = new URL(home, base).href
  const listing = await client.multistatus(homeUrl, 'PROPFIND', '1', PROPFIND_HOME)
  if ('status' in listing) failed(listing.status)
  return listing.responses
    .filter((r) => isCalendar(r.prop) && holdsEvents(r.prop))
    .map((r) => ({
      url: r.href,
      name: nameIn(r.prop) || decodeURIComponent(r.href.split('/').filter(Boolean).pop() ?? ''),
    }))
}

/** The calendar texts of every event in the window, one per event the server keeps. */
export async function readCaldavCalendar(
  account: CaldavAccount,
  calendarUrl: string,
  window: TimeWindow,
  request: Requester
): Promise<string[]> {
  const client = new CaldavClient(account, request)
  const result = await client.multistatus(calendarUrl, 'REPORT', '1', reportBody(window))
  if ('status' in result) failed(result.status)
  return result.responses
    .map((r) => r.prop.map((p) => findFirst(p, CALDAV, 'calendar-data')?.text ?? '').join(''))
    .filter((text) => /BEGIN:VCALENDAR/i.test(text))
}
