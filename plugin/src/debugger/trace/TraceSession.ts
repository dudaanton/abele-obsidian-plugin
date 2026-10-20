// One debugger session's recording: its record points, the run being written, the project's runs.
// No Obsidian here; the panel, the source margin and the run tab read it and call its moves.
import type { DebuggerSnapshot } from '@abele/node-protocol'
import type { DebugBreakpoint } from '@/components/debugger/types'
import type { TraceRecording, TraceRunSummary } from '@/components/debugger/trace/types'
import { decorate, recording, runSummary, type KnownBreakpoint } from './mapping'
import type { TraceRpc, WirePoint, WireRunPoint, WireRunSummary, WireStatus } from './wire'

/** The breakpoints a record point stands on: the debugger controller, as far as trace needs it. */
export interface TraceBreakpoints {
  readonly snapshot: DebuggerSnapshot | null
  knownBreakpoints(): (KnownBreakpoint & { sourceId: string; requestedLine: number })[]
  setBreakpoint(
    id: string,
    sourceId: string,
    line: number,
    condition?: string,
    options?: { enabled?: boolean }
  ): Promise<unknown>
  removeBreakpoint(id: string): Promise<unknown>
}

export interface PointEdit {
  take: string[]
  when?: string
  note?: string
}

const FOLLOW_MS = 2000
export class RecordPointSaveError extends Error {
  constructor(readonly code: string) {
    super('Record point save could not be confirmed')
  }
}

export class TraceSession {
  points: WirePoint[] = []
  status?: WireStatus
  runs: WireRunSummary[] = []
  /** The record points as the newest run saw them: how often each fired, what it took last. */
  latest?: WireRunPoint[]
  folder = ''
  private refreshing?: Promise<void>
  private readonly endedListeners = new Set<(runId: string) => void>()
  /** While a run is written its steps and time go on, and its end comes with no event of its own. */
  private following?: number
  private disposed = false
  constructor(
    readonly rpc: TraceRpc,
    private readonly debug: TraceBreakpoints,
    private readonly changed: () => void
  ) {}

  /** A run the node was writing is written no more: the program stopped or its points went. */
  onRunEnded(listener: (runId: string) => void) {
    this.endedListeners.add(listener)
    return () => {
      this.endedListeners.delete(listener)
    }
  }

  get sessionId() {
    return this.debug.snapshot?.debug_session_id
  }
  get projectId() {
    return this.debug.snapshot?.target.project_id
  }

  refresh(): Promise<void> {
    return (this.refreshing ??= (async () => {
      const session = this.sessionId,
        project = this.projectId
      if (!session || !project) return
      const [points, status, runs] = await Promise.all([
        this.rpc.points(session),
        this.rpc.status(session),
        this.rpc.runs(project),
      ])
      const ownRuns = runs.runs.filter((run) => run.debug_session_id === session)
      const newest = ownRuns[0]
      const latest = newest ? (await this.rpc.run(project, newest.id, 0, 1)).points : undefined
      if (this.sessionId !== session) return
      const was = this.status?.recording?.run_id
      this.points = points
      this.status = status
      this.runs = ownRuns
      this.folder = runs.folder
      this.latest = latest
      this.changed()
      if (was && status.recording?.run_id !== was && runs.runs.some((r) => r.id === was))
        for (const listener of [...this.endedListeners]) listener(was)
    })().finally(() => {
      this.refreshing = undefined
      this.follow()
    }))
  }

  private follow() {
    window.clearTimeout(this.following)
    this.following = undefined
    if (this.disposed || !this.status?.recording) return
    this.following = window.setTimeout(() => {
      this.following = undefined
      void this.refresh().catch((e) => console.debug('[trace] Run not read again', e))
    }, FOLLOW_MS)
  }
  dispose() {
    this.disposed = true
    window.clearTimeout(this.following)
  }

  /** A stop on record points only: the node takes the values and lets the program go on, so it
   * reads as running, and nothing is asked of a frame that is already gone. */
  isRecordStop(snapshot = this.debug.snapshot) {
    const stop = snapshot?.threads.find((t) => t.thread_id === snapshot.selected_thread_id)?.stop
    const hits = stop?.hit_breakpoint_ids ?? []
    return (
      hits.length > 0 &&
      hits.every(
        (id) =>
          this.points.some((p) => p.breakpoint_id === id) &&
          snapshot?.breakpoints?.some(
            (b) => b.breakpoint_id === id && (b.status === 'verified' || b.status === 'relocated')
          )
      )
    )
  }

  /** The panel's and the margin's breakpoints, record points marked as such. */
  breakpoints(): DebugBreakpoint[] {
    return decorate(this.debug.knownBreakpoints(), this.points, this.latest)
  }
  pointAt(sourceId: string, line: number) {
    const b = this.debug.knownBreakpoints().find((k) => k.sourceId === sourceId && k.line === line)
    return b && this.points.some((p) => p.breakpoint_id === b.id) ? b : undefined
  }
  recording(now = Date.now()): TraceRecording | undefined {
    return this.status ? recording(this.status, now) : undefined
  }
  summaries(now = Date.now()): TraceRunSummary[] {
    return this.runs
      .filter((r) => r.steps > 0 && r.debug_session_id === this.sessionId)
      .map((r) => runSummary(r, now))
  }

  /** Sets up a record point on a line: the point first, so a hit never comes before what to take,
   * then its breakpoint, kept when one is already there. */
  async savePoint(sourceId: string, line: number, edit: PointEdit) {
    const session = this.sessionId
    if (!session) throw new Error('No debugger session')
    const existing = this.debug
      .knownBreakpoints()
      .find((b) => b.sourceId === sourceId && b.line === line)
    const id = existing?.id ?? crypto.randomUUID()
    this.points = await this.rpc.setPoints(
      session,
      [
        {
          breakpoint_id: id,
          take: edit.take,
          ...(edit.note?.trim() ? { note: edit.note.trim() } : {}),
        },
      ],
      []
    )
    let pending = false
    if (!existing || existing.kind === 'log' || (existing.condition ?? '') !== (edit.when ?? '')) {
      const result =
        existing?.state === 'disabled'
          ? await this.debug.setBreakpoint(id, sourceId, existing.requestedLine, edit.when, {
              enabled: false,
            })
          : await this.debug.setBreakpoint(id, sourceId, existing?.requestedLine ?? line, edit.when)
      if (
        result &&
        typeof result === 'object' &&
        'outcome' in result &&
        result.outcome !== 'completed' &&
        result.outcome !== 'pending'
      ) {
        // Keep the trace registration until removal is confirmed, so a late hit still records.
        if (!existing) {
          try {
            const removed = (await this.debug.removeBreakpoint(id)) as
              | { outcome?: string }
              | undefined
            if (removed?.outcome === 'completed')
              this.points = await this.rpc.setPoints(session, [], [id])
          } catch (error) {
            console.debug('[trace] Unconfirmed record point could not be removed', error)
          }
        }
        this.changed()
        throw new RecordPointSaveError(
          'code' in result && typeof result.code === 'string'
            ? result.code
            : typeof result.outcome === 'string'
              ? result.outcome
              : 'not_completed'
        )
      }
      pending =
        !!result &&
        typeof result === 'object' &&
        'outcome' in result &&
        result.outcome === 'pending'
    }
    this.changed()
    await this.refresh()
    return { pending }
  }

  /** It stops the program again rather than taking values. */
  async toBreakpoint(id: string) {
    const session = this.sessionId
    if (!session) return
    this.points = await this.rpc.setPoints(session, [], [id])
    this.changed()
    await this.refresh()
  }

  async removePoint(id: string) {
    const session = this.sessionId
    if (!session) return
    this.points = await this.rpc.setPoints(session, [], [id])
    await this.debug.removeBreakpoint(id)
    this.changed()
    await this.refresh()
  }

  async chooseFolder(folder: string) {
    const project = this.projectId
    if (!project) return
    this.folder = (await this.rpc.setFolder(project, folder)).folder
    await this.refresh()
  }
}
