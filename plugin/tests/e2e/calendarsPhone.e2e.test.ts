/**
 * External calendars in the running app, on a phone: a calendar link served by a server started
 * here, read through Obsidian's own `requestUrl`, its events in the sidebar timeline and the
 * month calendar, and the Calendars settings page — each asked whether anything reaches past the
 * right edge of a 390×844 screen, with a picture in `/tmp/abele-phone/calendars-*.png`.
 *
 * The calendar is put in the settings in memory only and its link is never stored: the keychain
 * has no way to remove a secret, so `getSecret` is wrapped for the run, as the GitHub files do.
 * Both are put back afterwards, and the cache file the read writes is removed if it was not there
 * before. `emulateMobile` reloads the app, so the calendar is set up after the reloads.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSync } from 'esbuild'
import { hasTestApi, isObsidianRunning, evalRaw } from './helpers/obsidianCli'
import { LINK_TOKEN } from '../helpers/fakeCalendarServer'

const PHONE = { width: 390, height: 844 }
const SHOTS = '/tmp/abele-phone'
const KEY_ID = 'abele-e2e-calendar'
const available = isObsidianRunning() && hasTestApi()

interface CalendarProcess {
  origin: string
  stop(): void
}

/** The server in a process of its own, serving `ics`; see `helpers/fakeCalendarProcess.ts`. */
async function startCalendarProcess(ics: string): Promise<CalendarProcess> {
  const dir = mkdtempSync(join(tmpdir(), 'abele-fake-calendar-'))
  const bundle = join(dir, 'server.mjs')
  const file = join(dir, 'calendar.ics')
  writeFileSync(file, ics)
  buildSync({
    entryPoints: [join(__dirname, 'helpers', 'fakeCalendarProcess.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: bundle,
    logLevel: 'silent',
  })
  const child: ChildProcess = spawn(process.execPath, [bundle, file], {
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the fake calendar did not start')), 15_000)
    let out = ''
    child.stdout!.on('data', (chunk: Buffer) => {
      out += chunk.toString()
      const m = /listening (\d+)/.exec(out)
      if (m) {
        clearTimeout(timer)
        resolve(Number(m[1]))
      }
    })
    child.on('exit', (code) => reject(new Error(`the fake calendar exited with ${code}`)))
  })
  return {
    origin: `http://127.0.0.1:${port}`,
    stop: () => {
      child.kill()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const evalAsync = <T>(script: string, timeoutMs = 60_000): T =>
  JSON.parse(evalRaw(script, timeoutMs)) as T

/** A calendar around today: a meeting, a long one past midnight, a trip, a weekly series. */
function calendarAroundToday(): string {
  const stamp = (d: Date) =>
    d
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '')
  const day = (d: Date) => stamp(d).slice(0, 8)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const at = (days: number, hours: number) =>
    new Date(today.getTime() + days * 86400000 + hours * 3600000)
  const events = [
    [
      'standup',
      `DTSTART:${stamp(at(0, 9))}`,
      `DTEND:${stamp(at(0, 9.5))}`,
      'RRULE:FREQ=WEEKLY;COUNT=4',
      'SUMMARY:Standup with the whole team, which has a rather long title',
      'LOCATION:Room 4, second floor, the one with the plants',
    ],
    ['night', `DTSTART:${stamp(at(1, 22))}`, `DTEND:${stamp(at(2, 6))}`, 'SUMMARY:Night train'],
    [
      'trip',
      `DTSTART;VALUE=DATE:${day(at(3, 12))}`,
      `DTEND;VALUE=DATE:${day(at(6, 12))}`,
      'SUMMARY:Trip to the sea',
    ],
    [
      'dentist',
      `DTSTART:${stamp(at(2, 15))}`,
      `DTEND:${stamp(at(2, 16))}`,
      'SUMMARY:Dentist',
      'DESCRIPTION:Bring the insurance card',
    ],
  ]
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//abele e2e//EN',
    ...events.flatMap(([uid, ...lines]) => [
      'BEGIN:VEVENT',
      `UID:${uid}@e2e`,
      'DTSTAMP:20260101T000000Z',
      ...lines,
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
    '',
  ].join('\r\n')
}

/** Reloads the page and waits for the plugin to be back. */
const reload = async (how: string): Promise<void> => {
  evalRaw(`(() => { setTimeout(() => { ${how} }, 50); return 'ok' })()`, 30_000)
  await pause(4000)
  const deadline = Date.now() + 60_000
  while (!hasTestApi() && Date.now() < deadline) await pause(1000)
}

const windowSize = (): [number, number] =>
  JSON.parse(
    evalRaw(`JSON.stringify(require('@electron/remote').getCurrentWindow().getContentSize())`)
  ) as [number, number]

const setWindowSize = async (width: number, height: number): Promise<void> => {
  evalRaw(
    `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${width}, ${height}); return 'ok' })()`,
    30_000
  )
  await pause(1500)
}

/** Shared by every script: waiting, measuring what reaches past an edge, taking a picture. */
const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { const v = fn(); if (v) return v; await wait(100) }
    return null
  }
  const name = (el) => el.tagName.toLowerCase() + '.' + [...el.classList].join('.')
  const overEdge = (root) => {
    const edge = Math.min(root.getBoundingClientRect().right, window.innerWidth)
    const over = []
    for (const el of root.querySelectorAll('*')) {
      const s = getComputedStyle(el)
      if (s.visibility === 'hidden' || s.display === 'none' || s.position === 'absolute') continue
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.right > edge + 1) over.push(name(el) + ' +' + Math.round(r.right - edge))
    }
    return over.slice(0, 12)
  }
  const picture = async (file) => {
    require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const img = await Promise.race([require('@electron/remote').getCurrentWebContents().capturePage(), wait(8000).then(() => null)])
        if (img) { require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/' + file, img.toPNG()); return file }
      } catch (e) { await wait(500) }
    }
    return 'no picture'
  }
`

interface Screen {
  error?: string
  phone?: boolean
  over?: string[]
  sideways?: number
  events?: number
  checkboxes?: number
  marks?: number
  shot?: string
  status?: string
}

describe.skipIf(!available)('calendars on a phone', () => {
  let server: CalendarProcess
  let size: [number, number] = [0, 0]
  const screens: Record<string, Screen> = {}

  beforeAll(async () => {
    server = await startCalendarProcess(calendarAroundToday())
    size = windowSize()
    await reload('app.emulateMobile(true)')
    await setWindowSize(PHONE.width, PHONE.height)
    await reload('window.location.reload()')

    const link = `${server.origin}/secret/${LINK_TOKEN}.ics`
    screens.read = evalAsync<Screen>(`(async () => {
      const t = window.__abeleTest
      const config = t.AbeleConfig.getInstance()
      const adapter = app.vault.adapter
      const cache = t.plugin.manifest.dir + '/calendars-cache.json'
      window.__abeleCalendarsE2E = {
        calendars: JSON.stringify(config.calendars),
        getSecret: app.secretStorage.getSecret,
        cacheExisted: await adapter.exists(cache),
        cache,
      }
      const real = window.__abeleCalendarsE2E.getSecret
      app.secretStorage.getSecret = (id) => (id === ${JSON.stringify(KEY_ID)} ? ${JSON.stringify(link)} : real.call(app.secretStorage, id))
      config.calendars = {
        refreshMinutes: 30,
        feeds: [
          { id: 'e2e', name: 'Family', color: 'green', enabled: true, source: 'ics', keyId: ${JSON.stringify(KEY_ID)}, server: '', username: '', calendarUrl: '' },
          { id: 'e2e-dav', name: 'Work (iCloud)', color: 'blue', enabled: false, source: 'caldav', keyId: '', server: 'https://caldav.icloud.com', username: 'someone@example.com', calendarUrl: '' },
        ],
      }
      config.version.value++
      await t.calendars().refresh()
      const status = t.calendars().state.status.e2e
      return { status: status.error || 'read ' + (t.calendars().state.events.e2e || []).length }
    })()`)

    screens.timeline = evalAsync<Screen>(`(async () => {
      ${PRELUDE}
      const report = { phone: document.body.classList.contains('is-phone') }
      try {
        await window.__abeleTest.plugin.activateView('abele-timeline-sidebar-view')
        const root = await until(() => document.querySelector('.abele-timeline-sidebar'), 10000)
        if (!root) return { ...report, error: 'no timeline' }
        // The list starts at the oldest overdue task, a page of days at a time; today's events
        // are further down, so it is scrolled until they are drawn.
        for (let i = 0; i < 80 && !root.querySelector('.abele-calendar-event'); i++) {
          root.scrollTop = root.scrollHeight
          await wait(250)
        }
        for (let i = 0; i < 10; i++) {
          root.scrollTop = root.scrollHeight
          await wait(250)
        }
        const first = root.querySelector('.abele-calendar-event')
        if (!first) return { ...report, error: 'no event in the timeline' }
        first.closest('.abele-timeline__date-block').scrollIntoView({ block: 'start' })
        await wait(800)
        report.events = root.querySelectorAll('.abele-calendar-event').length
        report.checkboxes = [...root.querySelectorAll('.abele-calendar-event')].filter((e) => e.querySelector('input')).length
        report.marks = root.querySelectorAll('.abele-calendar__day-event').length
        report.over = overEdge(root)
        report.sideways = root.scrollWidth - root.clientWidth
        report.shot = await picture('calendars-timeline.png')
      } catch (e) {
        report.error = String((e && e.message) || e)
      }
      return report
    })()`)

    screens.settings = evalAsync<Screen>(`(async () => {
      ${PRELUDE}
      const report = { phone: document.body.classList.contains('is-phone') }
      try {
        app.workspace.leftSplit?.collapse?.()
        app.workspace.rightSplit?.collapse?.()
        app.setting.open()
        app.setting.openTabById('abele')
        const d = await until(() => app.setting.activeTab?.containerEl?.ownerDocument, 5000)
        const tab = await until(() => [...d.querySelectorAll('.abele-settings__nav .abele-tabs__tab')].find((t) => t.textContent.trim() === 'Calendars'), 5000)
        if (!tab) return { ...report, error: 'no Calendars tab' }
        tab.click()
        const root = await until(() => d.querySelector('.abele-calendars-settings'), 5000)
        if (!root) return { ...report, error: 'no Calendars page' }
        await wait(800)
        report.over = overEdge(root)
        report.sideways = root.scrollWidth - root.clientWidth
        report.events = root.querySelectorAll('.abele-card').length
        report.shot = await picture('calendars-settings.png')
        // Each calendar's card as well, the CalDAV one with its server, username and password.
        for (const [i, card] of [...root.querySelectorAll('.abele-card')].entries()) {
          card.scrollIntoView({ block: 'start' })
          await wait(600)
          report.over = [...report.over, ...overEdge(root)]
          await picture('calendars-settings-card-' + (i + 1) + '.png')
        }
      } catch (e) {
        report.error = String((e && e.message) || e)
      } finally {
        app.setting.close()
      }
      return report
    })()`)
    console.info(`\n  ${JSON.stringify(screens)}\n`)
  }, 300_000)

  afterAll(async () => {
    if (!available) return
    try {
      evalRaw(
        `(async () => {
        const saved = window.__abeleCalendarsE2E
        if (!saved) return 'nothing to restore'
        const t = window.__abeleTest
        const config = t.AbeleConfig.getInstance()
        config.calendars = JSON.parse(saved.calendars)
        config.version.value++
        await t.calendars().refreshChanged()
        app.secretStorage.getSecret = saved.getSecret
        if (!saved.cacheExisted && (await app.vault.adapter.exists(saved.cache))) await app.vault.adapter.remove(saved.cache)
        delete window.__abeleCalendarsE2E
        return 'restored'
      })()`,
        60_000
      )
    } catch (e) {
      console.warn('[abele e2e] calendars not restored', e)
    }
    server?.stop()
    // The window first: leaving emulation reloads the app at whatever size the window is.
    if (size[0]) await setWindowSize(size[0], size[1])
    await reload('app.emulateMobile(false)')
  }, 180_000)

  it('reads the calendar through Obsidian', () => {
    expect(screens.read?.status).toMatch(/^read \d+$/)
    expect(Number(screens.read?.status?.split(' ')[1])).toBeGreaterThanOrEqual(7)
  })

  it('lists the events in the timeline, with no checkbox, and marks their days', () => {
    expect(screens.timeline?.error).toBeUndefined()
    expect(screens.timeline?.phone).toBe(true)
    // The weekly one four times, the night train on two days, the trip on three, the dentist.
    expect(screens.timeline?.events).toBeGreaterThanOrEqual(8)
    expect(screens.timeline?.checkboxes).toBe(0)
    expect(screens.timeline?.marks).toBeGreaterThan(0)
  })

  it.each(['timeline', 'settings'])('%s: nothing reaches past the edge of the screen', (s) => {
    expect(screens[s]?.error).toBeUndefined()
    expect(screens[s]?.over ?? ['no report']).toEqual([])
    expect(screens[s]?.sideways).toBe(0)
  })

  it('shows the calendars on their settings page', () => {
    expect(screens.settings?.events).toBe(2)
  })
})
