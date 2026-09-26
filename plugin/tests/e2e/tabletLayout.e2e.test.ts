/**
 * The settings screen and the sidebars, on a tablet.
 *
 * A tablet is mobile but not a phone, and Obsidian treats it as a third kind of device: its
 * settings dialog keeps the list of pages beside the page, as on a desktop, and has no back
 * button. The plugin's settings once treated every mobile device as a phone — on an iPad the
 * tab strip became a list, and after one pick there was no way back to it.
 *
 * The tablet is reached the way Obsidian itself decides it: `app.emulateMobile(true)` and a
 * window at least 600×600, which is the media query the app toggles `is-tablet` and
 * `Platform.isTablet` on. That is Obsidian's own tablet code path, in Chromium rather than the
 * iPad's WebKit, with a mouse rather than a finger and no safe-area insets.
 *
 * A picture of each screen goes to `/tmp/abele-tablet/`. Requires Obsidian running on a vault
 * with the development build — see docs/Testing.md.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { evalJson, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'

/** An iPad in landscape, in points. */
const TABLET = { width: 1180, height: 820 }
const PHONE = { width: 390, height: 844 }
const SHOTS = '/tmp/abele-tablet'

interface Report {
  tablet: boolean
  phone: boolean
  /** How many tabs the strip shows, and how many of them are actually on screen. */
  tabs: number
  tabsOnScreen: number
  vertical: boolean
  pageShown: boolean
  /** The same, after a tab was picked. */
  tabsAfterPick: number
  /** The label of the tab the strip marks active after the third one was picked. */
  activeAfterPick: string
  pageAfterPick: boolean
  /** A closed-then-opened left drawer's width as a share of the window, before and after. */
  drawerBefore: number
  drawerAfter: number
  pinned: boolean
  shots: string[]
  error: string
}

/**
 * What the probe needs in both modes: a picture, and the plugin's settings opened on a page.
 * A literal rather than a function because it is spliced into the scripts sent to the app.
 */
const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const fs = require('fs')
  const win = require('@electron/remote').getCurrentWindow()
  fs.mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
  const shots = []
  const shoot = async (label) => {
    await wait(400)
    let img
    try { img = await win.webContents.capturePage() } catch (e) {
      await wait(300); img = await win.webContents.capturePage()
    }
    const path = ${JSON.stringify(SHOTS)} + '/' + label + '.png'
    fs.writeFileSync(path, img.toPNG())
    shots.push(path)
  }
  const openAbele = async () => {
    app.setting.open()
    app.setting.openTabById('abele')
    await wait(800)
    return app.setting.activeTab.containerEl
  }
`

/** The same app in a phone-sized window, where the settings must stay a list to descend into. */
const phoneProbe = `(async () => {${PRELUDE}
  const root = await openAbele()
  const report = {
    phone: document.body.classList.contains('is-phone'),
    list: !!root.querySelector('.abele-tabs_vertical') &&
      !root.querySelector('.abele-settings__content')?.children.length,
  }
  await shoot('settings-phone')
  app.setting.close()
  await wait(400)
  return JSON.stringify(report)
})()`

const probeScript = `(async () => {${PRELUDE}
  const report = { tablet: document.body.classList.contains('is-tablet'),
    phone: document.body.classList.contains('is-phone'), shots, error: '' }
  const onScreen = (el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= window.innerWidth + 1 &&
      r.top >= 0 && r.bottom <= window.innerHeight + 1
  }
  const drawerShare = async () => {
    app.workspace.leftSplit.expand()
    await wait(700)
    const d = document.querySelector('.workspace-drawer.mod-left')
    report.pinned = !!(d && d.classList.contains('is-pinned'))
    const share = d ? d.getBoundingClientRect().width / window.innerWidth : -1
    return Math.round(share * 100) / 100
  }
  const toggleHalfWidth = async () => {
    const root = await openAbele()
    const other = [...root.querySelectorAll('.abele-tabs__tab')].find((t) => t.textContent.trim() === 'Other')
    other.click()
    await wait(400)
    const row = [...root.querySelectorAll('.setting-item')].find((r) =>
      (r.querySelector('.setting-item-name') || {}).textContent === 'Half-width sidebars on tablet')
    if (!row) throw new Error('no half-width row')
    row.querySelector('.checkbox-container').click()
    await wait(300)
    app.setting.close()
    await wait(400)
  }
  try {
    const root = await openAbele()
    const tabs = [...root.querySelectorAll('.abele-settings__nav .abele-tabs__tab')]
    report.tabs = tabs.length
    report.tabsOnScreen = tabs.filter(onScreen).length
    report.vertical = !!root.querySelector('.abele-tabs_vertical')
    report.pageShown = !!root.querySelector('.abele-settings__content')?.children.length
    await shoot('settings')

    tabs[2]?.click()
    await wait(500)
    report.tabsAfterPick = [...root.querySelectorAll('.abele-settings__nav .abele-tabs__tab')].filter(onScreen).length
    report.pageAfterPick = !!root.querySelector('.abele-settings__content')?.children.length
    report.activeAfterPick = (root.querySelector('.abele-tabs__tab_active') || {}).textContent?.trim() || ''
    await shoot('settings-after-pick')
    app.setting.close()
    await wait(400)

    report.drawerBefore = await drawerShare()
    await shoot('drawer-default')
    app.workspace.leftSplit.collapse()
    await wait(500)

    await toggleHalfWidth()
    report.drawerAfter = await drawerShare()
    await shoot('drawer-half')
    app.workspace.leftSplit.collapse()
    await wait(500)
    await toggleHalfWidth()
  } catch (e) {
    report.error = String((e && e.message) || e)
  }
  return JSON.stringify(report)
})()`

const setMobile = async (on: boolean): Promise<void> => {
  await reloadApp(`app.emulateMobile(${on})`)
}

const windowSize = (): [number, number] =>
  evalJson<[number, number]>(
    `require('@electron/remote').getCurrentWindow().getContentSize()`,
    30_000
  )

const setWindowSize = async (width: number, height: number): Promise<void> => {
  evalRaw(
    `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${width}, ${height}); return 'ok' })()`,
    30_000
  )
  await new Promise((resolve) => setTimeout(resolve, 1500))
}

/**
 * A window behind others is not repainted, and its page keeps the viewport it had until it is
 * reloaded — so a resize is followed by a reload before anything is measured.
 */
const reload = async (): Promise<void> => {
  await reloadApp()
}

/**
 * One per page in `Settings.vue`, counted from its list rather than written down here: a fixed
 * number went stale the day Books added a twelfth page, and failed a layout that was fine.
 */
const SETTINGS_TABS = (
  readFileSync(path.join(__dirname, '../../src/components/settings/Settings.vue'), 'utf8').match(
    /^\s*\{ id: '[^']+', label: '[^']+', component:/gm
  ) ?? []
).length

const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)('settings and sidebars on a tablet', () => {
  let report = {} as Report
  let phone = { phone: false, list: false }
  let size: [number, number] = [0, 0]

  beforeAll(async () => {
    size = windowSize()
    await setWindowSize(TABLET.width, TABLET.height)
    await setMobile(true)
    report = JSON.parse(evalRaw(probeScript, 120_000)) as Report
    await setWindowSize(PHONE.width, PHONE.height)
    await reload()
    phone = JSON.parse(evalRaw(phoneProbe, 60_000)) as typeof phone
    console.info(
      `\n  tablet report: ${JSON.stringify(report)}\n  phone: ${JSON.stringify(phone)}\n`
    )
  }, 300_000)

  afterAll(async () => {
    if (!available) return
    if (size[0]) await setWindowSize(size[0], size[1])
    await setMobile(false)
  }, 120_000)

  it('runs in Obsidian’s tablet layout, not its phone one', () => {
    expect(report.error).toBe('')
    expect(report.tablet).toBe(true)
    expect(report.phone).toBe(false)
  })

  it('shows every settings tab as a strip beside the page, as the desktop does', () => {
    expect(report.vertical).toBe(false)
    expect(report.tabs).toBe(SETTINGS_TABS)
    expect(report.tabsOnScreen).toBe(SETTINGS_TABS)
    expect(report.pageShown).toBe(true)
  })

  it('keeps the strip after a tab is picked', () => {
    expect(report.tabsAfterPick).toBe(SETTINGS_TABS)
    expect(report.activeAfterPick).toBe('Journals')
    expect(report.pageAfterPick).toBe(true)
  })

  it('opens the sidebar across half the screen once the setting is on', () => {
    expect(report.pinned).toBe(false)
    expect(report.drawerBefore).toBeLessThan(0.45)
    expect(report.drawerAfter).toBeGreaterThanOrEqual(0.49)
    expect(report.drawerAfter).toBeLessThanOrEqual(0.51)
  })

  it('still gives a phone its list of pages to descend into', () => {
    expect(phone.phone).toBe(true)
    expect(phone.list).toBe(true)
  })
})
