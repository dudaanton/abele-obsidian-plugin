import { appSuspension, type AppSuspension } from './appSuspension'
import { isTransient } from './retry'

/** Recovery owns only a model transport, never a tool or the agent turn's Stop signal. */
export class SuspendedRequest {
  readonly controller = new AbortController()
  private crossedBackground: boolean
  private lastProgress = Date.now()
  private stale = false
  private timer: number | null = null
  private unsubscribe: () => void
  private readonly abort = () => this.controller.abort()

  constructor(
    private readonly turnSignal?: AbortSignal,
    private readonly lifecycle: AppSuspension = appSuspension
  ) {
    this.crossedBackground = lifecycle.enabled && lifecycle.hidden
    if (turnSignal?.aborted) this.controller.abort()
    else turnSignal?.addEventListener('abort', this.abort, { once: true })
    this.unsubscribe = lifecycle.subscribe(() => {
      if (lifecycle.hidden) {
        this.crossedBackground = true
        this.clearTimer()
      } else if (lifecycle.enabled && lifecycle.frozenOnReturn && this.crossedBackground) {
        // Let buffered chunks arrive first. A live stream is not restarted on every switch.
        this.clearTimer()
        this.timer = window.setTimeout(() => {
          this.timer = null
          if (!turnSignal?.aborted && Date.now() - this.lastProgress >= 10_000) {
            this.stale = true
            this.controller.abort()
          }
        }, 1500)
      }
    })
  }

  progress(): void {
    this.lastProgress = Date.now()
  }

  shouldResume(reason: string, error?: string): boolean {
    if (this.turnSignal?.aborted || !this.lifecycle.enabled || !this.crossedBackground) return false
    return (
      this.stale ||
      reason === 'aborted' ||
      (reason === 'error' &&
        (isTransient(error ?? '') ||
          /^(?:TypeError: )?Load failed$/i.test(error ?? '') ||
          error === 'No response received'))
    )
  }

  private clearTimer(): void {
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = null
  }

  dispose(): void {
    this.clearTimer()
    this.unsubscribe()
    this.turnSignal?.removeEventListener('abort', this.abort)
  }
}
