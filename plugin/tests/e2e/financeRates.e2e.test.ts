/**
 * Money in several currencies added up at a fixed table of exchange rates, in the running app:
 * one approximate balance first in the finance sidebar, a tab of every currency for the period,
 * the accounts pane ordered by what each balance is worth, a currency with no rate left out and
 * marked, old rates marked, and nothing approximate at all before there is a table.
 *
 * The table is put straight into the store the screens read, so nothing here touches the network;
 * the one the app holds is put back afterwards. A small ledger is written for the run, dated today,
 * and removed after it. On the phone the same checks run and the pictures come from the device.
 *
 * Requires Obsidian running with the plugin installed — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { evalLong, evalRaw, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')

const FOLDER = 'FinanceRatesProbe'
const SHOTS = shotDir(onPhone() ? 'abele-phone' : 'abele-finance-rates')

interface State {
  error: string
  /** The approximate balance card, as text, and whether it is the first card. */
  total: string | null
  totalFirst: boolean
  totalMissingRing: boolean
  totalStaleDot: boolean
  /** The period's currency tabs, in order. */
  tabs: string[]
  /** What the probe's ledger added to the approximate balance. */
  totalAdded: number | null
  /** What it added to the expenses on the tab of every currency. */
  allExpensesAdded: number | null
  /** The probe's wallets in the accounts pane, top to bottom. */
  order: string[]
}

const probe = (scene: 'rates' | 'stale' | 'none') => `(async () => {
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
  const scene = ${JSON.stringify(scene)}
  const ws = app.workspace
  const rates = window.__abeleTest.exchangeRates
  const state = { error: '', total: null, totalAdded: null, totalFirst: false, totalMissingRing: false, totalStaleDot: false, tabs: [], allExpensesAdded: null, order: [] }
  const kept = { table: rates.table, enabled: rates.enabled, display: rates.display }
  const leaves = []
  const shot = async (name) => {
    const path = ${JSON.stringify(SHOTS)} + '/2026-10-15-finance-rates-' + name + '.png'
    if (window.__e2eHost) return window.__e2eHost.shot(path)
    const image = await require('@electron/remote').getCurrentWindow().webContents.capturePage()
    require('fs').writeFileSync(path, image.resize({ width: innerWidth, height: innerHeight }).toPNG())
  }
  try {
    const d = new Date()
    const day = (back) => {
      const t = new Date(d.getTime() - back * 86400000)
      return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0')
    }
    const today = day(0)
    const note = (fm, body) => '---\\n' + Object.entries(fm).map(([k, v]) => k + ': ' + v).join('\\n') + '\\n---\\n' + (body || '') + '\\n'
    const files = {}
    const wallet = (code, balance) => {
      files['Accounts/Rates probe ' + code + '.md'] = note({ type: 'account', accountType: 'asset', currency: code, startingBalance: balance, startingBalanceDate: '2020-01-01' })
    }
    // Their own numbers put the made-up PTS first; in dollars it has no worth and goes last.
    wallet('EUR', 500)
    wallet('GEL', 3000)
    wallet('USD', 700)
    wallet('PTS', 99999)
    files['Accounts/Rates probe spending.md'] = note({ type: 'account', accountType: 'expense' })
    let n = 0
    const spend = (code, amount) => {
      n++
      files['Transactions/Rates probe ' + n + '.md'] = note(
        { type: 'transaction', date: today, from: '"[[Rates probe ' + code + ']]"', to: '"[[Rates probe spending]]"', amount, currency: code },
        'Spend'
      )
    }
    spend('EUR', 100)
    spend('GEL', 400)
    spend('USD', 30)
    spend('PTS', 4)
    // A fetch of the app's own may be under way; the fixed table goes in after it.
    await until(() => !rates.updating, 30000)
    const fetchedOn = scene === 'stale' ? day(9) : today
    rates.enabled = true
    rates.display = 'USD'
    rates.table = scene === 'none' ? null : {
      base: 'USD',
      fetchedAt: new Date(fetchedOn + 'T08:00:00').toISOString(),
      fetchedOn,
      rates: {
        EUR: { perUsd: 0.5, date: fetchedOn, source: 'Frankfurter' },
        GEL: { perUsd: 2, date: fetchedOn, source: 'Frankfurter' },
      },
    }

    const open = async (type) => {
      const leaf = ws.getRightLeaf(false)
      leaves.push(leaf)
      await leaf.setViewState({ type, active: true })
      if (!app.isMobile) ws.rightSplit.expand()
      await ws.revealLeaf(leaf)
      return leaf
    }

    const finance = await open('abele-finance-sidebar-view')
    const root = () => finance.view.containerEl.querySelector('.abele-finance-sidebar')
    await until(() => !!root(), 30000)
    await wait(1500)
    // The vault has money of its own: what is checked is what the probe's ledger adds to it.
    const number = (e) => (e ? Number(e.textContent.replace(/[^\\d.-]/g, '')) : 0)
    const totalNow = () => number(root().querySelector('.abele-finance-sidebar__card_total .abele-finance-sidebar__card-balance'))
    const allTab = () => [...root().querySelectorAll('.abele-finance-sidebar__currency-tabs .abele-tabs__tab')].find((t) => t.textContent.includes('≈'))
    const allExpensesNow = async () => {
      const tab = allTab()
      if (!tab) return null
      tab.click()
      await until(() => !!root().querySelector('.abele-finance-sidebar__summary_approx'), 5000)
      await wait(300)
      return number(root().querySelector('.abele-finance-sidebar__summary .abele-finance-sidebar__summary-value--expense'))
    }
    const totalBefore = totalNow()
    const expensesBefore = (await allExpensesNow()) ?? 0

    for (const dir of [FOLDER, FOLDER + '/Accounts', FOLDER + '/Transactions']) {
      if (!app.vault.getAbstractFileByPath(dir)) await app.vault.createFolder(dir)
    }
    for (const [path, body] of Object.entries(files)) await app.vault.create(FOLDER + '/' + path, body)
    const seeded = await until(() => {
      const gel = [...root().querySelectorAll('.abele-finance-sidebar__currency-tabs .abele-tabs__tab')].some((e) => e.textContent.trim() === 'GEL')
      return gel && (scene === 'none' || totalNow() !== totalBefore)
    }, 30000)
    if (!seeded) throw new Error('the sidebar never showed the seeded ledger')
    await wait(600)
    const el = root()
    el.scrollTop = 0
    const cards = [...el.querySelectorAll('.abele-finance-sidebar__card')]
    const total = el.querySelector('.abele-finance-sidebar__card_total')
    if (total) {
      state.total = total.querySelector('.abele-finance-sidebar__card-balance').textContent.replace(/\\s+/g, ' ').trim()
      state.totalAdded = Math.round((totalNow() - totalBefore) * 100) / 100
      state.totalFirst = cards[0] === total
      state.totalMissingRing = !!total.querySelector('.abele-approx-amount__missing')
      state.totalStaleDot = !!total.querySelector('.abele-approx-amount__stale')
    }
    state.tabs = [...el.querySelectorAll('.abele-finance-sidebar__currency-tabs .abele-tabs__tab')].map((t) => t.textContent.replace(/\\s+/g, ' ').trim())
    if (allTab()) {
      let after = null
      for (let i = 0; i < 30; i++) {
        after = await allExpensesNow()
        if (after !== expensesBefore) break
        await wait(300)
      }
      state.allExpensesAdded = after === null ? null : Math.round((after - expensesBefore) * 100) / 100
    }
    await shot(scene + '-sidebar')

    const accounts = await open('abele-accounts-sidebar-view')
    const pane = () => accounts.view.containerEl.querySelector('.abele-accounts-sidebar')
    await until(() => {
      const p = pane()
      return p && [...p.querySelectorAll('.abele-accounts-sidebar__name')].filter((e) => e.textContent.startsWith('Rates probe')).length === 4
    }, 30000)
    await wait(400)
    state.order = [...pane().querySelectorAll('.abele-accounts-sidebar__name')]
      .map((e) => e.textContent.trim())
      .filter((t) => t.startsWith('Rates probe'))
    await shot(scene + '-accounts')
  } catch (e) {
    state.error = String((e && e.message) || e)
  } finally {
    for (const leaf of leaves) leaf.detach()
    rates.table = kept.table
    rates.enabled = kept.enabled
    rates.display = kept.display
    const folder = app.vault.getAbstractFileByPath(FOLDER)
    if (folder) await app.vault.delete(folder, true)
  }
  return JSON.stringify(state)
})()`

const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)('money in several currencies, at a fixed table of rates', () => {
  const states: Partial<Record<'rates' | 'stale' | 'none', State>> = {}
  const run = async (scene: 'rates' | 'stale' | 'none') =>
    (states[scene] ??= JSON.parse(await evalLong(probe(scene), 120_000)) as State)

  beforeAll(async () => {
    // A run cut short by a crash can leave the ledger behind; it would double every sum.
    await evalLong(
      `(async () => { const f = app.vault.getAbstractFileByPath(${JSON.stringify(FOLDER)}); if (f) await app.vault.delete(f, true); return 'ok' })()`,
      30_000
    )
  })

  afterAll(() => {
    if (!available) return
    const left = evalRaw(`String(!!app.vault.getAbstractFileByPath(${JSON.stringify(FOLDER)}))`)
    expect(left).toContain('false')
  })

  it('shows everything held as one approximate balance, first, leaving out a currency with no rate', async () => {
    const s = await run('rates')
    expect(s.error).toBe('')
    // 400 EUR + 2600 GEL + 670 USD = 800 + 1300 + 670 USD; the PTS has no rate.
    expect(s.total).toMatch(/^≈.*USD$/)
    expect(s.totalAdded).toBe(2770)
    expect(s.totalFirst).toBe(true)
    expect(s.totalMissingRing).toBe(true)
    expect(s.totalStaleDot).toBe(false)
  })

  it('adds the period up in dollars on a tab before the currencies', async () => {
    const s = await run('rates')
    expect(s.tabs[0]).toBe('≈ USD')
    // 100 EUR + 400 GEL + 30 USD = 200 + 200 + 30 USD.
    expect(s.allExpensesAdded).toBe(430)
  })

  it('orders the accounts by what they are worth, one with no rate last', async () => {
    const s = await run('rates')
    expect(s.order).toEqual([
      'Rates probe GEL',
      'Rates probe EUR',
      'Rates probe USD',
      'Rates probe PTS',
    ])
  })

  it('marks rates older than four days', async () => {
    const s = await run('stale')
    expect(s.error).toBe('')
    expect(s.totalStaleDot).toBe(true)
  })

  it('shows nothing approximate and keeps the accounts by their own numbers without a table', async () => {
    const s = await run('none')
    expect(s.error).toBe('')
    expect(s.total).toBeNull()
    expect(s.tabs.some((t) => t.includes('≈'))).toBe(false)
    expect(s.order).toEqual([
      'Rates probe PTS',
      'Rates probe GEL',
      'Rates probe USD',
      'Rates probe EUR',
    ])
  })
})
