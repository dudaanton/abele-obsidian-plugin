import { ref, type Ref } from 'vue'
import type { HeldDelete } from '@abele/sync-core'
import type { SyncStatus } from './status'

/**
 * Many files deleted at once on this device, held back by the engine until somebody decides
 * (phase 3b, decision 8): what the plugin knows of the hold, and when it asks about it.
 *
 * The engine holds a delete until it is decided — a hold is sticky — and a hold grows when more
 * deletes trip the guard. So the question is asked once per new *set* of held files, not per
 * count: a hold that grew holds files nobody was shown, and is asked about again, with all of
 * them; the same hold seen again after a sync, or one that shrank because files came back, asks
 * nothing new. A question is asked only while the app is in front — on a phone a hold found by
 * a sync in the background is asked about when the app comes back.
 */

/** A question about held deletes: the files shown, and a key for the dialog that shows them. */
export interface HeldQuestion {
  key: number
  held: HeldDelete[]
}

/** A decision filed but not carried out yet — sync paused, or the run after it failed. */
export interface FiledDecision {
  kind: 'confirm' | 'restore'
  /** How many files it covers. */
  count: number
}

/** What the prompt is handed by the service. */
export interface HeldHost {
  /** The deletes the running engine holds; none without an engine. */
  list(): Promise<HeldDelete[]>
  /** Whether the app is in front, where a dialog can be seen. */
  visible(): boolean
  /** Hand a decision to the running engine (`EngineRunner.decideDeletes`); null without one. */
  decide(
    kind: FiledDecision['kind'],
    fileIds: readonly string[]
  ): Promise<{ decided: number; applied: boolean } | null>
  /** A line for the sync log. */
  note(text: string): void
}

export class HeldDeletesPrompt {
  /** What is held now, for the Sync tab; empty when nothing is. */
  readonly held: Ref<HeldDelete[]> = ref([])
  /** The question the dialog shows, or null while none is open. */
  readonly asking: Ref<HeldQuestion | null> = ref(null)
  /**
   * The answer given and filed, waiting for a sync to carry it out, or null (task-10 review,
   * #4). The hold is unchanged until then, so without this the Sync tab would show the same
   * question as if nobody had answered it; answering again replaces this one.
   */
  readonly decided: Ref<FiledDecision | null> = ref(null)
  /** The files `decided` covers: it is let go once none of them is held any more. */
  private decidedIds = new Set<string>()

  /** Every file id a question has shown, since nothing was last held. */
  private readonly shown = new Set<string>()
  /** The count and the sync the list was last read for: nothing to read again before either moves. */
  private seen = ''
  /** A new set was found while the app was not in front; it is asked when it comes back. */
  private waiting = false
  private asked = 0

  constructor(private readonly host: HeldHost) {}

  /** The status moved: read the hold again when its count or the last sync did. */
  async noticed(status: SyncStatus): Promise<void> {
    const seen = `${status.heldDeletes}:${status.lastSyncAt ?? ''}`
    if (seen === this.seen) return
    this.seen = seen
    if (status.heldDeletes === 0) {
      this.clear()
      return
    }
    await this.refresh()
  }

  /** Read the hold again, and ask when it holds anything nobody was shown. */
  async refresh(): Promise<void> {
    let list: HeldDelete[]
    try {
      list = await this.host.list()
    } catch (error) {
      console.debug('[abele-sync] the held deletes could not be read', error)
      return
    }
    this.held.value = list
    if (list.length === 0) {
      this.clear()
      return
    }
    if (this.decided.value !== null && !list.some((one) => this.decidedIds.has(one.fileId))) {
      this.settled()
    }
    if (!list.some((one) => !this.shown.has(one.fileId))) return
    if (this.host.visible()) this.ask()
    else this.waiting = true
  }

  /** The app came to the front: a question that waited for it is asked now. */
  foreground(): void {
    if (this.waiting && this.held.value.length > 0 && this.host.visible()) this.ask()
  }

  /**
   * A decision was handed to the engine, which decided `result.decided` of `fileIds` — those
   * still held. One a sync carried out is done with; one it did not is shown as waiting, counted
   * as the engine counted it. Answers whether it replaced an earlier answer still waiting — the
   * engine keeps only the last word.
   */
  filed(
    kind: FiledDecision['kind'],
    fileIds: readonly string[],
    result: { decided: number; applied: boolean; completed?: number }
  ): boolean {
    const replaced = this.decided.value !== null
    if (result.applied || result.completed !== undefined) {
      this.settled()
      return replaced
    }
    const held = new Set(this.held.value.map((one) => one.fileId))
    this.decided.value = { kind, count: result.decided }
    this.decidedIds = new Set(fileIds.filter((id) => held.has(id)))
    return replaced
  }

  /** See `SyncService.decideDeletes`: the decision, filed, and the hold read again. */
  async decide(
    kind: FiledDecision['kind'],
    fileIds: readonly string[]
  ): Promise<{ decided: number; applied: boolean } | null> {
    const verb = kind === 'confirm' ? 'deleting everywhere' : 'putting back'
    this.host.note(`${verb} ${fileIds.length} held file(s)`)
    const result = await this.host.decide(kind, fileIds)
    if (result !== null && result.decided > 0) {
      const replaced = this.filed(kind, fileIds, result)
      if (replaced && !result.applied) {
        this.host.note(
          'this answer replaces the answer given before, which was not carried out yet'
        )
      }
    }
    await this.refresh()
    return result
  }

  /**
   * Ask about everything held now, in the dialog. Called when a hold holds files no question has
   * shown; the Sync tab asks nothing, it shows the same answers inline for as long as they are held.
   */
  ask(): void {
    const held = this.held.value
    if (held.length === 0) return
    for (const one of held) this.shown.add(one.fileId)
    this.waiting = false
    this.asking.value = { key: ++this.asked, held: [...held] }
  }

  /** The dialog closed, answered or not: the hold stays until it is decided. */
  close(): void {
    this.asking.value = null
  }

  /** The decision waiting was carried out, or given up: nothing is shown as waiting. */
  private settled(): void {
    this.decided.value = null
    this.decidedIds = new Set()
  }

  /** Nothing is held: forget what was shown, so a hold made later is asked about afresh. */
  private clear(): void {
    this.held.value = []
    this.asking.value = null
    this.shown.clear()
    this.waiting = false
    this.settled()
  }
}

/** `3 files`, `1 file`. */
const filesOf = (count: number): string => (count === 1 ? '1 file' : `${count} files`)

/**
 * What is said once a decision about held deletes was taken: `result` as
 * `SyncService.decideDeletes` answered, and `state` the status sync was left in. A decision a
 * sync did not carry out — paused, offline, failing — is filed, and is carried out by the next
 * sync that gets through; saying it was done would send somebody looking for a result that is
 * not there yet.
 */
export function decidedNotice(
  kind: 'confirm' | 'restore',
  result: { decided: number; applied: boolean; completed?: number } | null,
  state: SyncStatus['state']
): string {
  if (result === null) return 'Sync is not running on this device, so nothing was decided.'
  if (result.decided === 0) return 'These files are no longer held, so nothing was decided.'
  if (kind === 'confirm' && result.completed !== undefined) {
    const completed = result.completed
    return (
      `${filesOf(completed)} ${completed === 1 ? 'was' : 'were'} deleted everywhere; ` +
      `${filesOf(result.decided - completed)} were not deleted (changed or refused). See the sync log.`
    )
  }
  const files = filesOf(result.decided)
  const one = result.decided === 1
  if (result.applied) {
    return kind === 'confirm'
      ? `${files} ${one ? 'was' : 'were'} deleted everywhere. The server keeps ${one ? 'it' : 'them'} in Deleted files until the trash is swept.`
      : `${files} ${one ? 'is' : 'are'} coming back.`
  }
  const when = state === 'paused' ? 'when sync is resumed' : 'at the next sync that gets through'
  return kind === 'confirm'
    ? `${files} will be deleted everywhere ${when}.`
    : `${files} will come back ${when}.`
}
