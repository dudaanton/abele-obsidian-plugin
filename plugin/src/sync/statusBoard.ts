import { ref, type Ref } from 'vue'
import type { SyncFailure } from '@abele/sync-core'
import { messageOf } from './messages'
import { DISCONNECTED_STATUS, type SyncStatus } from './status'

/**
 * What sync says to the person: the one status the status bar and the settings screens show,
 * who is told when it moves, and the log.
 *
 * Kept apart from the engine's lifecycle because it outlives every engine: a teardown and a
 * build publish into the same status, and the log carries the lines of all of them.
 */

/** How many lines the log keeps. Older ones fall off the front. */
const LOG_LINES = 500

/**
 * What the user has to do about a token the server no longer takes. The client's own message
 * says the request was refused, which is true and no help at all.
 */
const REVOKED_HINT =
  'this device was revoked or its token is no longer taken; connect again from the Sync settings'

export class StatusBoard {
  /** The status, for the status bar and the settings screens. */
  readonly status: Ref<SyncStatus> = ref({ ...DISCONNECTED_STATUS })

  /** The last {@link LOG_LINES} lines, oldest first. Every one of them is a `console.debug` too. */
  readonly log: Ref<string[]> = ref([])

  private readonly listeners = new Set<(status: SyncStatus) => void>()
  /** What the last failure was, which is how `publish` knows to say what to do about it. */
  private lastFailure: SyncFailure | null = null

  /** Called with the status whenever it changes. The returned function unsubscribes. */
  onStatusChange(cb: (status: SyncStatus) => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  /** Nobody is told any more: the service is going away. */
  clearListeners(): void {
    this.listeners.clear()
  }

  /**
   * Adds a line to the log the way the engine's own lines are added.
   *
   * The service writes what happens around the engine through it — connecting, enrolling,
   * disconnecting — and so may a screen that does something worth recording.
   */
  note(text: string): void {
    console.debug(`[abele-sync] ${text}`)
    const lines = this.log.value
    lines.push(`${new Date().toISOString()} ${text}`)
    // In place rather than as a new array: a sync writes dozens of lines, and copying five
    // hundred of them each time is work for nothing. Vue tracks the mutation either way.
    if (lines.length > LOG_LINES) lines.splice(0, lines.length - LOG_LINES)
  }

  publish(raw: SyncStatus): void {
    const status = this.explain(raw)
    // A settings save that changed nothing about sync still reaches here, and a status that has
    // not moved must not repaint the status bar or wake `runAfterSync`.
    const held = this.status.value
    const same = (Object.keys(status) as Array<keyof SyncStatus>).every(
      (key) => held[key] === status[key]
    )
    if (same) return
    this.status.value = status
    for (const listener of [...this.listeners]) {
      try {
        listener(status)
      } catch (error) {
        console.debug('[abele-sync] a status listener threw', error)
      }
    }
  }

  /**
   * A failure the engine has already logged and turned into a status. Only a refused token
   * needs anything more said: no retry will change it, and the user has to enrol again.
   *
   * The kind is remembered rather than acted on here, because the engine writes its own
   * `lastError` *after* this hook returns; `explain` is where the message is replaced.
   */
  failed(error: unknown, kind: SyncFailure): void {
    this.lastFailure = kind
    if (kind !== 'unauthorized') return
    this.note(`${REVOKED_HINT} (the server said: ${messageOf(error)})`)
  }

  /** The engine that failed is gone; its failure must not colour the next one's message. */
  forgetFailure(): void {
    this.lastFailure = null
  }

  /**
   * The status as a person can act on it.
   *
   * A refused token comes off the wire as "the request was refused", which is true and no help;
   * the tooltip and the settings screen get the sentence that says what to do instead. Anything
   * that is not an error clears the memory of the last failure.
   */
  private explain(status: SyncStatus): SyncStatus {
    if (status.state !== 'error') {
      this.lastFailure = null
      return status
    }
    if (this.lastFailure !== 'unauthorized') return status
    return { ...status, lastError: REVOKED_HINT }
  }
}
