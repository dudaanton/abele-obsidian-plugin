/**
 * Nothing in the settings pane scrolls sideways.
 *
 * happy-dom computes no layout, so this is the only tier that can answer the question. It is
 * asked geometrically: take the container's rectangle, walk its descendants, and fail on any
 * whose right edge is past it. `scrollWidth > clientWidth` is not usable — on a wrapped flex
 * row it reports overflow that is not there.
 *
 * Two kinds of element are skipped or the check reports phantoms: Obsidian sizes a dropdown by
 * cloning it off-screen (`.is-measuring`), and anything hidden or absolutely positioned pushes
 * no layout sideways.
 *
 * Requires Obsidian running with the plugin installed — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { isObsidianRunning, evalJson, evalRaw, activeVaultName } from './helpers/obsidianCli'

interface Overflow {
  /** Class names of elements sticking out, with how far past the container they reach. */
  over: string[]
  /** How far the container itself can be scrolled sideways. Must be zero. */
  scroll: number
}

type Report = Record<string, Overflow>

/**
 * A desktop settings window, and one narrow enough that the content pane is phone-column wide.
 *
 * 620 rather than 360: Obsidian's own settings chrome does not adapt below roughly 600px in a
 * desktop window — its sidebar keeps its width and leaves the plugin under 100px, which no
 * layout survives and which no user ever sees. A real phone runs the `.is-mobile` layout
 * instead. What matters here is the width of the pane the plugin is given, and at 620 that is
 * about 356px.
 */
const WIDTHS = [900, 620]

/**
 * The probe is asynchronous — it clicks through tabs and waits for each to render — and
 * `evalJson` cannot await a promise, so the result is parked on the window and polled for.
 */
const PROBE = `(() => { window.__abeleLayoutProbe = null; (async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  app.setting.open()
  app.setting.openTabById('abele')
  await wait(800)

  const d = app.setting.activeTab.containerEl.ownerDocument
  const view = d.defaultView
  const qa = (s) => [...d.querySelectorAll(s)]

  const measure = (rootSel) => {
    const root = d.querySelector(rootSel)
    if (!root) return { over: ['missing ' + rootSel], scroll: -1 }
    const box = root.getBoundingClientRect()
    const over = []
    const walk = (el) => {
      const s = view.getComputedStyle(el)
      if (s.visibility === 'hidden' || s.display === 'none' || s.position === 'absolute') return
      if (el.classList.contains('is-measuring')) return
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.right > box.right + 1) {
        over.push((el.className || el.tagName).toString().slice(0, 40) +
          ' +' + Math.round(r.right - box.right))
      }
      for (const c of el.children) walk(c)
    }
    for (const c of root.children) walk(c)
    return { over, scroll: root.scrollWidth - root.clientWidth }
  }

  const report = {}
  const topTabs = () => qa('.abele-settings__nav .abele-tabs__tab')
  for (const tab of topTabs()) {
    const label = tab.textContent.trim()
    tab.click()
    await wait(250)
    report[label] = measure('.abele-settings__content')
  }

  topTabs().find((t) => t.textContent.includes('AI Agent')).click()
  await wait(300)
  qa('.abele-ai-settings__tabs .abele-tabs__tab')
    .find((t) => t.textContent.trim() === 'Agents')
    .click()
  await wait(300)
  report['AI → Agents'] = measure('.abele-settings__content')

  d.querySelector('.abele-card').click()
  await wait(500)
  for (const section of qa('.abele-agent-editor .abele-tabs__tab')) {
    const label = section.textContent.trim()
    section.click()
    await wait(300)
    report['agent editor → ' + label] = measure('.abele-agent-editor')
  }

  const { remote } = require('electron')
  const settingsWindow = remote.BrowserWindow.getAllWindows()
    .find((w) => w.getTitle().startsWith('Settings'))
  if (settingsWindow) settingsWindow.close()

  window.__abeleLayoutProbe = report
})(); return 'started' })()`

const resize = (width: number) =>
  `(() => {
    const { remote } = require('electron')
    app.setting.open()
    const w = remote.BrowserWindow.getAllWindows()
      .find((x) => x.getTitle().startsWith('Settings'))
    if (w) w.setSize(${width}, 800)
    return w ? w.getSize()[0] : 0
  })()`

async function runProbe(): Promise<Report> {
  evalRaw(PROBE, 120_000)

  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (evalJson<boolean>('window.__abeleLayoutProbe !== null', 60_000)) {
      return evalJson<Report>('window.__abeleLayoutProbe', 60_000)
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error('The layout probe did not finish in time')
}

const available = isObsidianRunning()

describe.skipIf(!available)('the settings pane', () => {
  const reports = new Map<number, Report>()

  const reportFor = (width: number): Report => {
    const report = reports.get(width)
    if (!report) throw new Error(`No report was gathered at ${width}px`)
    return report
  }

  beforeAll(async () => {
    for (const width of WIDTHS) {
      evalJson<number>(resize(width), 60_000)
      await new Promise((resolve) => setTimeout(resolve, 1000))
      reports.set(width, await runProbe())
    }
    console.info(`\n  vault ...................... ${activeVaultName()}\n`)
  }, 300_000)

  afterAll(() => {
    if (available) evalJson<number>(resize(900), 60_000)
  })

  for (const width of WIDTHS) {
    describe(`at ${width}px`, () => {
      it('puts nothing past the right edge of the pane it was given', () => {
        const report = reportFor(width)
        const offenders = Object.entries(report).filter(([, r]) => r.over.length)

        expect(Object.fromEntries(offenders)).toEqual({})
      })

      it('leaves nothing to scroll sideways', () => {
        const report = reportFor(width)
        const scrollers = Object.entries(report).filter(([, r]) => r.scroll !== 0)

        expect(Object.fromEntries(scrollers)).toEqual({})
      })

      it('actually reached every screen', () => {
        // Without this a probe that silently failed to open the editor would report nothing
        // wrong, which reads exactly like a pass.
        const report = reportFor(width)

        expect(Object.keys(report)).toContain('AI → Agents')
        expect(Object.keys(report).filter((k) => k.startsWith('agent editor'))).toHaveLength(5)
      })
    })
  }
})
