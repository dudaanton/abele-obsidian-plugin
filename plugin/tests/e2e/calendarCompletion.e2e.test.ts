/** One owner checkbox, not a series edit, in the live timeline and calendar on both devices. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { startCalendarProcess, type CalendarProcess } from './helpers/calendarProcess'
import { LINK_TOKEN } from '../helpers/fakeCalendarServer'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const SHOTS = shotDir('abele-phone')
const FOLDER = 'SampleCalendarCompletionE2E'
const KEY = 'sample-calendar-completion-key'
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const exec = <T>(code: string): T => {
  const result = evalRaw(code, 120_000)
  if (result.startsWith('Error:')) throw new Error(result)
  return JSON.parse(result) as T
}
const profiles = onPhone() ? ['phone'] : ['desktop', 'emulated phone']

const today = new Date()
today.setHours(0, 0, 0, 0)
const stamp = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
const start = new Date(today.getTime() + 9 * 3600000)
const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:sample-series',
  `DTSTART:${stamp(start)}`,
  `DTEND:${stamp(new Date(start.getTime() + 3600000))}`,
  'RRULE:FREQ=DAILY;COUNT=3',
  'SUMMARY:Sample daily meeting',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')
const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, stage = 'event UI') => {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) { const value = fn(); if (value) return value; await wait(100) }
    throw Error('Timed out waiting for ' + stage)
  }
  const shot = async (name) => {
    const path = ${JSON.stringify(SHOTS)} + '/calendar-completion-' + name + '.png'
    if (window.__e2eHost) { await window.__e2eHost.shot(path); return }
    const image = await require('@electron/remote').getCurrentWebContents().capturePage()
    require('fs').writeFileSync(path, image.toPNG())
  }
`

describe.skipIf(!available)('single external occurrence completion in the running app', () => {
  let server: CalendarProcess
  let size: number[] = []
  let emulated = false
  beforeAll(async () => {
    server = await startCalendarProcess(ICS)
    if (!onPhone())
      size = exec<number[]>(
        `JSON.stringify(require('@electron/remote').getCurrentWindow().getContentSize())`
      )
  })
  afterAll(async () => {
    server?.stop()
    if (!onPhone()) {
      if (size.length)
        evalRaw(
          `require('@electron/remote').getCurrentWindow().setContentSize(${size[0]}, ${size[1]})`
        )
      if (emulated) await reloadApp('app.emulateMobile(false)')
    }
  }, 180_000)

  it.each(profiles)(
    '%s: ticks from both views, refreshes, hides completed, and reopens only that occurrence',
    async (profile) => {
      if (!onPhone()) {
        emulated = profile === 'emulated phone'
        await reloadApp(`app.emulateMobile(${emulated})`)
        evalRaw(
          `require('@electron/remote').getCurrentWindow().setContentSize(${emulated ? '390, 844' : '1100, 850'})`
        )
        await pause(700)
      }
      const link = `${server.origin}/secret/${LINK_TOKEN}.ics`
      try {
        const result = exec<{
          timeline: boolean[]
          calendar: boolean[]
          refreshed: boolean[]
          hidden: number
          checked: boolean
          reopened: boolean[]
          sideways: number
        }>(`(async () => {
        ${PRELUDE}
        const t = window.__abeleTest, config = t.AbeleConfig.getInstance(), service = t.calendars()
        const adapter = app.vault.adapter, dir = t.plugin.manifest.dir
        const data = dir + '/data.json', cache = dir + '/calendars-cache.json'
        window.__sampleCompletionE2E = {
          calendars: JSON.stringify(config.calendars), marks: JSON.stringify(config.calendarCompletion ?? {}),
          secret: app.secretStorage.getSecret, layout: app.workspace.getLayout(),
          data, dataText: await adapter.exists(data) ? await adapter.read(data) : null,
          cache, cacheText: await adapter.exists(cache) ? await adapter.read(cache) : null,
        }
        const saved = window.__sampleCompletionE2E
        app.secretStorage.getSecret = (id) => id === ${JSON.stringify(KEY)} ? ${JSON.stringify(link)} : saved.secret.call(app.secretStorage, id)
        config.calendarCompletion = {}
        config.calendars = { refreshMinutes: 30, feeds: [{ id: 'sample-feed', name: 'Sample calendar', color: 'blue', enabled: true, source: 'ics', keyId: ${JSON.stringify(KEY)}, server: '', username: '', calendarUrl: '' }] }
        config.version.value++
        await service.refresh()
        const events = service.state.events['sample-feed']
        if (events.length !== 3) throw Error('Expected three recurring instances, got ' + events.length)
        const done = () => service.state.events['sample-feed'].map((e) => service.isDone(e))
        await t.plugin.activateView('abele-timeline-sidebar-view')
        const timeline = await until(() => document.querySelector('.abele-timeline-sidebar'))
        const row = await until(() => timeline.querySelector('[data-timeline-item="event:' + events[0].id + '"]'))
        row.scrollIntoView({ block: 'center' })
        await wait(300)
        const input = row.querySelector('input[type=checkbox]')
        if (!input) throw Error('Timeline event has no completion checkbox')
        input.click()
        await until(() => service.isDone(events[0]) && !timeline.contains(row))
        const timelineDone = done()
        timeline.querySelector('.abele-timeline__completed-toggle').click()
        const checked = await until(() => timeline.querySelector('[data-timeline-item="event:' + events[0].id + '"] input:checked'))
        checked.scrollIntoView({ block: 'center' })
        await shot(${JSON.stringify(profile.replaceAll(' ', '-'))} + '-timeline')
        if (!app.vault.getAbstractFileByPath(${JSON.stringify(FOLDER)})) await app.vault.createFolder(${JSON.stringify(FOLDER)})
        const path = ${JSON.stringify(FOLDER + '/sample-calendar-' + profile.replaceAll(' ', '-') + '.base')}
        await app.vault.create(path, 'filters:\\n  and:\\n    - file.inFolder("${FOLDER}/missing")\\nviews:\\n  - type: abele-calendar\\n    name: Sample calendar\\n    showCalendarEvents: true\\n')
        app.workspace.leftSplit?.collapse?.(); app.workspace.rightSplit?.collapse?.()
        // getLeaf('tab') follows the active group: the timeline above made its sidebar active.
        const main = app.workspace.getMostRecentLeaf(app.workspace.rootSplit)
        if (main) app.workspace.setActiveLeaf(main, { focus: false })
        const leaf = app.workspace.getLeaf('tab')
        await leaf.openFile(app.vault.getFileByPath(path))
        await app.workspace.revealLeaf(leaf)
        app.workspace.setActiveLeaf(leaf, { focus: true })
        const root = await until(() => leaf.view.containerEl.querySelector('.abele-calendar-base'), 'calendar root')
        const agenda = await until(() => root.querySelector('.abele-calendar-base__agenda input:checked'), 'checked calendar occurrence').catch(error => {
          throw Error(error.message + ': ' + JSON.stringify({
            done: done(), text: root.textContent, inputs: [...root.querySelectorAll('input')].map(input => ({checked: input.checked, label: input.getAttribute('aria-label')})),
            instances: [...t.GlobalStore.getInstance().calendarBaseInstances.value.values()].map(instance => ({events: instance.showEvents.value, mode: instance.mode.value})),
          }))
        })
        agenda.scrollIntoView({ block: 'center' })
        agenda.click()
        await until(() => !service.isDone(events[0]))
        const calendarUndone = done()
        const checkbox = await until(() => root.querySelector('.abele-calendar-base__agenda input'))
        checkbox.click()
        await until(() => service.isDone(events[0]))
        await service.refresh()
        const refreshed = done()
        await until(() => root.querySelector('.abele-calendar-base__agenda input:checked'))
        const sideways = Math.max(0, root.scrollWidth - root.clientWidth)
        await shot(${JSON.stringify(profile.replaceAll(' ', '-'))} + '-calendar')
        root.querySelector('.abele-calendar-base__completed-toggle').click()
        await wait(200)
        const hidden = root.querySelectorAll('.abele-calendar-base__agenda input').length
        root.querySelector('.abele-calendar-base__completed-toggle').click()
        const restored = await until(() => root.querySelector('.abele-calendar-base__agenda input:checked'))
        restored.click()
        await until(() => !service.isDone(events[0]))
        return { timeline: timelineDone, calendar: calendarUndone, refreshed, hidden, checked: !!checked, reopened: done(), sideways }
      })()`)
        expect(result.timeline).toEqual([true, false, false])
        expect(result.calendar).toEqual([false, false, false])
        expect(result.refreshed).toEqual([true, false, false])
        expect(result.hidden).toBe(0)
        expect(result.checked).toBe(true)
        expect(result.reopened).toEqual([false, false, false])
        expect(result.sideways).toBe(0)
      } finally {
        exec(`(async () => {
        const saved = window.__sampleCompletionE2E
        if (!saved) return { restored: false }
        const config = window.__abeleTest.AbeleConfig.getInstance(), adapter = app.vault.adapter
        config.calendars = JSON.parse(saved.calendars); config.calendarCompletion = JSON.parse(saved.marks)
        app.secretStorage.getSecret = saved.secret
        config.version.value++
        await window.__abeleTest.calendars().refreshChanged()
        await app.workspace.changeLayout(saved.layout)
        const fixture = app.vault.getAbstractFileByPath(${JSON.stringify(FOLDER)})
        if (fixture) await app.vault.delete(fixture, true)
        for (const [path, text] of [[saved.data, saved.dataText], [saved.cache, saved.cacheText]]) {
          if (text !== null) await adapter.write(path, text)
          else if (await adapter.exists(path)) await adapter.remove(path)
        }
        delete window.__sampleCompletionE2E
        return { restored: true }
      })()`)
      }
    },
    240_000
  )
})
