import { NodeEventSchema } from '@abele/node-protocol'
import type { NodeClientState } from './NodeClientStore'
import { SESSION_WINDOW } from './sessionWindow'

type Events = NodeClientState['events'][string]
type Snapshot = { revision: string; events: Events }

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result)
    value.onerror = () => reject(value.error)
  })
}

/** Session journals are paged from the node; mailbox and other control streams stay intact. */
function retained(state: NodeClientState, stream: string, events: Events): Events {
  let keep = state.windows?.[stream]
  if (
    keep === undefined &&
    events.some((event) => {
      const session = (event.data as { session_id?: unknown } | null)?.session_id
      // Catalogs announce other sessions too; only the session's own stream is windowed.
      if (typeof session === 'string' && session !== event.stream_id) return false
      return event.type === 'session.created'
        ? session === event.stream_id
        : ['session.update', 'input.accepted'].includes(event.type)
    })
  ) {
    // Persist the classification: the identifying event itself will leave the window.
    ;(state.windows ??= {})[stream] = keep = SESSION_WINDOW
  }
  return keep && events.length > keep ? events.slice(-keep) : events
}

/**
 * One record per stream, with a small revision manifest alongside client metadata. Cached
 * snapshots are immutable; each callback clones only the streams it actually inspects.
 * IndexedDB's transaction lock makes the manifest and journals one atomic snapshot.
 */
export class ClientJournal {
  private snapshots = new Map<string, Snapshot>()

  async load(tx: IDBTransaction, state: NodeClientState) {
    const client = tx.objectStore('client')
    const journal = tx.objectStore('journal')
    const revisions = ((await request(client.get('streams'))) ?? {}) as Record<string, string>
    const snapshots = new Map<string, Snapshot>()
    await Promise.all(
      Object.entries(revisions).map(async ([stream, revision]) => {
        const cached = this.snapshots.get(stream)
        snapshots.set(
          stream,
          cached?.revision === revision
            ? cached
            : {
                revision,
                events: ((await request(journal.get(stream))) as unknown[]).map((event) =>
                  NodeEventSchema.parse(event)
                ),
              }
        )
      })
    )
    const events: NodeClientState['events'] = {}
    const assign = (stream: string, value: Events) =>
      Object.defineProperty(events, stream, {
        configurable: true,
        enumerable: true,
        writable: true,
        value,
      })
    for (const [stream, snapshot] of snapshots) {
      Object.defineProperty(events, stream, {
        configurable: true,
        enumerable: true,
        get: () => {
          const copy = structuredClone(retained(state, stream, snapshot.events))
          assign(stream, copy)
          return copy
        },
        set: (value: Events) => {
          assign(stream, value)
        },
      })
    }
    state.events = events
    return {
      save: () => {
        const current = state.events
        let changed = false
        for (const stream of snapshots.keys()) {
          if (Object.hasOwn(current, stream)) continue
          journal.delete(stream)
          delete revisions[stream]
          snapshots.delete(stream)
          changed = true
        }
        for (const stream of Object.keys(current)) {
          if (current === events && Object.getOwnPropertyDescriptor(current, stream)?.get) continue
          const next = retained(state, stream, current[stream])
          const previous = snapshots.get(stream)
          if (previous && JSON.stringify(next) === JSON.stringify(previous.events)) continue
          const revision = crypto.randomUUID()
          revisions[stream] = revision
          journal.put(next, stream)
          snapshots.set(stream, { revision, events: structuredClone(next) })
          changed = true
        }
        if (changed) client.put(revisions, 'streams')
      },
      committed: () => {
        this.snapshots = snapshots
      },
    }
  }

  /** Called only inside the version upgrade, so failure leaves the legacy store intact. */
  static migrate(tx: IDBTransaction, state: NodeClientState): void {
    const revisions: Record<string, string> = {}
    for (const [stream, events] of Object.entries(state.events)) {
      tx.objectStore('journal').put(retained(state, stream, events), stream)
      revisions[stream] = crypto.randomUUID()
    }
    tx.objectStore('client').put({ ...state, events: {} }, 'state')
    tx.objectStore('client').put(revisions, 'streams')
  }
}
