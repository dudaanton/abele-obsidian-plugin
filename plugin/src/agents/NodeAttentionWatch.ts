import { watch, type Ref, type WatchStopHandle } from 'vue'
import type { AttentionRow } from './attention'
import {
  readNodeAttention,
  type NodeAttentionPort,
  type NodeAttentionTarget,
} from './nodeAttention'

type CoverageState = 'connecting' | 'offline' | 'online' | 'failed'
interface Watched {
  target: NodeAttentionTarget
  state: CoverageState
  rows: AttentionRow[]
  unreadable: number
  connection?: { state?: Ref<string>; client: NodeAttentionPort }
  stop?: WatchStopHandle
  loading?: Promise<void>
  again?: boolean
  removed?: boolean
}
const TEXT: Record<Exclude<CoverageState, 'online'>, string> = {
  connecting: 'Connecting…',
  offline: 'Offline',
  failed: "Can't load this node's sessions right now",
}
/** How often a connected node is asked again while nothing else asks. */
const POLL_MS = 60_000

/**
 * The agents list's view of each registered node. Offline means the connection is down and
 * nothing else; a connected node that cannot be listed says so, and one unreadable session
 * never hides the rest.
 */
export class NodeAttentionWatch {
  private readonly watched = new Map<string, Watched>()
  private timer?: number
  constructor(private readonly changed: () => void) {}

  set(targets: NodeAttentionTarget[]): void {
    const ids = new Set(targets.map((t) => t.id))
    for (const [id, entry] of this.watched)
      if (!ids.has(id)) {
        entry.removed = true
        entry.stop?.()
        this.watched.delete(id)
      }
    for (const target of targets) {
      const entry = this.watched.get(target.id)
      if (entry) {
        entry.target = target
        continue
      }
      const created: Watched = { target, state: 'connecting', rows: [], unreadable: 0 }
      this.watched.set(target.id, created)
      void this.attach(created)
    }
    if (this.watched.size && this.timer === undefined)
      this.timer = window.setInterval((): void => void this.refresh(), POLL_MS)
    if (!this.watched.size && this.timer !== undefined) {
      window.clearInterval(this.timer)
      this.timer = undefined
    }
  }

  private async attach(entry: Watched): Promise<void> {
    try {
      const { NodeService } = await import('@/node/NodeService')
      if (entry.removed) return
      const connection = NodeService.getInstance().connection(
        entry.target.id
      ) as Watched['connection']
      entry.connection = connection
      entry.stop = watch(
        () => connection?.state?.value,
        (state) => this.follow(entry, state),
        { immediate: true }
      )
    } catch {
      this.follow(entry, 'offline')
    }
  }

  private follow(entry: Watched, state: string | undefined): void {
    if (entry.removed) return
    if (state === 'connected') {
      void this.load(entry)
      return
    }
    entry.state = state === 'connecting' ? 'connecting' : 'offline'
    entry.rows = []
    entry.unreadable = 0
    this.changed()
  }

  /** Ask every connected node again; offline ones wait for their connection. */
  async refresh(): Promise<void> {
    await Promise.all(
      [...this.watched.values()]
        .filter((entry) => entry.connection?.state?.value === 'connected')
        .map((entry) => this.load(entry))
    )
  }

  private load(entry: Watched): Promise<void> {
    if (entry.loading !== undefined) {
      entry.again = true
      return entry.loading
    }
    entry.loading = (async () => {
      do {
        entry.again = false
        const client = entry.connection?.client
        if (!client) return
        try {
          const read = await readNodeAttention(client, entry.target)
          if (entry.removed || entry.connection?.state?.value !== 'connected') return
          entry.state = 'online'
          entry.rows = read.rows
          entry.unreadable = read.unreadable
        } catch (error) {
          if (entry.removed || entry.connection?.state?.value !== 'connected') return
          console.debug('[Abele agents] node sessions unavailable', {
            node: entry.target.id,
            error: error instanceof Error ? error.message : String(error),
          })
          entry.state = 'failed'
          entry.rows = []
          entry.unreadable = 0
        }
        this.changed()
      } while (entry.again && !entry.removed)
    })().finally(() => {
      entry.loading = undefined
    })
    return entry.loading
  }

  /** Session rows of connected nodes, and one line for each node that is not listed. */
  rows(): AttentionRow[] {
    const rows: AttentionRow[] = []
    for (const entry of this.watched.values()) {
      rows.push(...entry.rows)
      if (entry.state === 'online' && !entry.unreadable) continue
      const { target } = entry
      const text =
        entry.state === 'online'
          ? `${entry.unreadable} ${entry.unreadable === 1 ? 'session' : 'sessions'} could not be read`
          : TEXT[entry.state]
      rows.push({
        key: `node-coverage:${target.id}`,
        reference: {
          kind: 'node',
          registrationId: target.id,
          nodeId: target.expectedNodeId,
          sessionId: '',
        },
        title: target.label,
        agent: 'Node',
        source: `Node · ${target.label}`,
        ...(entry.state === 'offline' ? { offline: true } : {}),
        reasons: [{ kind: 'delivery', id: `node-coverage:${target.id}`, at: 0, text }],
      })
    }
    return rows
  }

  get incomplete(): boolean {
    return [...this.watched.values()].some((e) => e.state !== 'online' || e.unreadable > 0)
  }

  destroy(): void {
    if (this.timer !== undefined) window.clearInterval(this.timer)
    this.timer = undefined
    for (const entry of this.watched.values()) {
      entry.removed = true
      entry.stop?.()
    }
    this.watched.clear()
  }
}
