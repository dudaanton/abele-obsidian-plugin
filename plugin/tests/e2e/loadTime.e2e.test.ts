/**
 * How long Abele takes to load, held to a committed baseline.
 *
 * The plugin is switched off and on again inside the running app — Obsidian's own
 * `disablePlugin` / `enablePlugin`, which re-reads `main.js` from disk and evaluates it afresh —
 * several times, and the median of each phase is compared with `loadTime.baseline.json`. The
 * phases come from performance marks the plugin leaves as it starts (`src/helpers/loadMarks.ts`):
 *
 * - read + compile — from the call until the first statement of `main.js` runs
 * - modules — every bundled module running its top-level code
 * - onload — the plugin's `onload()`, settings read and layout-ready callbacks included
 *   (on a reload the layout is already there, so they run inside it)
 * - layout — the work the plugin puts off until the workspace is there, first layout-ready
 *   callback to last; part of onload on a reload, its own phase on an app start
 * - enable — the whole call, which is what Obsidian waits for before it moves on; the plugin's
 *   open views are mounted again inside it
 * - first frame — until the app paints again after it
 * - settled — until the main thread has been free of 50 ms stalls for half a second, which is
 *   where the work `onload` only started (chat tabs, chat history) has finished
 *
 * What is open decides most of it. Registering the editor extensions redraws every open note,
 * footer included, and every open Abele view is mounted again: with one note of the fixture and
 * two sidebars open a reload took a second, with nothing open a tenth of that. So the workspace
 * is set before measuring, in two fixed states, each with a baseline of its own, and put back
 * afterwards:
 *
 * - `bare` — no note, no Abele view: the plugin's own cost
 * - `workspace` — one note of the fixture in the main area, the agent chat in the right sidebar
 *   and the timeline in the left: what a person who uses the plugin reloads into
 *
 * `ABELE_LOAD_COLD=1` also restarts the app window a few times (`Page.reload`, ~15 s each) and
 * records the same marks as they fall during a real start, in milliseconds from the window
 * opening. Those are reported, not compared: an app start also indexes the vault and loads
 * every other plugin, and that noise would make a gate on them fail for nothing.
 *
 * Numbers go to `/tmp/abele-load-time.json`. The baseline is kept per build — a development
 * build carries the test hook and an inline source map Obsidian strips before evaluating, so
 * its numbers are not the shipped ones. `ABELE_LOAD_BASELINE=update` rewrites the baseline for
 * the build installed in the vault instead of comparing against it.
 *
 * Requires Obsidian running with the plugin installed — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  isObsidianRunning,
  evalJson,
  evalRaw,
  activeVaultName,
  runCli,
  waitForLinkIndex,
} from './helpers/obsidianCli'
import { LOAD_MARKS } from '@/helpers/loadMarks'

const RUNS = Number(process.env.ABELE_LOAD_RUNS ?? 7)
const BASELINE_FILE = path.join(__dirname, 'loadTime.baseline.json')
const UPDATE = process.env.ABELE_LOAD_BASELINE === 'update'
const COLD_RUNS = process.env.ABELE_LOAD_COLD ? Number(process.env.ABELE_LOAD_COLD_RUNS ?? 3) : 0

/** Phases, in milliseconds from the moment `enablePlugin` was called. */
interface Sample {
  readCompileMs: number
  modulesMs: number
  onloadMs: number
  layoutMs: number
  enableMs: number
  firstFrameMs: number
  settledMs: number
}

type Phase = keyof Sample
type Build = 'development' | 'production'
const SCENARIOS = ['bare', 'workspace'] as const
type Scenario = (typeof SCENARIOS)[number]

interface ScenarioResult {
  /** The note opened in the main area, empty when the vault has none to offer. */
  note: string
  /** Abele views mounted after the load, by type. */
  views: string[]
  samples: Sample[]
}

interface ProbeResult {
  build: Build
  mainJsBytes: number
  version: string
  scenarios: Record<Scenario, ScenarioResult>
  error?: string
}

/** A median over this many reloads may be this much slower than the baseline before failing. */
interface Tolerance {
  /** Allowed ratio over the baseline. */
  factor: number
  /** Allowed absolute slack, so a 3 ms phase does not fail on a 5 ms reading. */
  slackMs: number
}

type Recorded = { recorded: string; mainJsBytes: number } & Partial<Record<Scenario, Sample>>

interface Baseline {
  tolerance: Partial<Record<Phase, Tolerance>>
  builds: Partial<Record<Build, Recorded>>
}

const available = isObsidianRunning()

/**
 * Runs inside the app. `evalJson` cannot await, so the probe parks its result on `window`
 * and the test polls for it, the way the responsiveness probe does.
 */
function probeSource(runs: number): string {
  return `(() => {
    window.__abeleLoadProbe = null
    const marks = ${JSON.stringify(LOAD_MARKS)}
    const id = 'abele'
    const ws = app.workspace
    const markAfter = (name, after) => {
      const list = performance.getEntriesByName(name, 'mark')
      const m = list[list.length - 1]
      return m && m.startTime >= after ? m.startTime : NaN
    }
    const frame = () => new Promise((res) => {
      const t = setTimeout(res, 1000)
      requestAnimationFrame(() => setTimeout(() => { clearTimeout(t); res() }, 0))
    })
    // Resolves with the end of the last stall over 50 ms, once the thread has been free for
    // quietMs — or at capMs, whichever comes first.
    const settle = (quietMs, capMs) => new Promise((res) => {
      const start = performance.now()
      let prev = start, lastBusy = start
      const tick = () => {
        const now = performance.now()
        if (now - prev > 50) lastBusy = now
        prev = now
        if (now - lastBusy >= quietMs || now - start >= capMs) res(lastBusy)
        else setTimeout(tick, 0)
      }
      setTimeout(tick, 0)
    })
    let seq = 0
    const leaf = (type, state = {}) => ({ id: 'abele-load-' + seq++, type: 'leaf', state: { type, state } })
    const side = (direction, child) => ({
      id: 'abele-load-' + seq++, type: 'split', direction: 'horizontal', width: 300,
      children: [{ id: 'abele-load-' + seq++, type: 'tabs', children: [child] }],
    })
    // The whole workspace is replaced by a fixed one rather than edited leaf by leaf: what is
    // open decides most of the cost, and a layout says exactly what that is.
    const scenario = async (name) => {
      let note = ''
      let main = leaf('empty'), left = leaf('file-explorer'), right = leaf('outline')
      if (name === 'workspace') {
        const file = app.vault.getMarkdownFiles()
          .filter((f) => f.path.startsWith('ScaleTest/Notes/'))
          .sort((a, b) => (a.path < b.path ? -1 : 1))[0]
        if (file) { note = file.path; main = leaf('markdown', { file: file.path, mode: 'source', source: false }) }
        left = leaf('abele-timeline-sidebar-view')
        right = leaf('abele-ai-sidebar-view')
      }
      await ws.changeLayout({
        main: { id: 'abele-load-' + seq++, type: 'split', direction: 'vertical',
          children: [{ id: 'abele-load-' + seq++, type: 'tabs', children: [main] }] },
        left: side('horizontal', left),
        right: side('horizontal', right),
        active: main.id,
      })
      ws.leftSplit.expand()
      ws.rightSplit.expand()
      await settle(500, 10000)
      return note
    }
    const abeleViews = () => ['abele-timeline-sidebar-view', 'abele-ai-sidebar-view']
      .flatMap((t) => ws.getLeavesOfType(t))
      .filter((l) => !l.isDeferred && l.view.getViewType().startsWith('abele'))
      .map((l) => l.view.getViewType()).sort()
    const once = async () => {
      await app.plugins.disablePlugin(id)
      await settle(300, 5000)
      const t0 = performance.now()
      await app.plugins.enablePlugin(id)
      const t1 = performance.now()
      await frame()
      const t2 = performance.now()
      const settled = await settle(500, 15000)
      const evalStart = markAfter(marks.evalStart, t0)
      const evalEnd = markAfter(marks.evalEnd, t0)
      const onloadStart = markAfter(marks.onloadStart, t0)
      const onloadEnd = markAfter(marks.onloadEnd, t0)
      const layoutStart = markAfter(marks.layoutStart, t0)
      const layoutEnd = markAfter(marks.layoutEnd, t0)
      return {
        readCompileMs: evalStart - t0,
        modulesMs: evalEnd - evalStart,
        onloadMs: onloadEnd - onloadStart,
        layoutMs: layoutEnd - layoutStart,
        enableMs: t1 - t0,
        firstFrameMs: t2 - t0,
        settledMs: Math.max(settled, t1) - t0,
      }
    }
    ;(async () => {
      const layout = ws.getLayout()
      const leftCollapsed = ws.leftSplit.collapsed, rightCollapsed = ws.rightSplit.collapsed
      try {
        const dir = app.plugins.manifests[id].dir
        const stat = await app.vault.adapter.stat(dir + '/main.js')
        const scenarios = {}
        for (const name of ${JSON.stringify(SCENARIOS)}) {
          const note = await scenario(name)
          // One reload not counted: the first after a build or a change of scene pays for
          // cold caches.
          await once()
          const samples = []
          for (let i = 0; i < ${runs}; i++) samples.push(await once())
          const views = abeleViews()
          scenarios[name] = { note, views, samples }
        }
        window.__abeleLoadProbe = {
          build: typeof window.__abeleTest === 'undefined' ? 'production' : 'development',
          mainJsBytes: stat ? stat.size : 0,
          version: app.plugins.manifests[id].version,
          scenarios,
        }
      } catch (e) {
        window.__abeleLoadProbe = { error: String(e && e.stack || e), scenarios: {} }
      } finally {
        // Whatever happened, the plugin is left on and the workspace as it was found.
        try { if (!app.plugins.plugins[id]) await app.plugins.enablePlugin(id) } catch {}
        try {
          await ws.changeLayout(layout)
          leftCollapsed ? ws.leftSplit.collapse() : ws.leftSplit.expand()
          rightCollapsed ? ws.rightSplit.collapse() : ws.rightSplit.expand()
        } catch {}
      }
    })()
    return 'started'
  })()`
}

async function runProbe(): Promise<ProbeResult> {
  evalRaw(probeSource(RUNS), 30_000)
  const deadline = Date.now() + 10 * 60_000
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    // Right after a reload the CLI can answer before the app does; that is not a failure.
    let done = false
    try {
      done = evalJson<boolean>('window.__abeleLoadProbe != null', 30_000)
    } catch {
      continue
    }
    if (done) return evalJson<ProbeResult>('window.__abeleLoadProbe', 30_000)
  }
  throw new Error('The load-time probe did not finish in time')
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const PHASES: Phase[] = [
  'readCompileMs',
  'modulesMs',
  'onloadMs',
  'layoutMs',
  'enableMs',
  'firstFrameMs',
  'settledMs',
]

describe.skipIf(!available)('plugin load time', () => {
  let result: ProbeResult
  const medians = {} as Record<Scenario, Sample>
  const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as Baseline

  beforeAll(async () => {
    result = await runProbe()
    if (result.error) throw new Error(`The load-time probe failed in the app: ${result.error}`)
    const was = baseline.builds[result.build]
    const lines = [
      '',
      `  ${result.build} build ${result.version}, main.js ${(result.mainJsBytes / 1024).toFixed(0)} KB, median of ${RUNS} reloads`,
    ]
    for (const name of SCENARIOS) {
      const { samples, note, views } = result.scenarios[name]
      medians[name] = Object.fromEntries(
        PHASES.map((p) => [p, Math.round(median(samples.map((s) => s[p])) * 10) / 10])
      ) as unknown as Sample
      lines.push(`  ${name}: ${note || 'no note'}, views ${views.join(', ') || 'none'}`)
      for (const p of PHASES) {
        const before = was?.[name]?.[p]
        lines.push(
          `    ${p.padEnd(14, '.')} ${medians[name][p].toFixed(1).padStart(8)} ms` +
            (before != null ? `   baseline ${before.toFixed(1).padStart(8)} ms` : '')
        )
      }
    }
    console.info([...lines, ''].join('\n'))
    writeFileSync(
      '/tmp/abele-load-time.json',
      JSON.stringify({ vault: activeVaultName(), ...result, medians }, null, 2)
    )

    if (UPDATE) {
      baseline.builds[result.build] = {
        recorded: new Date().toISOString().slice(0, 10),
        mainJsBytes: result.mainJsBytes,
        ...medians,
      }
      writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2) + '\n')
    }
  }, 11 * 60_000)

  it('reads every phase from the marks the plugin leaves', () => {
    // A mark that never appeared is NaN: the build is older than the marks, or one moved out
    // of the path a load takes. Either way the numbers below would be comparing nothing.
    for (const name of SCENARIOS) {
      expect(result.scenarios[name].samples.length).toBe(RUNS)
      for (const sample of result.scenarios[name].samples)
        for (const phase of PHASES) expect(Number.isFinite(sample[phase]), phase).toBe(true)
    }
  })

  it('set the workspace it meant to measure', () => {
    expect(result.scenarios.bare.views).toEqual([])
    expect(result.scenarios.workspace.views).toEqual([
      'abele-ai-sidebar-view',
      'abele-timeline-sidebar-view',
    ])
  })

  it('loads no slower than the baseline for this build, within its tolerance', () => {
    const was = baseline.builds[result.build]
    if (!was) {
      console.warn(`No ${result.build} baseline yet — run with ABELE_LOAD_BASELINE=update.`)
      return
    }
    const over: string[] = []
    for (const name of SCENARIOS) {
      const before = was[name]
      if (!before) continue
      for (const [phase, tolerance] of Object.entries(baseline.tolerance) as Array<
        [Phase, Tolerance]
      >) {
        const limit = Math.max(before[phase] * tolerance.factor, before[phase] + tolerance.slackMs)
        if (medians[name][phase] > limit)
          over.push(
            `${name} ${phase}: ${medians[name][phase]} ms, limit ${limit.toFixed(1)} ms (baseline ${before[phase]})`
          )
      }
    }
    expect(over).toEqual([])
  })
})

/** Marks as they fell during an app start, in ms from the window opening. */
interface ColdSample {
  evalStartAt: number
  modulesMs: number
  onloadMs: number
  layoutMs: number
  layoutEndAt: number
}

const COLD_PHASES: Array<keyof ColdSample> = [
  'evalStartAt',
  'modulesMs',
  'onloadMs',
  'layoutMs',
  'layoutEndAt',
]

function readColdMarks(): ColdSample | null {
  const at = evalJson<Record<string, number | null>>(
    `(() => {
      const marks = ${JSON.stringify(LOAD_MARKS)}
      const out = {}
      for (const [k, name] of Object.entries(marks)) {
        const list = performance.getEntriesByName(name, 'mark')
        out[k] = list.length ? list[list.length - 1].startTime : null
      }
      return out
    })()`,
    30_000
  )
  if (Object.values(at).some((v) => v == null)) return null
  const m = at as Record<keyof typeof LOAD_MARKS, number>
  return {
    evalStartAt: m.evalStart,
    modulesMs: m.evalEnd - m.evalStart,
    onloadMs: m.onloadEnd - m.onloadStart,
    layoutMs: m.layoutEnd - m.layoutStart,
    layoutEndAt: m.layoutEnd,
  }
}

describe.skipIf(!available || COLD_RUNS === 0)('plugin load time on an app start', () => {
  const samples: ColdSample[] = []

  beforeAll(async () => {
    for (let i = 0; i < COLD_RUNS; i++) {
      runCli(['dev:cdp', 'method=Page.reload', 'params={}'], 30_000)
      const deadline = Date.now() + 120_000
      let sample: ColdSample | null = null
      while (!sample && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        try {
          sample = readColdMarks()
        } catch {
          // The window is still coming back; the CLI answers before the app does.
        }
      }
      if (!sample) throw new Error('The app did not come back with the plugin loaded')
      samples.push(sample)
      waitForLinkIndex()
    }
    const medians = Object.fromEntries(
      COLD_PHASES.map((p) => [p, Math.round(median(samples.map((s) => s[p])))])
    )
    const file = '/tmp/abele-load-time.json'
    let previous: Record<string, unknown> = {}
    try {
      previous = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    } catch {
      // No warm run before this one.
    }
    writeFileSync(file, JSON.stringify({ ...previous, cold: { samples, medians } }, null, 2))
    console.info(
      [
        '',
        `  app start, median of ${samples.length}`,
        ...COLD_PHASES.map((p) => `  ${p.padEnd(14, '.')} ${String(medians[p]).padStart(8)} ms`),
        '',
      ].join('\n')
    )
  }, 10 * 60_000)

  it('leaves every mark during a real start', () => {
    expect(samples.length).toBe(COLD_RUNS)
    for (const sample of samples)
      for (const phase of COLD_PHASES) expect(Number.isFinite(sample[phase]), phase).toBe(true)
  })
})
