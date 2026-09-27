/**
 * The analytics tools in the running app, against the fixture vault's finance notes and against
 * notes and a base made here.
 *
 * - Monthly spending from `analyze_data` equals, to the cent, a sum this test makes itself by
 *   reading the transaction files from disk and adding their amounts in whole cents.
 * - A balance from the analytics equals the one the app's own `BalanceIndex` shows.
 * - A base is read through Obsidian's own Bases engine: its filter, formula, sort and limit come
 *   through, and nothing is left behind in the page.
 * - The chart view of a base still draws a chart: the probe borrows its id only inside its host.
 *
 * Everything made is removed afterwards: the fixture vault holds `ScaleTest/` and nothing else.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { JSON_SCHEMA, load as loadYaml } from 'js-yaml'
import { hasTestApi, isObsidianRunning, evalRaw } from './helpers/obsidianCli'

const FOLDER = 'AnalyticsE2E'
const available = isObsidianRunning() && hasTestApi()
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const evalAsync = <T>(script: string, timeoutMs = 60_000): T =>
  JSON.parse(evalRaw(script, timeoutMs)) as T

/** Ten days of health notes: weight falling by 0.2 a day, sleep going the other way. */
const DAYS = Array.from({ length: 10 }, (_, i) => {
  const date = `2026-08-${String(i + 1).padStart(2, '0')}`
  const weight = Math.round((80 - 0.2 * i) * 10) / 10
  const sleep = `${6 + (i % 4)},5`
  return { date, weight, sleep, steps: 5000 + 1000 * i }
})

const BASE = `filters:
  and:
    - file.inFolder("${FOLDER}/Days")
formulas:
  heavy: weight > 79
views:
  - type: table
    name: Recent
    order:
      - file.name
      - weight
      - sleep
      - steps
      - formula.heavy
    sort:
      - property: file.name
        direction: DESC
    limit: 5
  - type: table
    name: All
`

const CHART_BASE = `filters:
  and:
    - file.inFolder("${FOLDER}/Days")
views:
  - type: abele-chart
    name: Chart
    order:
      - weight
`

describe.skipIf(!available)('analytics in the app', () => {
  let vaultDir = ''

  beforeAll(async () => {
    vaultDir = evalAsync<string>(`JSON.stringify(app.vault.adapter.basePath)`)
    evalAsync<string>(`(async () => {
      await app.vault.adapter.mkdir(${JSON.stringify(`${FOLDER}/Days`)})
      for (const d of ${JSON.stringify(DAYS)}) {
        await app.vault.create(${JSON.stringify(`${FOLDER}/Days/`)} + d.date + '.md',
          '---\\ntype: e2e-day\\nweight: ' + d.weight + '\\nsleep: "' + d.sleep + '"\\nsteps: ' + d.steps + '\\n---\\n\\nday\\n')
      }
      await app.vault.create(${JSON.stringify(`${FOLDER}/Health.base`)}, ${JSON.stringify(BASE)})
      await app.vault.create(${JSON.stringify(`${FOLDER}/Chart.base`)}, ${JSON.stringify(CHART_BASE)})
      return JSON.stringify('ok')
    })()`)
    // The metadata cache has to have read the notes before a base can filter on them.
    await pause(2000)
  }, 120_000)

  afterAll(() => {
    try {
      evalRaw(
        `(async () => {
          for (const leaf of app.workspace.getLeavesOfType('bases')) {
            if (leaf.view.file?.path?.startsWith(${JSON.stringify(FOLDER + '/')})) leaf.detach()
          }
          const folder = app.vault.getAbstractFileByPath(${JSON.stringify(FOLDER)})
          if (folder) await app.vault.delete(folder, true)
          return 'removed'
        })()`,
        60_000
      )
    } catch (e) {
      console.warn('[abele e2e] analytics fixture not removed', e)
    }
  })

  it('adds up a year of spending per month exactly as the files say', () => {
    // Independently: every transaction file on disk, amounts in whole cents, spending being
    // whatever goes to an expense account.
    const root = join(vaultDir, 'ScaleTest/Finance')
    const frontmatter = (path: string) => {
      const m = /^---\n([\s\S]*?)\n---/.exec(readFileSync(path, 'utf8'))
      // Dates stay text, as they are written: the default schema would make them Date objects.
      return (m ? loadYaml(m[1], { schema: JSON_SCHEMA }) : {}) as Record<string, unknown>
    }
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = join(dir, n)
        return statSync(p).isDirectory() ? walk(p) : p.endsWith('.md') ? [p] : []
      })
    const files = walk(join(root, 'Transactions')).map((p) => frontmatter(p))
    // Which note a link means is Obsidian's call, and the fixture has one trap in it: a note
    // `Books` outside the finance folder, which `[[Books]]` opens instead of the account. So
    // the link targets are asked of the app; whether the target is an expense account is read
    // from its file here.
    const names = [...new Set(files.map((fm) => String(fm.to ?? '').replace(/^\[\[|\]\]$/g, '')))]
    const targets = evalAsync<Record<string, string | null>>(
      `JSON.stringify(Object.fromEntries(${JSON.stringify(names)}.map((n) => [n,
        app.metadataCache.getFirstLinkpathDest(n, 'ScaleTest/Finance/Transactions/x.md')?.path ?? null])))`
    )
    const expense = new Set(
      names.filter((n) => {
        const target = targets[n]
        return !!target && frontmatter(join(vaultDir, target)).accountType === 'expense'
      })
    )
    expect(expense.size).toBeGreaterThan(5)
    expect(expense.has('Books')).toBe(false)
    const cents = new Map<string, number>() // "EUR 2025-03" → cents
    for (const fm of files) {
      const date = String(fm.date ?? '')
      if (!date.startsWith('2025')) continue
      const to = String(fm.to ?? '').replace(/^\[\[|\]\]$/g, '')
      if (!expense.has(to)) continue
      const key = `${String(fm.currency)} ${date.slice(0, 7)}`
      cents.set(key, (cents.get(key) ?? 0) + Math.round(Number(fm.amount) * 100))
    }
    expect(cents.size).toBeGreaterThan(12)

    const answer = evalAsync<{
      results: Record<string, { series: { period: string; value: number }[] }>
      warnings: string[]
    }>(`(async () => JSON.stringify(await window.__abeleTest.analytics.analyzeSource({
      source: { kind: 'finance', only: 'expense', from: '2025-01-01', to: '2025-12-31' },
      period: 'month', analyses: ['series'],
    }, { skipScope: true })))()`)
    expect(answer.warnings[0]).toMatch(/currencies/)
    let compared = 0
    for (const [currency, r] of Object.entries(answer.results)) {
      for (const p of r.series) {
        expect(Math.round(p.value * 100)).toBe(cents.get(`${currency} ${p.period}`) ?? 0)
        compared++
      }
    }
    expect(compared).toBe(36) // three currencies, twelve months
  })

  it('agrees exactly with the balance the app shows', () => {
    const r = evalAsync<{ ours: number; app: number }>(`(async () => {
      const t = window.__abeleTest
      t.GlobalStore.getInstance().initFinance()
      await new Promise((r) => setTimeout(r, 1500))
      // The index itself, not the store's reactive view of it, in which its refs read as numbers.
      const bi = t.GlobalStore.getInstance().balanceIndex.value.__v_raw
      bi.rebuild()
      const table = await t.analytics.readTable({ kind: 'finance', measure: 'balance',
        accounts: ['ScaleTest/Finance/Accounts/Cash EUR.md'], to: '2026-06-30' }, { skipScope: true })
      const ours = table.rows[table.rows.length - 1].balance
      const app = bi.getBalanceAtDate('ScaleTest/Finance/Accounts/Cash EUR.md', window.moment('2026-06-30'))
      return JSON.stringify({ ours, app })
    })()`)
    expect(r.ours).toBe(r.app)
  })

  it('reads a base through Obsidian, with its filter, formula, sort and limit', () => {
    const r = evalAsync<{
      profile: {
        rows: number
        columns: { name: string; type: string }[]
        sample: Record<string, unknown>[]
      }
      mean: number
      probes: number
    }>(`(async () => {
      const a = window.__abeleTest.analytics
      const src = { kind: 'base', path: ${JSON.stringify(`${FOLDER}/Health.base`)} }
      const profile = await a.profileSource(src, { skipScope: true, limit: 5 })
      const answer = await a.analyzeSource({ source: src, value: 'weight' }, { skipScope: true })
      return JSON.stringify({ profile, mean: answer.describe.mean,
        probes: document.querySelectorAll('.abele-data-probe').length })
    })()`)
    expect(r.profile.rows).toBe(5)
    const types = Object.fromEntries(r.profile.columns.map((c) => [c.name, c.type]))
    expect(types).toMatchObject({
      weight: 'number',
      sleep: 'number',
      steps: 'number',
      'formula.heavy': 'boolean',
    })
    // Sorted newest first and cut at five: the 10th to the 6th.
    expect(r.profile.sample.map((s) => s['file.name'])).toEqual([
      '2026-08-10',
      '2026-08-09',
      '2026-08-08',
      '2026-08-07',
      '2026-08-06',
    ])
    // weights 78.2, 78.4, 78.6, 78.8, 79.0
    expect(r.mean).toBeCloseTo(78.6, 9)
    expect(r.profile.sample[0]['formula.heavy']).toBe(false)
    expect(r.probes).toBe(0)
  })

  it('names the views of a base when asked for one it does not have', () => {
    const r = evalAsync<string>(`(async () => {
      try {
        await window.__abeleTest.analytics.readTable({ kind: 'base', path: ${JSON.stringify(`${FOLDER}/Health.base`)}, view: 'Nope' }, { skipScope: true })
        return JSON.stringify('no error')
      } catch (e) { return JSON.stringify(e.message) }
    })()`)
    expect(r).toMatch(/no view named "Nope".*Recent, All/)
  })

  it('answers an agent through the tool, correlating two properties of daily notes', () => {
    const r = evalAsync<{
      correlate: { r: number; n: number }
      trend: { slopePerPeriod: number }
    }>(`(async () => {
      const t = window.__abeleTest
      const scope = t.ScopeResolver.getInstance()
      const was = scope.fullVaultAccess.value
      scope.fullVaultAccess.value = true
      try {
        const tool = t.createAgentTools().find((x) => x.name === 'analyze_data')
        const res = await tool.execute('e2e', {
          source: { kind: 'notes', folder: ${JSON.stringify(`${FOLDER}/Days`)} },
          value: 'weight', period: 'day',
          analyses: ['trend', { type: 'correlate', with: { value: 'steps' } }],
        })
        return res.content[0].text
      } finally { scope.fullVaultAccess.value = was }
    })()`)
    expect(r.trend.slopePerPeriod).toBeCloseTo(-0.2, 9)
    // weight falls exactly as steps rise
    expect(r.correlate).toMatchObject({ n: 10, r: -1 })
  })

  it('still draws the chart view of a base', async () => {
    const r = evalAsync<{ canvas: boolean }>(`(async () => {
      const f = app.vault.getAbstractFileByPath(${JSON.stringify(`${FOLDER}/Chart.base`)})
      const leaf = app.workspace.getLeaf('tab')
      await leaf.openFile(f)
      const deadline = Date.now() + 8000
      let canvas = false
      while (Date.now() < deadline && !canvas) {
        await new Promise((r) => setTimeout(r, 200))
        canvas = !!leaf.view.containerEl.querySelector('canvas')
      }
      leaf.detach()
      return JSON.stringify({ canvas })
    })()`)
    expect(r.canvas).toBe(true)
  })
})
