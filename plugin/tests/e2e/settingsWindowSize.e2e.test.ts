/**
 * How big Obsidian's settings open on a desktop, in both of the ways Obsidian draws them.
 *
 * In its own window (Obsidian's default since it learned to): Obsidian asks for 900×700 on any
 * screen, and the plugin asks for up to 1280×1000 instead — never more than the screen it opens
 * on, and moved back onto that screen when centring it over a small main window near an edge
 * would push it past one. In a dialog inside the main window (the "open settings in a separate
 * window" option off): Obsidian caps the dialog at 1100px wide and 85% high, and the plugin's
 * stylesheet lets it take up to 1280 × 88%.
 *
 * Neither touches a phone or a tablet, where Obsidian draws its settings as a full-screen sheet:
 * the dialog's size variables there are still Obsidian's own, read off its container.
 *
 * The main window is resized to 1440×900 and 1024×700 for this and put back afterwards, the
 * Obsidian option is put back as it was found. Pictures of each go to the shots directory.
 *
 * Requires Obsidian running with the plugin installed — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { isObsidianRunning, evalLong } from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'
import { WAIT_PRELUDE } from './helpers/wait'

targets('desktop')

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

interface InApp {
  modal: [number, number]
  view: [number, number]
}

interface Popout {
  window: Rect
  workArea: Rect
}

interface Report {
  inApp: Record<string, InApp>
  popout: Record<string, Popout>
  /** Obsidian's size variables on the dialog and on its container, under each class. */
  mobile: Record<string, { modal: string; container: string }>
  /** The Abele tab drew in each pass, and no row of it ran past the pane. */
  drawn: Record<string, boolean>
}

const SIZES: [number, number][] = [
  [1440, 900],
  [1024, 700],
]

const probe = `(async () => {
  ${WAIT_PRELUDE}
  const { remote } = require('electron')
  const fs = require('fs')
  const dir = ${JSON.stringify(shotDir('abele-settings-size'))}
  const main = remote.getCurrentWindow()
  const bounds = main.getBounds()
  const was = app.vault.getConfig('settingsPopoutWindow')
  const frames = () => new Promise((r) => {
    const t = setTimeout(r, 250)
    requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(t); r() }))
  })
  const settingsWindow = () => remote.BrowserWindow.getAllWindows()
    .find((w) => w.getTitle().startsWith('Settings - ' + app.vault.getName() + ' - '))
  const openAbele = async () => {
    app.setting.open()
    app.setting.openTabById('abele')
    const drawn = await until(() => app.setting.activeTab?.id === 'abele' &&
      app.setting.activeTab.containerEl.querySelector('.abele-settings__nav .abele-tabs__tab'), 10000)
    if (!drawn) throw new Error('The Abele settings tab never drew')
    await wait(400)
    const pane = app.setting.activeTab.containerEl
    const edge = pane.getBoundingClientRect().right + 1
    return ![...pane.querySelectorAll('.setting-item')].some((el) => el.getBoundingClientRect().right > edge)
  }
  const closeSettings = async () => {
    app.setting.close()
    await until(() => !settingsWindow() && !app.setting.modalEl.isConnected, 5000)
  }
  const place = async (rect) => {
    main.setBounds(rect)
    await until(() => window.innerWidth === rect.width && window.innerHeight === rect.height, 5000)
    await frames()
  }

  const report = { inApp: {}, popout: {}, mobile: {}, drawn: {} }
  try {
    await closeSettings()
    app.vault.setConfig('settingsPopoutWindow', false)
    for (const [width, height] of ${JSON.stringify(SIZES)}) {
      const label = width + 'x' + height
      await place({ x: bounds.x, y: bounds.y, width, height })
      report.drawn['in-app ' + label] = await openAbele()
      const r = app.setting.modalEl.getBoundingClientRect()
      report.inApp[label] = { modal: [r.width, r.height], view: [innerWidth, innerHeight] }
      fs.writeFileSync(dir + '/in-app-' + label + '.png', (await main.webContents.capturePage()).toPNG())
      if (width === 1440) {
        const vars = ['--modal-width', '--modal-height', '--modal-max-width', '--modal-max-height']
        const read = (el) => vars.map((v) => getComputedStyle(el).getPropertyValue(v).trim()).join(' ')
        for (const classes of [['is-mobile', 'is-phone'], ['is-mobile', 'is-tablet']]) {
          document.body.classList.add(...classes)
          try {
            report.mobile[classes.join(' ')] = {
              modal: read(app.setting.modalEl),
              container: read(app.setting.modalEl.parentElement),
            }
          } finally {
            document.body.classList.remove(...classes)
          }
        }
      }
      await closeSettings()
    }

    app.vault.setConfig('settingsPopoutWindow', true)
    const work = remote.screen.getDisplayMatching(bounds).workArea
    for (const [width, height] of ${JSON.stringify(SIZES)}) {
      const label = width + 'x' + height
      // The small window sits in the screen's bottom-right corner, where a settings window
      // centred over it would hang past two edges.
      const at = width === 1440
        ? { x: work.x + 40, y: work.y + 20, width, height }
        : { x: work.x + work.width - width, y: work.y + work.height - height, width, height }
      await place(at)
      report.drawn['window ' + label] = await openAbele()
      const w = await until(settingsWindow, 5000)
      if (!w) throw new Error('No settings window opened')
      report.popout[label] = {
        window: w.getBounds(),
        workArea: remote.screen.getDisplayMatching(w.getBounds()).workArea,
      }
      fs.writeFileSync(dir + '/window-from-' + label + '.png', (await w.webContents.capturePage()).toPNG())
      await closeSettings()
    }
  } finally {
    await closeSettings()
    app.vault.setConfig('settingsPopoutWindow', was)
    main.setBounds(bounds)
  }
  return JSON.stringify(report)
})()`

const available = isObsidianRunning()

describe.skipIf(!available)("Obsidian's settings on a desktop", () => {
  let report: Report

  beforeAll(async () => {
    report = JSON.parse(await evalLong(probe, 120_000)) as Report
  }, 150_000)

  describe('in their own window', () => {
    for (const [width, height] of SIZES) {
      const label = `${width}x${height}`

      it(`opens up to 1280×1000 and as much of the screen as allows, from a ${label} main window`, () => {
        const { window: w, workArea: a } = report.popout[label]
        const expected = [
          Math.min(a.width, Math.max(900, Math.min(1280, Math.floor(a.width * 0.9)))),
          Math.min(a.height, Math.max(700, Math.min(1000, Math.floor(a.height * 0.88)))),
        ]

        expect([w.width, w.height]).toEqual(expected)
      })

      it(`stays on the screen, from a ${label} main window`, () => {
        const { window: w, workArea: a } = report.popout[label]

        expect(w.x).toBeGreaterThanOrEqual(a.x)
        expect(w.y).toBeGreaterThanOrEqual(a.y)
        expect(w.x + w.width).toBeLessThanOrEqual(a.x + a.width)
        expect(w.y + w.height).toBeLessThanOrEqual(a.y + a.height)
      })
    }
  })

  describe('in a dialog in the main window', () => {
    for (const [width, height] of SIZES) {
      const label = `${width}x${height}`

      it(`takes up to 1280px and 88% of a ${label} window`, () => {
        const { modal, view } = report.inApp[label]

        expect(modal[0]).toBeCloseTo(Math.min(1280, view[0] * 0.9), 0)
        expect(modal[1]).toBeCloseTo(Math.min(1000, view[1] * 0.88), 0)
      })
    }
  })

  it('leaves the dialog Obsidian draws on a phone and a tablet as it is', () => {
    expect(Object.keys(report.mobile)).toHaveLength(2)
    for (const { modal, container } of Object.values(report.mobile)) expect(modal).toBe(container)
  })

  it('draws the Abele tab with nothing past its pane every time', () => {
    expect(report.drawn).toEqual({
      'in-app 1440x900': true,
      'in-app 1024x700': true,
      'window 1440x900': true,
      'window 1024x700': true,
    })
  })
})
