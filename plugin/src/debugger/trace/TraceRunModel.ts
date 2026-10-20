import { t } from '@/i18n'
import { nodeErrorWords } from '@/node/errorWords'
// A run open in its tab: the steps, the step picked and what its values are made of, a value
// followed through the run. Shapes and changes are asked of the node only for the step looked at.
import { reactive } from 'vue'
import type { TraceRun, TraceStep, TraceTrail } from '@/components/debugger/trace/types'
import { run as runView, shape, trail } from './mapping'
import type { TraceRpc, WireRun } from './wire'

export class TraceRunModel {
  run?: TraceRun
  wire?: WireRun
  picked?: string
  trail?: TraceTrail
  error = ''
  private loadedSteps = new Set<string>()
  private timer?: number
  private disposed = false
  private loading = false
  /** A record point whose last hit is to be picked once the steps have come. */
  private wantedPoint?: string
  constructor(
    readonly rpc: TraceRpc,
    readonly projectId: string,
    readonly runId: string,
    private readonly changed: () => void
  ) {}

  async load() {
    if (this.disposed || this.loading) return
    this.loading = true
    window.clearTimeout(this.timer)
    try {
      const wire = await this.rpc.wholeRun(this.projectId, this.runId)
      if (this.disposed) return
      this.wire = wire
      // Reactive, so a shape or a mark filled in later redraws the step that shows it.
      this.run = reactive(runView(this.wire))
      this.loadedSteps.clear()
      this.error = ''
      const wanted = this.lastHitOf(this.wantedPoint)
      this.wantedPoint = undefined
      if (wanted) this.picked = wanted
      if (this.picked) await this.fill(this.picked)
    } catch (e) {
      this.error = e instanceof Error ? nodeErrorWords(e.message) : t('streamC.77490b1334072a11')
      console.debug('[trace] Run unavailable', e)
    } finally {
      this.loading = false
      if (!this.disposed && this.wire?.run.state === 'recording')
        this.timer = window.setTimeout((): void => void this.load(), 2000)
    }
    this.changed()
  }

  dispose() {
    this.disposed = true
    window.clearTimeout(this.timer)
  }

  step(id: string): TraceStep | undefined {
    return this.run?.steps.find((s) => s.id === id)
  }

  /** Picks the last step a record point gave, the way its line's count of hits opens the run. */
  async pickPoint(point: string) {
    if (!this.wire) {
      this.wantedPoint = point
      return
    }
    const last = this.lastHitOf(point)
    if (last) await this.pick(last)
  }
  private lastHitOf(point: string | undefined) {
    return point ? this.wire?.steps.findLast((s) => s.point === point)?.id : undefined
  }

  async pick(id: string | undefined) {
    this.picked = id
    this.trail = undefined
    this.changed()
    if (id) await this.fill(id)
  }

  /** The picked step's values with their shapes and what changed since the last time. */
  private async fill(id: string) {
    const step = this.step(id)
    if (!step || this.loadedSteps.has(id)) return
    this.loadedSteps.add(id)
    const values = [...step.values, ...(step.request ?? []), ...(step.response ?? [])]
    await Promise.all(
      values.map(async (v) => {
        if (v.failed || v.masked) return
        try {
          const r = await this.rpc.value(this.projectId, this.runId, id, v.name, 'shape')
          if (r.shape) v.shape = shape(r.shape)
          // The row offers the whole value; the tab reads it from the node page by page.
          v.text = v.brief || ' '
          if (!v.same) {
            const c = await this.rpc
              .value(this.projectId, this.runId, id, v.name, 'changes')
              .catch((): undefined => undefined)
            if (c?.changes) v.changes = { summary: c.changes.summary, before: '', after: '' }
          }
        } catch (e) {
          console.debug('[trace] Value unavailable', v.name, e)
        }
      })
    )
    this.changed()
  }

  async follow(value: string) {
    try {
      const plain = value.replace(/^"(.*)"$/, '$1')
      const asNumber = Number(plain)
      const needle =
        plain !== '' && !Number.isNaN(asNumber) && /^-?[\d.]+$/.test(plain) ? asNumber : plain
      this.trail = trail(await this.rpc.follow(this.projectId, this.runId, needle))
    } catch (e) {
      this.error = e instanceof Error ? e.message : t('streamC.d7e1cbd199d663cc')
    }
    this.changed()
  }

  unfollow() {
    this.trail = undefined
    this.changed()
  }

  /** `name/path` from a value row, `''` for the whole step. */
  async mark(step: string, at: string, comment: string) {
    const slash = at.indexOf('/')
    const name = slash < 0 ? at : at.slice(0, slash)
    const path = slash < 0 ? undefined : at.slice(slash + 1)
    await this.rpc.mark(this.projectId, this.runId, {
      step,
      ...(name ? { name } : {}),
      ...(path ? { path } : {}),
      comment,
    })
    const s = this.step(step)
    if (s) s.marked = true
    this.changed()
  }
}
