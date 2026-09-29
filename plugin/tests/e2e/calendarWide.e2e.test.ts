/**
 * A wide entry in the sidebar timeline stays inside the sidebar: an event from an external
 * calendar whose title, place, link and description are long runs with no space to break at,
 * and a task note written the same way. Each is measured folded and with its description
 * open, in a narrow sidebar on the desktop and then in the layout Obsidian gives a phone
 * (`app.emulateMobile(true)`, 390×844):
 *
 * - the sidebar has nothing to scroll sideways (`scrollWidth` equals `clientWidth`);
 * - neither entry, nor anything inside it, reaches past the sidebar's right edge.
 *
 * Pictures go to `/tmp/abele-phone/calendar-wide-*.png`; look at them.
 *
 * The calendar is put in the settings in memory only and its link is never stored, as in
 * `calendarsPhone.e2e.test.ts`. The task note is created for the run and removed afterwards,
 * with the sidebar's width, the window's size and the calendar cache put back.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { evalLong, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { LINK_TOKEN } from '../helpers/fakeCalendarServer'
import { targets } from './helpers/target'
import { startCalendarProcess, type CalendarProcess } from './helpers/calendarProcess'
import { shotDir } from './helpers/shots'

targets('desktop')

const PHONE = { width: 390, height: 844 }
/** As narrow as Obsidian lets a sidebar get, so a long run cannot fit by luck. */
const SIDEBAR_WIDTH = 300
const SHOTS = shotDir('abele-phone')
const KEY_ID = 'abele-e2e-wide-calendar'
const TASK_PATH = 'ScaleTest/Tasks/Sample wide task.md'
const available = isObsidianRunning() && hasTestApi()

const RUN = 'Quarterlyplanningreviewwithalltheregionalteamsandtheirleads'
const EVENT_TITLE = `Wideevent${RUN}${RUN}`
const EVENT_PLACE = `Buildingseven${RUN}Roomfourteen`
const EVENT_URL = `https://meet.example.com/join/${RUN}${RUN}?pwd=${RUN}`
const EVENT_TEXT = `Agenda in the link https://docs.example.com/agenda/${RUN}/${RUN}/${RUN} and a few ordinary words after it.`
const TASK_TITLE = `Widetask${RUN}${RUN}`
const TASK_TEXT = `See https://docs.example.com/notes/${RUN}/${RUN}/${RUN} before the meeting.`

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
/** Runs a script that may take a while, its result carried back as JSON. */
const evalAsync = async <T>(script: string, timeoutMs = 180_000): Promise<T> =>
  JSON.parse(await evalLong(`(async () => JSON.stringify(await (${script})))()`, timeoutMs)) as T

/** One event at noon today, everything about it one long word. Lines are folded as ICS wants. */
function wideCalendar(): string {
  const stamp = (d: Date) =>
    d
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const at = (hours: number) => new Date(today.getTime() + hours * 3600000)
  const fold = (line: string): string => {
    const out: string[] = []
    for (let i = 0; i < line.length; i += 70) out.push((i ? ' ' : '') + line.slice(i, i + 70))
    return out.join('\r\n')
  }
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//abele e2e//EN',
    'BEGIN:VEVENT',
    'UID:wide@e2e',
    'DTSTAMP:20260101T000000Z',
    `DTSTART:${stamp(at(12))}`,
    `DTEND:${stamp(at(12.5))}`,
    fold(`SUMMARY:${EVENT_TITLE}`),
    fold(`LOCATION:${EVENT_PLACE}`),
    fold(`URL:${EVENT_URL}`),
    fold(`DESCRIPTION:${EVENT_TEXT}`),
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n')
}

const today = (): string => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
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

/** Puts the calendar in the settings in memory, its link behind a wrapped `getSecret`. */
const setUpCalendar = (link: string): Promise<string> =>
  evalAsync<string>(`(async () => {
    const t = window.__abeleTest
    const config = t.AbeleConfig.getInstance()
    const adapter = app.vault.adapter
    const cache = t.plugin.manifest.dir + '/calendars-cache.json'
    const saved = window.__abeleWideE2E ?? {
      calendars: JSON.stringify(config.calendars),
      getSecret: app.secretStorage.getSecret,
      cacheExisted: await adapter.exists(cache),
      cache,
    }
    window.__abeleWideE2E = saved
    const real = saved.getSecret
    app.secretStorage.getSecret = (id) => (id === ${JSON.stringify(KEY_ID)} ? ${JSON.stringify(link)} : real.call(app.secretStorage, id))
    config.calendars = {
      refreshMinutes: 30,
      feeds: [{ id: 'e2e-wide', name: 'Averylongcalendarnamewithoutanyspacesinit', color: 'purple', enabled: true, source: 'ics', keyId: ${JSON.stringify(KEY_ID)}, server: '', username: '', calendarUrl: '' }],
    }
    config.version.value++
    await t.calendars().refresh()
    const status = t.calendars().state.status['e2e-wide']
    return status.error || 'read ' + (t.calendars().state.events['e2e-wide'] || []).length
  })()`)

const restoreCalendar = (): void => {
  evalRaw(
    `(async () => {
      const saved = window.__abeleWideE2E
      if (!saved) return 'nothing to restore'
      const t = window.__abeleTest
      const config = t.AbeleConfig.getInstance()
      config.calendars = JSON.parse(saved.calendars)
      config.version.value++
      await t.calendars().refreshChanged()
      app.secretStorage.getSecret = saved.getSecret
      if (!saved.cacheExisted && (await app.vault.adapter.exists(saved.cache))) await app.vault.adapter.remove(saved.cache)
      delete window.__abeleWideE2E
      return 'restored'
    })()`,
    60_000
  )
}

interface Measure {
  /** How far the sidebar scrolls sideways. */
  sideways: number
  /** What reaches past the sidebar's right edge, and by how much. */
  over: string[]
}

interface Screen {
  error?: string
  phone?: boolean
  width?: number
  folded?: Measure
  open?: Measure
  shot?: string
}

/** Opens the timeline, finds both entries, measures them folded and open, takes pictures. */
const probe = (tag: string, sidebarWidth: number | null): Promise<Screen> =>
  evalAsync<Screen>(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const until = async (fn, ms) => {
      const deadline = Date.now() + ms
      while (Date.now() < deadline) { const v = fn(); if (v) return v; await wait(100) }
      return null
    }
    const name = (el) => el.tagName.toLowerCase() + '.' + [...el.classList].join('.')
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
    const report = { phone: document.body.classList.contains('is-phone') }
    try {
      await window.__abeleTest.plugin.activateView('abele-timeline-sidebar-view')
      const root = await until(() => document.querySelector('.abele-timeline-sidebar'), 10000)
      if (!root) return { ...report, error: 'no timeline' }
      ${
        sidebarWidth
          ? `// Whichever sidebar holds the timeline: the plugin opens it where it was last left.
      const split = app.workspace.getLeavesOfType('abele-timeline-sidebar-view')[0]?.getRoot()
      if (split !== app.workspace.leftSplit && split !== app.workspace.rightSplit) return { ...report, error: 'the timeline is not in a sidebar' }
      window.__abeleWideE2E.sidebar = window.__abeleWideE2E.sidebar ?? { left: split === app.workspace.leftSplit, size: split.size, collapsed: split.collapsed }
      split.expand()
      split.setSize(${sidebarWidth})
      await wait(600)`
          : ''
      }
      report.width = Math.round(root.getBoundingClientRect().width)
      const find = () => {
        const event = [...root.querySelectorAll('.abele-calendar-event')].find((e) => e.textContent.includes(${JSON.stringify(EVENT_TITLE)}))
        const task = [...root.querySelectorAll('.abele-task-view')].find((e) => e.textContent.includes(${JSON.stringify(TASK_TITLE)}))
        return event && task ? { event, task } : null
      }
      // The list starts at the oldest overdue task and draws a page of days at a time.
      for (let i = 0; i < 120 && !find(); i++) {
        root.scrollTop = root.scrollHeight
        await wait(250)
      }
      const found = find()
      if (!found) return { ...report, error: 'the wide entries never showed' }
      const measure = () => {
        const edge = Math.min(root.getBoundingClientRect().right, window.innerWidth)
        const over = []
        for (const entry of [found.event, found.task]) {
          for (const el of [entry, ...entry.querySelectorAll('*')]) {
            const s = getComputedStyle(el)
            if (s.visibility === 'hidden' || s.display === 'none' || s.position === 'absolute') continue
            const r = el.getBoundingClientRect()
            if (r.width > 0 && r.right > edge + 1) over.push(name(el) + ' +' + Math.round(r.right - edge))
          }
        }
        return { sideways: root.scrollWidth - root.clientWidth, over: over.slice(0, 12) }
      }
      found.event.scrollIntoView({ block: 'start' })
      await wait(600)
      report.folded = measure()
      await picture('calendar-wide-${tag}-folded.png')
      // The chevron of each opens its description.
      const chevron = (entry) => [...entry.querySelectorAll('.abele-obsidian-icon')].find((i) => i.querySelector('.lucide-chevron-down'))
      const toggles = [chevron(found.event), chevron(found.task)]
      if (toggles.some((t) => !t)) return { ...report, error: 'no chevron to open a description' }
      for (const t of toggles) t.click()
      await until(() => found.event.querySelector('.abele-calendar-event__description') && found.task.querySelector('.abele-task-view__description'), 5000)
      await wait(800)
      found.event.scrollIntoView({ block: 'start' })
      await wait(400)
      report.open = measure()
      report.shot = await picture('calendar-wide-${tag}-open.png')
      // Folded again, so the next pass starts where this one did.
      for (const t of toggles) t.click()
    } catch (e) {
      report.error = String((e && e.message) || e)
    }
    return report
  })()`)

describe.skipIf(!available)('a wide entry in the sidebar timeline', () => {
  let server: CalendarProcess
  let size: [number, number] = [0, 0]
  let link = ''
  const screens: Record<string, Screen> = {}
  const reads: Record<string, string> = {}

  beforeAll(async () => {
    server = await startCalendarProcess(wideCalendar())
    link = `${server.origin}/secret/${LINK_TOKEN}.ics`
    size = windowSize()
    await evalAsync<string>(`(async () => {
      const text = ${JSON.stringify(`---\ntype: task\ndate: ${today()}\n---\n${TASK_TITLE}\n\n${TASK_TEXT}\n`)}
      const existing = app.vault.getAbstractFileByPath(${JSON.stringify(TASK_PATH)})
      if (existing) await app.vault.modify(existing, text)
      else await app.vault.create(${JSON.stringify(TASK_PATH)}, text)
      return 'ok'
    })()`)
    await pause(1500)

    reads.desktop = await setUpCalendar(link)
    screens.desktop = await probe('desktop', SIDEBAR_WIDTH)
    // Put the sidebar back before the phone layout replaces it.
    evalRaw(`(() => {
      const saved = window.__abeleWideE2E?.sidebar
      if (!saved) return 'nothing'
      const split = saved.left ? app.workspace.leftSplit : app.workspace.rightSplit
      if (saved.size) split.setSize(saved.size)
      if (saved.collapsed) split.collapse()
      delete window.__abeleWideE2E.sidebar
      return 'ok'
    })()`)
    restoreCalendar()

    await reloadApp('app.emulateMobile(true)')
    await setWindowSize(PHONE.width, PHONE.height)
    await reloadApp('window.location.reload()')
    reads.phone = await setUpCalendar(link)
    screens.phone = await probe('phone', null)
    console.info(`\n  ${JSON.stringify({ reads, screens })}\n`)
  }, 400_000)

  afterAll(async () => {
    if (!available) return
    try {
      restoreCalendar()
      evalRaw(`(async () => {
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(TASK_PATH)})
        if (file) await app.vault.delete(file)
        return 'ok'
      })()`)
    } catch (e) {
      console.warn('[abele e2e] wide calendar not restored', e)
    }
    server?.stop()
    // The window first: leaving emulation reloads the app at whatever size the window is.
    if (size[0]) await setWindowSize(size[0], size[1])
    await reloadApp('app.emulateMobile(false)')
  }, 180_000)

  it('reads the calendar on both passes', () => {
    expect(reads.desktop).toBe('read 1')
    expect(reads.phone).toBe('read 1')
  })

  it.each(['desktop', 'phone'])('%s: the sidebar has nothing to scroll sideways', (s) => {
    expect(screens[s]?.error).toBeUndefined()
    expect(screens[s]?.folded?.sideways).toBe(0)
    expect(screens[s]?.open?.sideways).toBe(0)
  })

  it.each(['desktop', 'phone'])('%s: no entry reaches past the sidebar edge', (s) => {
    expect(screens[s]?.error).toBeUndefined()
    expect(screens[s]?.folded?.over ?? ['no report']).toEqual([])
    expect(screens[s]?.open?.over ?? ['no report']).toEqual([])
  })

  it('measured the desktop in a narrow sidebar and the phone in its layout', () => {
    expect(screens.desktop?.width).toBeLessThanOrEqual(SIDEBAR_WIDTH + 1)
    expect(screens.phone?.phone).toBe(true)
  })
})
