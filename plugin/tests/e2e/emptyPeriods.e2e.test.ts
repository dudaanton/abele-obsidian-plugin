/**
 * A month with nothing in it, in the running app: the finance and time tracking sidebars say so
 * in one muted line naming the month, with no zero rows, chart switcher or empty list under it.
 * And on a phone every row of the accounts pane is a finger's height, its words in the middle;
 * on a desktop the rows keep their own height.
 *
 * The sidebars are moved forward month by month until one is empty, so nothing is written to the
 * vault. On the phone the same checks run and the pictures come from the device.
 *
 * Requires Obsidian running with the plugin installed — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { evalLong, evalRaw, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { onPhone, targets, TARGET } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')

const FOLDER = 'EmptyPeriodsProbe'
const SHOTS = shotDir(onPhone() ? 'abele-phone' : 'abele-empty-periods')

interface Pane {
  error: string
  /** The one line saying the period is empty, or null. */
  empty: string | null
  /** What the period picker says, to compare with the line. */
  period: string
  /** Anything of a full period still drawn under it. */
  leftovers: string[]
}

interface State {
  finance: Pane
  time: Pane
  /** Heights of the accounts pane's rows, px, and how far the name sits off their middle. */
  rows: { heights: number[]; offCentre: number[]; error: string }
}

const probe = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (fn()) return true
      await wait(100)
    }
    return false
  }
  const ws = app.workspace
  const FOLDER = ${JSON.stringify(FOLDER)}
  const target = ${JSON.stringify(TARGET)}
  const leaves = []
  const shot = async (name) => {
    const path = ${JSON.stringify(SHOTS)} + '/2026-10-15-' + name + '.png'
    if (window.__e2eHost) return window.__e2eHost.shot(path)
    const image = await require('@electron/remote').getCurrentWindow().webContents.capturePage()
    require('fs').writeFileSync(path, image.resize({ width: innerWidth, height: innerHeight }).toPNG())
  }
  const open = async (type) => {
    const leaf = ws.getRightLeaf(false)
    leaves.push(leaf)
    await leaf.setViewState({ type, active: true })
    if (!app.isMobile) ws.rightSplit.expand()
    await ws.revealLeaf(leaf)
    return leaf
  }
  const visible = (e) => !!e && e.getClientRects().length > 0
  // Forward a month at a time until the pane says it is empty: the vault's own data is in the past.
  const emptyMonth = async (type, rootSel, emptySel, leftoverSels, picture) => {
    const pane = { error: '', empty: null, period: '', leftovers: [] }
    try {
      const leaf = await open(type)
      const root = () => leaf.view.containerEl.querySelector(rootSel)
      await until(() => !!root(), 30000)
      await wait(800)
      for (let i = 0; i < 60 && !root().querySelector(emptySel); i++) {
        const icons = root().querySelectorAll('.abele-period-selector > .abele-obsidian-icon')
        icons[icons.length - 1].click()
        await wait(150)
      }
      await wait(500)
      const line = root().querySelector(emptySel)
      pane.empty = line ? line.textContent.replace(/\\s+/g, ' ').trim() : null
      pane.period = (root().querySelector('.abele-period-selector__title')?.textContent || '').trim()
      for (const sel of leftoverSels) if ([...root().querySelectorAll(sel)].some(visible)) pane.leftovers.push(sel)
      root().scrollTop = 0
      await wait(200)
      await shot(picture + '-' + target)
    } catch (e) {
      pane.error = String((e && e.message) || e)
    }
    return pane
  }
  const state = { finance: null, time: null, rows: { heights: [], offCentre: [], error: '' } }
  try {
    state.finance = await emptyMonth(
      'abele-finance-sidebar-view',
      '.abele-finance-sidebar',
      '.abele-finance-sidebar__period-empty',
      ['.abele-finance-sidebar__summary-row', '.abele-finance-sidebar__chart-tabs', '.abele-finance-sidebar__pie-empty', '.abele-finance-sidebar__pie-chart', '.abele-finance-sidebar__calendar-chart', '.abele-finance-sidebar__networth-chart'],
      'finance-empty'
    )
    state.time = await emptyMonth(
      'abele-time-tracking-sidebar-view',
      '.abele-time-tracking-sidebar',
      '.abele-time-tracking-sidebar__period-empty',
      ['.abele-time-tracking-sidebar__summary', '.abele-tabs', '.abele-time-tracking-sidebar__section', '.abele-time-tracking-sidebar__chart', '.abele-empty-state:not(.abele-time-tracking-sidebar__period-empty)'],
      'time-empty'
    )
    try {
      // Rows of its own, so the check does not lean on what the vault holds; removed afterwards.
      if (!app.vault.getAbstractFileByPath(FOLDER)) await app.vault.createFolder(FOLDER)
      for (const [name, balance] of [['Wallet', 120], ['Savings', 5000], ['Card', -40], ['Cash', 15]]) {
        await app.vault.create(FOLDER + '/Empty probe ' + name + '.md', '---\\ntype: account\\naccountType: asset\\ncurrency: EUR\\nstartingBalance: ' + balance + '\\nstartingBalanceDate: 2020-01-01\\n---\\n')
      }
      const accounts = await open('abele-accounts-sidebar-view')
      const pane = () => accounts.view.containerEl.querySelector('.abele-accounts-sidebar')
      const probeRows = () => [...pane().querySelectorAll('.abele-accounts-sidebar__row')].filter((r) => r.textContent.includes('Empty probe'))
      await until(() => pane() && probeRows().length === 4 && probeRows().every((r) => r.getBoundingClientRect().height > 0), 30000)
      await wait(500)
      probeRows()[0].scrollIntoView({ block: 'center' })
      await wait(300)
      for (const row of probeRows()) {
        const box = row.getBoundingClientRect()
        const name = row.querySelector('.abele-accounts-sidebar__name').getBoundingClientRect()
        state.rows.heights.push(Math.round(box.height * 10) / 10)
        state.rows.offCentre.push(Math.round(Math.abs((name.top + name.bottom) / 2 - (box.top + box.bottom) / 2) * 10) / 10)
      }
      if (target === 'phone') await shot('accounts-phone')
    } catch (e) {
      state.rows.error = String((e && e.message) || e)
    }
  } finally {
    for (const leaf of leaves) leaf.detach()
    const folder = app.vault.getAbstractFileByPath(FOLDER)
    if (folder) await app.vault.delete(folder, true)
  }
  return JSON.stringify(state)
})()`

const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)('a month with nothing in it, and account rows a finger can hit', () => {
  let state: State | undefined
  const run = async () => (state ??= JSON.parse(await evalLong(probe, 180_000)) as State)

  beforeAll(async () => {
    // A run cut short by a crash can leave the probe accounts behind.
    await evalLong(
      `(async () => { const f = app.vault.getAbstractFileByPath(${JSON.stringify(FOLDER)}); if (f) await app.vault.delete(f, true); return 'ok' })()`,
      30_000
    )
  })

  afterAll(() => {
    if (!available) return
    expect(
      evalRaw(`String(!!app.vault.getAbstractFileByPath(${JSON.stringify(FOLDER)}))`)
    ).toContain('false')
  })

  it('finance: one muted line naming the month, nothing of a full month under it', async () => {
    const { finance } = await run()
    expect(finance.error).toBe('')
    expect(finance.empty).toBe(`Nothing in ${finance.period}`)
    expect(finance.empty).toMatch(/^Nothing in [A-Z][a-z]+ \d{4}$/)
    expect(finance.leftovers).toEqual([])
  })

  it('time tracking: one muted line naming the month, no total, tabs or Entries under it', async () => {
    const { time } = await run()
    expect(time.error).toBe('')
    expect(time.empty).toBe(`Nothing tracked in ${time.period}`)
    expect(time.leftovers).toEqual([])
  })

  it(
    onPhone()
      ? 'accounts: every row is at least 44px on the phone, its name in the middle'
      : 'accounts: rows keep their own height on the desktop',
    async () => {
      const { rows } = await run()
      expect(rows.error).toBe('')
      expect(rows.heights).toHaveLength(4)
      if (onPhone()) {
        expect(Math.min(...rows.heights)).toBeGreaterThanOrEqual(44)
        expect(Math.max(...rows.offCentre)).toBeLessThanOrEqual(1.5)
      } else {
        expect(Math.max(...rows.heights)).toBeLessThan(44)
      }
    }
  )
})
