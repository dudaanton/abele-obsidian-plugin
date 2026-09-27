/**
 * Runs the startup scripts, each time the plugin starts.
 *
 * "Starts" is the plugin's start: Obsidian opening, and also the plugin being reloaded or
 * updated, which is the same start as far as the plugin can tell. Switching scripts on later in
 * a session does not run them. They wait for the workspace to be laid out, for the script index,
 * and for Obsidian to have read the vault's notes (for as long as `RESOLVE_WAIT_MS` at most), so a
 * startup script finds what an ordinary run would find.
 *
 * They run one after another, in the order `startupScripts.ts` picks, and each on its own:
 *
 * - one that throws is a failed run in the list of runs and a console warning naming it;
 * - one still running after `STARTUP_TIMEOUT_MS` is named in a warning and the next one starts —
 *   it goes on in the background, in the list of runs, where it can be stopped;
 * - nobody is asked anything: a script's parameters are its defaults, one that needs a value
 *   without a default is skipped with a notice, and a form inside a script is dismissed.
 *
 * Two ways out when a startup script is what breaks the start. The switch in the settings skips
 * them all, and works from a phone. And the script being run is written down on this device
 * while it runs: a script that freezes the app never gets to rub that out, so at the next start
 * it is found there, skipped that once, and named in a notice.
 */
import { Notice, Platform, type App } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import type { ExecuteOptions, ScriptService } from './ScriptService'
import type { ParsedScript } from './types'
import { startupParams, startupQueue, startupScriptsFrom } from './startupScripts'

export const STARTUP_TIMEOUT_MS = 30_000
/** How long the start waits for Obsidian to finish reading the notes before going on anyway. */
export const RESOLVE_WAIT_MS = 15_000
/** On this device: the startup script running now, `{ path, name }`. */
export const RUNNING_STARTUP_KEY = 'abele-startup-script-running'

export interface StartupRun {
  queue: ParsedScript[]
  paused: boolean
  execute(path: string, params: Record<string, unknown>, opts: ExecuteOptions): Promise<string>
  storage: { load(key: string): unknown; save(key: string, value: unknown): void }
  notify(message: string): void
  timeoutMs?: number
}

export interface StartupOutcome {
  name: string
  outcome: 'done' | 'failed' | 'timeout' | 'skipped'
}

function markerFrom(stored: unknown): { path: string; name: string } | null {
  if (!stored || typeof stored !== 'object') return null
  const { path, name } = stored as { path?: unknown; name?: unknown }
  return typeof path === 'string' ? { path, name: typeof name === 'string' ? name : path } : null
}

export async function runStartupScripts(run: StartupRun): Promise<StartupOutcome[]> {
  const crashed = markerFrom(run.storage.load(RUNNING_STARTUP_KEY))
  run.storage.save(RUNNING_STARTUP_KEY, null)
  if (run.paused) {
    if (run.queue.length) console.debug('[Abele] startup scripts are switched off in the settings; none were run')
    return []
  }

  const timeoutMs = run.timeoutMs ?? STARTUP_TIMEOUT_MS
  const report: StartupOutcome[] = []
  for (const script of run.queue) {
    const name = script.meta.name
    if (crashed && crashed.path === script.path) {
      run.notify(
        `Startup script "${name}" was skipped: it had not finished when Obsidian last closed, and may be what stopped it.`
      )
      report.push({ name, outcome: 'skipped' })
      continue
    }
    const params = startupParams(script)
    if (!params) {
      run.notify(
        `Startup script "${name}" was not run: it needs a value that has no default, and nobody is asked at startup.`
      )
      report.push({ name, outcome: 'skipped' })
      continue
    }

    run.storage.save(RUNNING_STARTUP_KEY, { path: script.path, name })
    let timer: number | undefined
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = window.setTimeout(() => resolve('timeout'), timeoutMs)
    })
    try {
      const result = await Promise.race([
        run
          .execute(script.path, params, { source: 'startup', formHandler: async () => null })
          .then(() => 'done' as const),
        timedOut,
      ])
      if (result === 'timeout') {
        console.warn(
          `[Abele] startup script "${name}" is still running after ${timeoutMs / 1000} s; the next one starts, it goes on in the background`
        )
      }
      report.push({ name, outcome: result })
    } catch (err) {
      // Waiting to be confirmed on this device: not run, which the notice about it has said.
      if (err instanceof Error && err.name === 'ScriptWaitingError') {
        console.debug(`[Abele] startup script "${name}" waits to be confirmed on this device`)
        report.push({ name, outcome: 'skipped' })
        continue
      }
      console.warn(`[Abele] startup script "${name}" failed:`, err)
      report.push({ name, outcome: 'failed' })
    } finally {
      window.clearTimeout(timer)
      run.storage.save(RUNNING_STARTUP_KEY, null)
    }
  }
  return report
}

/** Settles once Obsidian has read every note, or after `ms`, whichever is first. */
function metadataResolved(app: App, ms: number): Promise<void> {
  // Obsidian's own state, not in its typings: `initialized` once the cache is loaded, and no
  // file left to read. Without these the start would wait for a `resolved` that already fired.
  const cache = app.metadataCache as App['metadataCache'] & {
    initialized?: boolean
    inProgressTaskCount?: number
  }
  if (cache.initialized && !cache.inProgressTaskCount) return Promise.resolve()
  return new Promise((resolve) => {
    const ref = app.metadataCache.on('resolved', done)
    const timer = window.setTimeout(done, ms)
    function done() {
      window.clearTimeout(timer)
      app.metadataCache.offref(ref)
      resolve()
    }
  })
}

/** The start's own run of the startup scripts, from what the settings and the index say. */
export async function startStartupScripts(app: App, service: ScriptService): Promise<void> {
  await service.ready
  await metadataResolved(app, RESOLVE_WAIT_MS)
  const { ai } = AbeleConfig.getInstance()
  const queue = startupQueue(
    service.getAll(),
    startupScriptsFrom(ai.startupScripts),
    Platform.isMobile
  )
  const report = await runStartupScripts({
    queue,
    paused: !!ai.startupScriptsPaused,
    execute: (path, params, opts) => service.execute(path, params, opts),
    storage: {
      load: (key) => app.loadLocalStorage(key) as unknown,
      save: (key, value) => app.saveLocalStorage(key, value),
    },
    notify: (message) => new Notice(message, 10_000),
  })
  if (report.length) {
    console.debug(
      `[Abele] startup scripts: ${report.map((r) => `${r.name} ${r.outcome}`).join(', ')}`
    )
  }
}
