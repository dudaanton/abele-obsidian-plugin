import { ref } from 'vue'
import { nanoid } from 'nanoid'

/**
 * Every script run of this session, and what became of it.
 *
 * Kept in memory only. A run is interesting while you are working — did it finish, what did it
 * print, can it be run again — and stops being interesting when Obsidian closes; writing it to
 * the vault would put churn in the file tree in exchange for nothing anybody asked for.
 */

export type RunStatus = 'running' | 'done' | 'failed' | 'stopped'

/** Who asked for the run. A script failing on its own is not the same as one an agent called. */
export type RunSource = 'command' | 'note' | 'link' | 'agent' | 'script' | 'view'

export interface RunLogLine {
  at: number
  text: string
}

export interface ScriptRun {
  id: string
  path: string
  name: string
  params: Record<string, unknown>
  source: RunSource
  status: RunStatus
  startedAt: number
  finishedAt: number | null
  log: RunLogLine[]
  /** What the script last said it was doing, through `setStatus`. */
  note: string
  result: string
  error: string
}

/**
 * Enough to look back over a working session, not enough for a script in a loop to fill memory.
 * Finished runs are dropped oldest first; a run still going is never dropped.
 */
export const MAX_RUNS = 50

export class ScriptRuns {
  private static instance: ScriptRuns | null = null

  readonly runs = ref<ScriptRun[]>([])

  /**
   * How to stop each running script, kept out of the reactive list on purpose: an
   * `AbortController` is not state to render, and Vue would proxy it along with everything else.
   */
  private stoppers = new Map<string, () => void>()

  static getInstance(): ScriptRuns {
    if (!this.instance) this.instance = new ScriptRuns()
    return this.instance
  }

  static destroy(): void {
    this.instance = null
  }

  start(run: {
    path: string
    name: string
    params: Record<string, unknown>
    source: RunSource
    stop: () => void
  }): string {
    const id = nanoid(8)
    this.stoppers.set(id, run.stop)
    // Newest first: the run you just started is the one you are looking for.
    this.runs.value.unshift({
      id,
      path: run.path,
      name: run.name,
      params: run.params,
      source: run.source,
      status: 'running',
      startedAt: Date.now(),
      finishedAt: null,
      log: [],
      note: '',
      result: '',
      error: '',
    })
    this.trim()
    return id
  }

  append(id: string, text: string): void {
    this.find(id)?.log.push({ at: Date.now(), text })
  }

  setNote(id: string, note: string): void {
    const run = this.find(id)
    if (run) run.note = note
  }

  finish(id: string, result: string): void {
    this.close(id, 'done', (run) => (run.result = result))
  }

  fail(id: string, error: string): void {
    this.close(id, 'failed', (run) => (run.error = error))
  }

  /** Ended because it was told to, which is not a failure and should not read as one. */
  markStopped(id: string): void {
    this.close(id, 'stopped', () => {})
  }

  private close(id: string, status: RunStatus, fill: (run: ScriptRun) => void): void {
    const run = this.find(id)
    if (!run || run.status !== 'running') return
    run.status = status
    run.finishedAt = Date.now()
    fill(run)
    this.stoppers.delete(id)
  }

  stop(id: string): void {
    this.stoppers.get(id)?.()
  }

  stopAll(): void {
    for (const stop of [...this.stoppers.values()]) stop()
  }

  find(id: string): ScriptRun | undefined {
    return this.runs.value.find((run) => run.id === id)
  }

  running(): ScriptRun[] {
    return this.runs.value.filter((run) => run.status === 'running')
  }

  /** Clears out what has ended, leaving anything still going. */
  clearFinished(): void {
    this.runs.value = this.runs.value.filter((run) => run.status === 'running')
  }

  forget(id: string): void {
    const run = this.find(id)
    if (!run || run.status === 'running') return
    this.runs.value = this.runs.value.filter((other) => other.id !== id)
  }

  private trim(): void {
    if (this.runs.value.length <= MAX_RUNS) return

    const keep: ScriptRun[] = []
    let over = this.runs.value.length - MAX_RUNS
    // Oldest last, so walking from the end drops the oldest finished runs first.
    for (let i = this.runs.value.length - 1; i >= 0; i--) {
      const run = this.runs.value[i]
      if (over > 0 && run.status !== 'running') {
        over--
        continue
      }
      keep.unshift(run)
    }
    this.runs.value = keep
  }
}
