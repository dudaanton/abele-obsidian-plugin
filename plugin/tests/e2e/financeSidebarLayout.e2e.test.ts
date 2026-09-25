/**
 * How the finance sidebar is spaced, measured in the running app at a sidebar's width.
 *
 * Filled with real data it showed a list of small faults nobody had seen on an empty vault:
 * the chart tabs stood flush against the lent and returned rows, the currency cards ran into
 * each other with less room between two currencies than inside one, a day's totals in the
 * transaction list ran past the right edge once a day had spending in three currencies, and
 * the debts under a balance had no dashed rule above them while the lent block below had one.
 *
 * A small ledger is written for the run in the vault's first pinned currency and two others,
 * all dated today so they land in the month the sidebar opens on, and removed after it.
 *
 * Requires Obsidian running with the plugin installed — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { isObsidianRunning, evalRaw } from './helpers/obsidianCli'

const FOLDER = 'FinanceLayoutProbe'
const WIDTH = 340

interface Box {
  top: number
  bottom: number
  left: number
  right: number
}

interface Rule {
  style: string
  color: string
  width: string
  paddingTop: number
  /** Pixels from the bottom of what stands above the rule to the rule itself. */
  above: number
}

interface Report {
  error: string
  cards: Box[]
  /** Pixels between one card's last row and the next card's balance. */
  cardGaps: number[]
  /** The dashed rule under each balance that has debts. */
  cardRules: Rule[]
  /** The dashed rule over the lent and returned rows. */
  lentRule: Rule | null
  /** Pixels between the last summary block and the chart tabs under it. */
  tabsGap: number
  /** Pixels between the cards and the period summary, and between that and the transactions. */
  blockGaps: number[]
  /** Whether the period summary's currency switcher is the kit's tab strip. */
  currencyTabsKit: boolean
  /** Date dividers whose contents reach past their own right edge, with by how much. */
  overflowingDividers: string[]
}

const evalAsync = <T>(script: string, timeoutMs: number): T => {
  const raw = evalRaw(script, timeoutMs)
  try {
    return JSON.parse(raw) as T
  } catch {
    throw new Error(`The probe answered with something other than JSON: ${raw.slice(0, 400)}`)
  }
}

const probeScript = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (fn()) return true
      await wait(100)
    }
    return false
  }
  const FOLDER = ${JSON.stringify(FOLDER)}
  const TYPE = 'abele-finance-sidebar-view'
  const ws = app.workspace
  const report = { error: '', cards: [], cardGaps: [], cardRules: [], lentRule: null, tabsGap: 0, blockGaps: [], currencyTabsKit: false, overflowingDividers: [] }
  const wasCollapsed = ws.rightSplit.collapsed
  const oldSize = ws.rightSplit.size
  let leaf = null
  try {
    const data = (await app.plugins.plugins.abele.loadData()) || {}
    const pinned = String(data.pinnedCurrencies || 'EUR').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean)
    const main = pinned[0]
    const others = ['EUR', 'GBP', 'CHF', 'USD'].filter((c) => c !== main).slice(0, 2)
    const d = new Date()
    const today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    const note = (fm, body) => '---\\n' + Object.entries(fm).map(([k, v]) => k + ': ' + v).join('\\n') + '\\n---\\n' + (body || '') + '\\n'
    const files = {}
    const account = (name, accountType, currency, balance) => {
      const fm = { type: 'account', accountType }
      if (currency) Object.assign(fm, { currency, startingBalance: balance, startingBalanceDate: '2020-01-01' })
      files['Accounts/' + name + '.md'] = note(fm)
    }
    account('Probe wallet ' + main, 'asset', main, 5000)
    account('Probe lent ' + main, 'liability', main, 300)
    account('Probe loan ' + main, 'liability', main, -800)
    for (const c of others) account('Probe wallet ' + c, 'asset', c, 90000)
    account('Probe spending', 'expense')
    account('Probe pay', 'revenue')
    let n = 0
    const tx = (from, to, amount, currency, title) => {
      n++
      files['Transactions/' + title + ' ' + n + '.md'] = note(
        { type: 'transaction', date: today, from: '"[[' + from + ']]"', to: '"[[' + to + ']]"', amount, currency },
        title
      )
    }
    tx('Probe pay', 'Probe wallet ' + main, 3200, main, 'Pay')
    tx('Probe wallet ' + main, 'Probe spending', 12345.67, main, 'Spend')
    for (const c of others) tx('Probe wallet ' + c, 'Probe spending', 54321.09, c, 'Spend')
    tx('Probe wallet ' + main, 'Probe lent ' + main, 150, main, 'Lend')
    tx('Probe lent ' + main, 'Probe wallet ' + main, 50, main, 'Return')

    for (const dir of [FOLDER, FOLDER + '/Accounts', FOLDER + '/Transactions']) {
      if (!app.vault.getAbstractFileByPath(dir)) await app.vault.createFolder(dir)
    }
    for (const [path, body] of Object.entries(files)) await app.vault.create(FOLDER + '/' + path, body)

    leaf = ws.getRightLeaf(false)
    await leaf.setViewState({ type: TYPE, active: true })
    ws.rightSplit.expand()
    await ws.revealLeaf(leaf)
    ws.rightSplit.setSize(${WIDTH})
    const root = () => leaf.view.containerEl.querySelector('.abele-finance-sidebar')
    const ready = await until(() => {
      const r = root()
      return r && r.querySelector('.abele-finance-sidebar__summary--debt') &&
        r.querySelector('.abele-finance-sidebar__card-details') && r.querySelector('.abele-date-divider')
    }, 30000)
    if (!ready) throw new Error('the sidebar never showed the seeded ledger')
    await wait(800)

    const el = root()
    el.scrollTop = 0
    const box = (e) => {
      const r = e.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }
    }
    const round = (n) => Math.round(n * 10) / 10
    const rule = (e) => {
      const cs = getComputedStyle(e)
      const prev = e.previousElementSibling
      return {
        style: cs.borderTopStyle,
        color: cs.borderTopColor,
        width: cs.borderTopWidth,
        paddingTop: parseFloat(cs.paddingTop),
        above: prev ? round(box(e).top - box(prev).bottom) : -1,
      }
    }

    const cards = [...el.querySelectorAll('.abele-finance-sidebar__card')]
    report.cards = cards.map(box)
    for (let i = 1; i < cards.length; i++) report.cardGaps.push(round(box(cards[i]).top - box(cards[i - 1]).bottom))
    report.cardRules = [...el.querySelectorAll('.abele-finance-sidebar__card-details')].map(rule)

    const lent = el.querySelector('.abele-finance-sidebar__summary--debt')
    report.lentRule = rule(lent)
    const tabs = [...el.querySelectorAll('.abele-finance-sidebar__section .abele-tabs')].pop()
    report.tabsGap = round(box(tabs).top - box(lent).bottom)

    const blocks = [el.querySelector('.abele-finance-sidebar__cards'), ...el.querySelectorAll('.abele-finance-sidebar__section')]
    for (let i = 1; i < blocks.length; i++) report.blockGaps.push(round(box(blocks[i]).top - box(blocks[i - 1]).bottom))
    report.currencyTabsKit = !!el.querySelector('.abele-finance-sidebar__currency-tabs.abele-tabs')

    for (const divider of el.querySelectorAll('.abele-date-divider')) {
      const edge = box(divider).right
      let reach = edge
      for (const e of divider.querySelectorAll('*')) reach = Math.max(reach, box(e).right)
      if (reach > edge + 0.5) report.overflowingDividers.push(divider.textContent.trim() + ' by ' + round(reach - edge) + 'px')
    }
  } catch (e) {
    report.error = String((e && e.message) || e)
  } finally {
    if (leaf) leaf.detach()
    ws.rightSplit.setSize(oldSize)
    if (wasCollapsed) ws.rightSplit.collapse()
    const folder = app.vault.getAbstractFileByPath(FOLDER)
    if (folder) await app.vault.delete(folder, true)
  }
  return JSON.stringify(report)
})()`

const available = isObsidianRunning()

describe.skipIf(!available)('the finance sidebar, filled, at a sidebar width', () => {
  let report: Report

  beforeAll(() => {
    report = evalAsync<Report>(probeScript, 120_000)
  })

  afterAll(() => {
    // The probe removes its own ledger; this only says so if it could not.
    if (!available) return
    const left = evalRaw(`String(!!app.vault.getAbstractFileByPath(${JSON.stringify(FOLDER)}))`)
    expect(left).toContain('false')
  })

  it('reaches the filled sidebar', () => {
    expect(report.error).toBe('')
    expect(report.cardRules.length).toBeGreaterThan(0)
  })

  it('draws the same dashed rule under a balance with debts as over the lent rows', () => {
    const lent = report.lentRule!
    expect(lent.style).toBe('dashed')
    for (const r of report.cardRules) {
      expect(r).toEqual({ ...lent, above: r.above })
      expect(r.above).toBeCloseTo(lent.above, 0)
    }
  })

  it('leaves more room between two currencies than inside one', () => {
    const inside = report.cardRules[0].above + report.cardRules[0].paddingTop
    for (const gap of report.cardGaps) expect(gap).toBeGreaterThan(inside)
  })

  it('keeps the chart tabs off the rows above them', () => {
    expect(report.tabsGap).toBeGreaterThan(0)
  })

  it('spaces the cards, the period summary and the transactions evenly', () => {
    expect(report.blockGaps.length).toBe(2)
    expect(report.blockGaps[0]).toBeCloseTo(report.blockGaps[1], 0)
  })

  it('switches the summary between currencies with the kit tab strip', () => {
    expect(report.currencyTabsKit).toBe(true)
  })

  it('keeps a day with spending in three currencies inside its row', () => {
    expect(report.overflowingDividers).toEqual([])
  })
})
