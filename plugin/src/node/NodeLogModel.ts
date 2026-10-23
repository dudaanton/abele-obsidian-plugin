import { computed, markRaw, ref, shallowRef } from 'vue'
import { z } from 'zod'
const Line = z.object({
  time: z.iso.datetime({ offset: true }).nullable(),
  level: z.enum(['debug', 'info', 'warn', 'error', 'unknown']),
  text: z.string(),
  source: z.enum(['stdout', 'stderr']),
})
// Compatibility adapter for node.log.v1.tail until the vendored SDK exports its schema.
const Page = z.object({
  lines: z.array(Line).max(200),
  truncated: z.boolean(),
  reason: z.enum(['logs_missing', 'logs_unavailable', 'empty', 'no_matching_lines']).optional(),
  files: z
    .array(
      z.object({
        source: z.enum(['stdout', 'stderr']),
        truncated: z.boolean(),
        reason: z.enum(['missing', 'unavailable', 'rotated', 'empty']).optional(),
      })
    )
    .max(2),
})
export type NodeLogEntry = z.infer<typeof Line>
export interface NodeLogPort {
  online(): boolean
  read(params: { limit: number }): Promise<unknown>
}

/** One window's bounded evidence. Never written to vault, settings, or provider context. */
export class NodeLogModel {
  readonly lines = shallowRef<NodeLogEntry[]>([])
  readonly level = ref('all')
  readonly busy = ref(false)
  readonly error = ref('')
  readonly version = ref('')
  readonly reason = ref('')
  readonly truncated = ref(false)
  readonly shown = computed(() =>
    this.lines.value.filter(
      (line) => this.level.value === 'all' || line.level === 'warn' || line.level === 'error'
    )
  )
  readonly marked = computed(() => {
    const timed = this.shown.value.filter(
      (line): line is NodeLogEntry & { time: string } => line.time !== null
    )
    const at = this.at
    if (at === undefined || !timed.length) return undefined
    return timed.reduce((near, line) =>
      Math.abs(Date.parse(line.time) - at) < Math.abs(Date.parse(near.time) - at) ? line : near
    ).time
  })
  private generation = 0
  private closed = false
  constructor(
    readonly port: NodeLogPort,
    private readonly at?: number
  ) {
    markRaw(this)
  }
  async refresh(): Promise<void> {
    if (this.closed || !this.port.online() || this.busy.value) return
    const generation = ++this.generation
    this.busy.value = true
    this.error.value = ''
    try {
      const page = Page.parse(await this.port.read({ limit: 200 }))
      if (this.closed || generation !== this.generation) return
      this.lines.value = [...page.lines].sort(
        (a, b) =>
          (a.time ? Date.parse(a.time) : Infinity) - (b.time ? Date.parse(b.time) : Infinity)
      )
      this.reason.value = page.reason ?? ''
      this.truncated.value = page.truncated || page.files.some((file) => file.truncated)
    } catch (error) {
      if (!this.closed && generation === this.generation) {
        console.debug('[node] Log read failed', error)
        this.error.value =
          error instanceof z.ZodError
            ? 'invalid_log_response'
            : error instanceof Error
              ? error.message
              : 'log_read_failed'
      }
    } finally {
      if (generation === this.generation) this.busy.value = false
    }
  }
  connectionChanged(online: boolean): void {
    if (this.closed) return
    if (online) void this.refresh()
    else {
      // A late response from the old transport must not replace the retained evidence.
      ++this.generation
      this.busy.value = false
    }
  }
  copyText(): string {
    return this.shown.value
      .map((line) => `${line.time ?? ''} ${line.level} ${line.text}`)
      .join('\n')
  }
  destroy(): void {
    this.closed = true
    ++this.generation
  }
}
