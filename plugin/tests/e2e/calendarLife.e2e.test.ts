/**
 * The calendar's life in weeks in the running app: a folder of notes and a `.base` over it
 * opening on the Life layout, first with no birth date — the prompt, filled in and saved —
 * then drawn: weeks lived and left, this week listed under the grid, a week years back pressed
 * on the canvas and listed instead. Then the same on a phone (390×844 under `emulateMobile`):
 * fifty-two weeks across with nothing past the right edge, and a finger's tap picking a week.
 * Pictures of each go to `/tmp/abele-phone/calendar-life-*.png`.
 *
 * The birth date and life expectancy the vault had are put back afterwards, and everything
 * made is removed: the fixture vault holds `ScaleTest/` and nothing else.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning, evalRaw, reloadApp } from './helpers/obsidianCli'
import { lifeSummary, lifeWeekOf } from '@/bases/lifeWeeks'
import { shotDir } from './helpers/shots'

const PHONE = { width: 390, height: 844 }
const SHOTS = shotDir('abele-phone')
const FOLDER = 'CalendarLifeE2E'
const BIRTH = '1990-05-17'
const available = isObsidianRunning() && hasTestApi()

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const evalAsync = <T>(script: string, timeoutMs = 60_000): T =>
  JSON.parse(evalRaw(script, timeoutMs)) as T

const pad = (n: number) => String(n).padStart(2, '0')
const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const today = dayOf(new Date())
const OLD_DAY = '2001-03-10'
const thisWeek = lifeWeekOf(BIRTH, today)!.index
const oldWeek = lifeWeekOf(BIRTH, OLD_DAY)!.index
const summary = lifeSummary(BIRTH, 80, today)

const note = (fm: Record<string, string>) =>
  `---\ntype: task\n${Object.entries(fm)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join('\n')}\n---\n\n`

const FILES: Record<string, string> = {
  'Standup.md': note({ date: today }),
  'Review.md': note({ date: today }),
  'School play.md': note({ date: OLD_DAY }),
}

const BASE = `filters:
  and:
    - file.inFolder("${FOLDER}/Tasks")
views:
  - type: abele-calendar
    name: Calendar
    mode: life
`

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
  const openBase = async () => {
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(`${FOLDER}/Calendar.base`)})
    if (!file) return null
    const leaf = app.workspace.getLeaf('tab')
    await leaf.openFile(file)
    app.workspace.setActiveLeaf(leaf, { focus: true })
    return await until(() => leaf.view.containerEl.querySelector('.abele-calendar-base'), 15000)
  }
  const chips = (el) => el ? [...el.querySelectorAll('.abele-calendar-chip__title')].map((c) => c.textContent.trim()) : []
  /** The middle of a week's box on the canvas, from the grid the view says it drew. */
  const weekPoint = (canvas, index) => {
    const g = JSON.parse(canvas.dataset.grid)
    const column = index % 52, row = Math.floor(index / 52)
    const x = g.label + column * (g.cell + g.gap) + (column >= 26 ? g.half : 0) + g.cell / 2
    const y = g.top + row * (g.cell + g.gap) + Math.floor(row / 10) * g.decade + g.cell / 2
    const box = canvas.getBoundingClientRect()
    return [box.left + x, box.top + y]
  }
  const press = async (canvas, index) => {
    const [x, y] = weekPoint(canvas, index)
    canvas.scrollIntoView({ block: 'nearest' })
    await wait(200)
    const [cx, cy] = weekPoint(canvas, index)
    canvas.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx, clientY: cy }))
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: cx, clientY: cy }))
    await wait(400)
  }
  const cfg = window.__abeleTest.AbeleConfig.getInstance()
`

const setWindowSize = async (width: number, height: number): Promise<void> => {
  evalRaw(
    `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${width}, ${height}); return 'ok' })()`,
    30_000
  )
  await pause(1500)
}

interface Report {
  error?: string
  phone?: boolean
  prompt?: boolean
  drawn?: boolean
  drawMs?: number
  wideCell?: number
  canvas?: [number, number]
  lived?: string
  left?: string
  percent?: string
  panelWeek?: string
  panelItems?: string[]
  pressedWeek?: string
  pressedItems?: string[]
  hint?: string
  over?: string[]
  shots?: string[]
}

describe.skipIf(!available)('the life in weeks of a calendar base', () => {
  let size: [number, number] = [0, 0]
  let saved = { birthDate: '', lifeExpectancy: 80 }
  let desktop: Report = {}
  let phone: Report = {}

  beforeAll(async () => {
    saved = evalAsync(`(async () => {
      const cfg = window.__abeleTest.AbeleConfig.getInstance()
      const saved = { birthDate: cfg.birthDate, lifeExpectancy: cfg.lifeExpectancy }
      cfg.birthDate = ''
      cfg.lifeExpectancy = 80
      await cfg.saveSettings()
      await app.vault.adapter.mkdir(${JSON.stringify(`${FOLDER}/Tasks`)})
      const files = ${JSON.stringify(FILES)}
      for (const [name, content] of Object.entries(files)) {
        await app.vault.create(${JSON.stringify(`${FOLDER}/Tasks/`)} + name, content)
      }
      await app.vault.create(${JSON.stringify(`${FOLDER}/Calendar.base`)}, ${JSON.stringify(BASE)})
      return JSON.stringify(saved)
    })()`)
    await pause(2000)

    desktop = evalAsync<Report>(`(async () => {
      ${PRELUDE}
      const report = { shots: [] }
      try {
        const root = await openBase()
        if (!root) return { error: 'the calendar did not open' }
        await wait(800)
        const prompt = root.querySelector('.abele-calendar-base__birth')
        report.prompt = !!prompt
        report.shots.push(await picture('calendar-life-desktop-prompt.png'))
        const input = prompt?.querySelector('input')
        if (input) {
          input.value = ${JSON.stringify(BIRTH)}
          input.dispatchEvent(new Event('input', { bubbles: true }))
          await wait(200)
          const started = performance.now()
          prompt.querySelector('button').click()
          const canvas = await until(() => root.querySelector('.abele-calendar-life__grid'), 5000)
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
          report.drawMs = Math.round(performance.now() - started)
          report.drawn = !!canvas
        }
        await wait(500)
        const canvas = root.querySelector('.abele-calendar-life__grid')
        report.canvas = canvas ? [canvas.width, canvas.height] : null
        report.lived = root.querySelector('.abele-calendar-life__lived')?.textContent.trim()
        report.left = root.querySelector('.abele-calendar-life__left')?.textContent.trim()
        report.percent = root.querySelector('.abele-calendar-life__percent')?.textContent.trim()
        const panel = () => root.querySelector('.abele-calendar-base__life-week')
        report.panelWeek = panel()?.dataset.week
        report.panelItems = chips(panel())
        report.shots.push(await picture('calendar-life-desktop.png'))
        // With the sidebars away the boxes are big enough to carry their counts.
        const left = app.workspace.leftSplit, right = app.workspace.rightSplit
        const wasOpen = [!left?.collapsed, !right?.collapsed]
        left?.collapse?.(); right?.collapse?.()
        await wait(800)
        report.wideCell = JSON.parse(root.querySelector('.abele-calendar-life__grid')?.dataset.grid ?? '{}').cell
        report.shots.push(await picture('calendar-life-desktop-wide.png'))
        if (wasOpen[0]) left?.expand?.()
        if (wasOpen[1]) right?.expand?.()
        await wait(800)
        if (canvas) {
          await press(canvas, ${oldWeek})
          report.pressedWeek = panel()?.dataset.week
          report.pressedItems = chips(panel())
          report.hint = root.querySelector('.abele-calendar-life__hint')?.textContent.trim()
          panel()?.scrollIntoView({ block: 'end' })
          await wait(300)
          report.shots.push(await picture('calendar-life-desktop-week.png'))
        }
      } catch (e) {
        report.error = String((e && e.message) || e)
      }
      return JSON.stringify(report)
    })()`)

    size = JSON.parse(
      evalRaw(`JSON.stringify(require('@electron/remote').getCurrentWindow().getContentSize())`)
    ) as [number, number]
    await reloadApp('app.emulateMobile(true)')
    await setWindowSize(PHONE.width, PHONE.height)
    await reloadApp('window.location.reload()')

    phone = evalAsync<Report>(`(async () => {
      ${PRELUDE}
      const report = { phone: document.body.classList.contains('is-phone'), shots: [] }
      try {
        app.workspace.leftSplit?.collapse?.()
        app.workspace.rightSplit?.collapse?.()
        const root = await openBase()
        if (!root) return { ...report, error: 'the calendar did not open' }
        await wait(1200)
        const canvas = root.querySelector('.abele-calendar-life__grid')
        report.canvas = canvas ? [canvas.clientWidth, canvas.clientHeight] : null
        report.over = overEdge(root)
        report.shots.push(await picture('calendar-life-phone.png'))
        if (canvas) {
          await press(canvas, ${oldWeek})
          const panel = root.querySelector('.abele-calendar-base__life-week')
          report.pressedWeek = panel?.dataset.week
          report.pressedItems = chips(panel)
          panel?.scrollIntoView({ block: 'end' })
          await wait(400)
          report.shots.push(await picture('calendar-life-phone-week.png'))
        }
      } catch (e) {
        report.error = String((e && e.message) || e)
      }
      return JSON.stringify(report)
    })()`)
    console.info(`\n  ${JSON.stringify({ desktop, phone })}\n`)
  }, 300_000)

  afterAll(async () => {
    if (!available) return
    try {
      evalRaw(
        `(async () => {
          for (const leaf of app.workspace.getLeavesOfType('bases')) {
            if (leaf.view.file?.path?.startsWith(${JSON.stringify(FOLDER + '/')})) leaf.detach()
          }
          const folder = app.vault.getAbstractFileByPath(${JSON.stringify(FOLDER)})
          if (folder) await app.vault.delete(folder, true)
          const cfg = window.__abeleTest.AbeleConfig.getInstance()
          cfg.birthDate = ${JSON.stringify(saved.birthDate)}
          cfg.lifeExpectancy = ${JSON.stringify(saved.lifeExpectancy)}
          await cfg.saveSettings()
          return 'removed'
        })()`,
        60_000
      )
    } catch (e) {
      console.warn('[abele e2e] calendar life fixture not removed', e)
    }
    if (size[0]) await setWindowSize(size[0], size[1])
    await reloadApp('app.emulateMobile(false)')
  }, 180_000)

  it('asks for the birth date, and draws the weeks once it is given', () => {
    expect(desktop.error).toBeUndefined()
    expect(desktop.prompt).toBe(true)
    expect(desktop.drawn).toBe(true)
    // Over four thousand weeks in one canvas: drawn within a couple of frames.
    expect(desktop.drawMs ?? Infinity).toBeLessThan(1000)
    expect(desktop.wideCell ?? 0).toBeGreaterThanOrEqual(15)
  })

  it('says how many weeks are lived and left', () => {
    // The numbers are grouped the way the app's locale groups them.
    const digits = (text?: string) => Number((text ?? '').replace(/\D/g, ''))
    expect(desktop.lived).toMatch(/weeks lived$/)
    expect(digits(desktop.lived)).toBe(summary.lived)
    expect(digits(desktop.left)).toBe(summary.left)
    expect(desktop.percent).toBe(`${summary.percent}% of 80 years`)
  })

  it('lists this week under the grid, and a week pressed on the canvas instead', () => {
    expect(desktop.panelWeek).toBe(String(thisWeek))
    expect(desktop.panelItems).toEqual(expect.arrayContaining(['Standup', 'Review']))
    expect(desktop.pressedWeek).toBe(String(oldWeek))
    expect(desktop.pressedItems).toEqual(['School play'])
    expect(desktop.hint).toMatch(/1 note$/)
  })

  it('on a phone: fifty-two weeks across, nothing past the edge, a tap picks a week', () => {
    expect(phone.error).toBeUndefined()
    expect(phone.phone).toBe(true)
    expect(phone.over).toEqual([])
    expect(phone.canvas?.[0] ?? Infinity).toBeLessThanOrEqual(PHONE.width)
    expect(phone.pressedWeek).toBe(String(oldWeek))
    expect(phone.pressedItems).toEqual(['School play'])
  })
})
