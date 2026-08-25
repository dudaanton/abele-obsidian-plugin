/**
 * Nothing in the settings pane scrolls sideways, and nothing in it stands in empty space.
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
 * The second question is vertical and is asked of a phone. Obsidian stacks a settings row on
 * a phone — `.is-phone .modal .setting-item` is a column — which turns any horizontal flex
 * basis the plugin sets into a height. A 14em basis meant for side-by-side halves became a
 * 224px-tall label and a 224px-tall control, so every row was 496px of mostly nothing. The
 * check is therefore not "is the row short enough" but "does either half of it hold more
 * space than its own contents occupy", which is the shape of that bug and of its relatives.
 *
 * The phone is reached by putting Obsidian's own `is-phone` class on the settings document
 * rather than by emulating a device: those rules are keyed on exactly that class, and adding
 * it neither reloads the app nor leaves anything behind.
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
  /** Halves of a settings row that are taller than what they hold, with the surplus. */
  voids: string[]
}

type Report = Record<string, Overflow>

/**
 * A desktop settings window, one narrow enough that the content pane is phone-column wide, and
 * that same narrow window running Obsidian's phone rules.
 *
 * 620 rather than 360: Obsidian's own settings chrome does not adapt below roughly 600px in a
 * desktop window — its sidebar keeps its width and leaves the plugin under 100px, which no
 * layout survives and which no user ever sees. What matters here is the width of the pane the
 * plugin is given, and at 620 that is about 356px — a phone's column.
 */
const PASSES = [
  { label: '900px', width: 900, phone: false },
  { label: '620px', width: 620, phone: false },
  { label: '620px as a phone', width: 620, phone: true },
]

/**
 * The probe is asynchronous — it clicks through tabs and waits for each to render — and
 * `evalJson` cannot await a promise, so the result is parked on the window and polled for.
 */
const probeFor = (phone: boolean) =>
  `(() => { window.__abeleLayoutProbe = null; (async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  app.setting.open()
  app.setting.openTabById('abele')
  await wait(800)

  const d = app.setting.activeTab.containerEl.ownerDocument
  const view = d.defaultView
  const qa = (s) => [...d.querySelectorAll(s)]

  const phoneClasses = ['is-mobile', 'is-phone']
  if (${phone}) {
    d.body.classList.add(...phoneClasses)
    await wait(400)
  }

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

    // A settings row is two halves, each sized around the children it holds. A half taller
    // than the children it holds is holding empty space, which is what a broken row looks
    // like from the outside. Rows measured whole would not show it: theirs added up.
    const voids = []
    for (const row of [...root.querySelectorAll('.abele-obsidian-setting')]) {
      for (const half of ['.setting-item-info', '.setting-item-control']) {
        const el = row.querySelector(half)
        if (!el || !el.children.length) continue
        const rects = [...el.children]
          .map((c) => c.getBoundingClientRect())
          .filter((r) => r.height > 0)
        const height = el.getBoundingClientRect().height
        if (!height || !rects.length) continue
        const held = Math.max(...rects.map((r) => r.bottom)) - Math.min(...rects.map((r) => r.top))
        if (height - held > 4) {
          const name = (row.querySelector('.setting-item-name') || {}).textContent || '?'
          voids.push(name.trim().slice(0, 28) + ' ' + half + ' +' + Math.round(height - held))
        }
      }
    }

    return { over, scroll: root.scrollWidth - root.clientWidth, voids }
  }

  const report = {}
  try {
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
  } finally {
    // Whatever happened above, the settings document is handed back as it was found.
    d.body.classList.remove(...phoneClasses)
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

async function runProbe(phone: boolean): Promise<Report> {
  evalRaw(probeFor(phone), 120_000)

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
  const reports = new Map<string, Report>()

  const reportFor = (label: string): Report => {
    const report = reports.get(label)
    if (!report) throw new Error(`No report was gathered at ${label}`)
    return report
  }

  beforeAll(async () => {
    for (const pass of PASSES) {
      evalJson<number>(resize(pass.width), 60_000)
      await new Promise((resolve) => setTimeout(resolve, 1000))
      reports.set(pass.label, await runProbe(pass.phone))
    }
    console.info(`\n  vault ...................... ${activeVaultName()}\n`)
  }, 400_000)

  afterAll(() => {
    if (available) evalJson<number>(resize(900), 60_000)
  })

  for (const pass of PASSES) {
    describe(`at ${pass.label}`, () => {
      it('puts nothing past the right edge of the pane it was given', () => {
        const report = reportFor(pass.label)
        const offenders = Object.entries(report).filter(([, r]) => r.over.length)

        expect(Object.fromEntries(offenders)).toEqual({})
      })

      it('leaves nothing to scroll sideways', () => {
        const report = reportFor(pass.label)
        const scrollers = Object.entries(report).filter(([, r]) => r.scroll !== 0)

        expect(Object.fromEntries(scrollers)).toEqual({})
      })

      it('gives no half of a settings row more room than it fills', () => {
        const report = reportFor(pass.label)
        const offenders = Object.entries(report).filter(([, r]) => r.voids.length)

        expect(Object.fromEntries(offenders)).toEqual({})
      })

      it('actually reached every screen', () => {
        // Without this a probe that silently failed to open the editor would report nothing
        // wrong, which reads exactly like a pass.
        const report = reportFor(pass.label)

        expect(Object.keys(report)).toContain('AI → Agents')
        expect(Object.keys(report).filter((k) => k.startsWith('agent editor'))).toHaveLength(5)
      })
    })
  }
})
