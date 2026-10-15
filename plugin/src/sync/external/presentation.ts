import type { ExternalFile, ExternalProgress, ExternalState } from '@/components/external/types'
import type { TokenOffloadCoordinator } from '../tokenOffloadCoordinator'

export interface ExternalPresentationValue {
  file: ExternalFile
  state: ExternalState
  progress?: ExternalProgress
  error?: string
  hydrated: boolean
}

/** One presentation for every mounted surface, fed by verified local records and real reads. */
export class ExternalPresentation {
  value: ExternalPresentationValue
  private listeners = new Set<() => void>()
  private off: () => void
  private stopped = false
  private request = 0
  private controller: AbortController | null = null
  private known = false
  constructor(
    private manager: TokenOffloadCoordinator,
    readonly path: string,
    public online = () => typeof navigator === 'undefined' || navigator.onLine,
    private preview: (key: string) => string | undefined = () => undefined
  ) {
    this.value = {
      file: {
        name: path.split('/').at(-1),
        mime: 'application/octet-stream',
        size: 0,
        since: 'an earlier sync',
      },
      state: 'remote',
      hydrated: false,
    }
    this.off = manager.subscribe(() => void this.refresh())
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  private emit(): void {
    for (const listener of this.listeners) listener()
  }
  async refresh(): Promise<void> {
    const request = ++this.request
    try {
      if (this.manager.isOffloaded(this.path)) this.known = true
      if (!this.known && this.path.endsWith('.abele-ref')) {
        this.value = {
          ...this.value,
          hydrated: false,
          state: 'failed',
          error:
            'This stub is not owned by a current connection. Recover its connection before downloading.',
        }
        this.emit()
        return
      }
      const detail = await this.manager.describe(this.path)
      if (this.stopped || request !== this.request) return
      const progress = this.manager.transfer(this.path)
      const hydrated = !this.manager.isOffloaded(this.path)
      const file = detail
        ? {
            name: this.path.split('/').at(-1),
            mime: detail.mime,
            size: detail.size,
            width: detail.width,
            height: detail.height,
            duration: detail.duration,
            since: detail.offloadedAt
              ? new Date(detail.offloadedAt).toLocaleDateString()
              : 'an earlier sync',
            preview: detail.preview ? this.preview(detail.preview) : undefined,
          }
        : this.value.file
      this.value = {
        ...this.value,
        file,
        hydrated,
        progress,
        state: progress
          ? 'downloading'
          : !this.online() || detail?.available === false
            ? 'offline'
            : this.value.error
              ? 'failed'
              : detail?.changed
                ? 'changed'
                : 'remote',
      }
      this.emit()
    } catch (error) {
      if (!this.stopped && request === this.request) {
        this.value = {
          ...this.value,
          state: this.online() ? 'failed' : 'offline',
          error: String(error),
        }
        this.emit()
      }
    }
  }
  async download(work?: () => Promise<void>): Promise<void> {
    if (this.controller || !this.online()) return
    if (!this.known && this.path.endsWith('.abele-ref') && !this.manager.isOffloaded(this.path)) {
      await this.refresh()
      return
    }
    this.controller = new AbortController()
    this.value.error = undefined
    try {
      if (work) await work()
      else await this.manager.prepare([this.path], this.controller.signal)
    } catch (error) {
      if (!this.controller.signal.aborted)
        this.value.error = error instanceof Error ? error.message : String(error)
    } finally {
      this.controller = null
      await this.refresh()
    }
  }
  cancel(): void {
    this.controller?.abort()
    this.manager.cancel(this.path)
  }
  dispose(): void {
    this.stopped = true
    this.off()
    this.listeners.clear()
  }
}
