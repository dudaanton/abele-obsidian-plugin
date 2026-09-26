/**
 * A calendar server on a local port, for the calendar tests: a secret link (`/secret/<token>.ics`)
 * that answers with a calendar and its ETag, and a CalDAV account behind a username and
 * password — principal, calendar home, one calendar of events, one of tasks only.
 *
 * Also a requester that sends the plugin's requests to it through Node, standing in for
 * Obsidian's `requestUrl`.
 */
import { createServer, request as httpRequest, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Requester } from '@/calendars/http'

export const CALDAV_USER = 'anna'
// Made up for the tests; a word, so the repository guard reads it as one.
export const CALDAV_PASSWORD = 'correct-horse-battery'
export const LINK_TOKEN = 'a1b2c3'

export interface FakeCalendarServer {
  origin: string
  /** Every request so far, as `METHOD /path`. */
  log: string[]
  /** What the secret link serves; change it to change the calendar. */
  ics: { text: string; etag: string }
  stop(): Promise<void>
}

const xmlEscape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\r/g, '&#13;')

const multistatus = (responses: string) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:A="http://apple.com/ns/ical/">${responses}</D:multistatus>`

const response = (href: string, props: string, missing = '') =>
  `<D:response><D:href>${href}</D:href><D:propstat><D:prop>${props}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>${
    missing
      ? `<D:propstat><D:prop>${missing}</D:prop><D:status>HTTP/1.1 404 Not Found</D:status></D:propstat>`
      : ''
  }</D:response>`

export function caldavEvents(): string[] {
  const event = (uid: string, start: string, title: string) =>
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//fake//EN',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      'DTSTAMP:20260301T000000Z',
      `DTSTART:${start}`,
      'DURATION:PT1H',
      `SUMMARY:${title}`,
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ].join('\r\n')
  return [
    event('dentist@fake', '20260410T080000Z', 'Dentist'),
    event('dinner@fake', '20260411T170000Z', 'Dinner & drinks'),
  ]
}

export async function startFakeCalendarServer(initialIcs: string): Promise<FakeCalendarServer> {
  const log: string[] = []
  const ics = { text: initialIcs, etag: '"v1"' }
  const expectedAuth = `Basic ${Buffer.from(`${CALDAV_USER}:${CALDAV_PASSWORD}`).toString('base64')}`

  const server: Server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      const path = (req.url ?? '/').split('?')[0]
      log.push(`${req.method} ${path}`)

      if (path === `/secret/${LINK_TOKEN}.ics` && req.method === 'GET') {
        if (req.headers['if-none-match'] === ics.etag) {
          res.writeHead(304, { ETag: ics.etag }).end()
          return
        }
        res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', ETag: ics.etag })
        res.end(ics.text)
        return
      }
      if (path.startsWith('/secret/')) {
        res.writeHead(404).end('not here')
        return
      }

      if (req.headers.authorization !== expectedAuth) {
        res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="fake"' }).end()
        return
      }
      const xml = (text: string) => {
        res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' })
        res.end(text)
      }

      if (req.method === 'PROPFIND' && path === '/') {
        xml(
          multistatus(
            response(
              '/',
              `<D:current-user-principal><D:href>/principals/${CALDAV_USER}/</D:href></D:current-user-principal><D:resourcetype><D:collection/></D:resourcetype>`,
              '<C:calendar-home-set/>'
            )
          )
        )
        return
      }
      if (req.method === 'PROPFIND' && path === `/principals/${CALDAV_USER}/`) {
        // A home on another host, the way iCloud answers, but written relative here.
        xml(
          multistatus(
            response(
              path,
              `<C:calendar-home-set><D:href>/calendars/${CALDAV_USER}/</D:href></C:calendar-home-set>`
            )
          )
        )
        return
      }
      if (req.method === 'PROPFIND' && path === `/calendars/${CALDAV_USER}/`) {
        xml(
          multistatus(
            response(path, '<D:resourcetype><D:collection/></D:resourcetype>') +
              response(
                `${path}work/`,
                '<D:resourcetype><D:collection/><C:calendar/></D:resourcetype><D:displayname>Work</D:displayname><A:calendar-color>#FF0000FF</A:calendar-color><C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set>'
              ) +
              response(
                `${path}todo/`,
                '<D:resourcetype><D:collection/><C:calendar/></D:resourcetype><D:displayname>Reminders</D:displayname><C:supported-calendar-component-set><C:comp name="VTODO"/></C:supported-calendar-component-set>'
              )
          )
        )
        return
      }
      if (req.method === 'REPORT' && path === `/calendars/${CALDAV_USER}/work/`) {
        if (!/time-range start="\d{8}T\d{6}Z" end="\d{8}T\d{6}Z"/.test(body)) {
          res.writeHead(400).end('no time range')
          return
        }
        xml(
          multistatus(
            caldavEvents()
              .map((text, i) =>
                response(
                  `${path}${i}.ics`,
                  `<D:getetag>"e${i}"</D:getetag><C:calendar-data>${xmlEscape(text)}</C:calendar-data>`
                )
              )
              .join('')
          )
        )
        return
      }
      res.writeHead(404).end()
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    origin: `http://127.0.0.1:${port}`,
    log,
    ics,
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

/** The plugin's requests, sent through Node; a refused connection throws, as `requestUrl` does. */
export const nodeRequester: Requester = (r) =>
  new Promise((resolve, reject) => {
    const req = httpRequest(r.url, { method: r.method ?? 'GET', headers: r.headers }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => (text += chunk))
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          text,
          headers: Object.fromEntries(
            Object.entries(res.headers).map(([k, v]) => [
              k,
              Array.isArray(v) ? v.join(', ') : (v ?? ''),
            ])
          ),
        })
      )
    })
    req.on('error', reject)
    if (r.body) req.write(r.body)
    req.end()
  })
