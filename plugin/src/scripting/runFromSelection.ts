import type { ChatSelectionSnapshot } from '@/selection/types'
import type { BookScriptContext } from './bookContext'
import { bookSelection, captureSelection, type SelectionScriptContext } from './selectionContext'
import type { ParsedScript } from './types'
import { waitForScript } from './abort'

export type SelectionRunSource = 'book' | 'chat-selection'

export type PreparedChatSelection =
  | {
      readonly status: 'ready'
      readonly anchorId: string
      readonly backlink: string
      readonly snapshot?: ChatSelectionSnapshot
    }
  | { readonly status: 'conflict'; readonly reason: string }

/**
 * B/C adapter boundary. Validate the exact captured revision/placement and ensure its anchor
 * through the serialized writer, then return the durable backlink. Draft/streaming or stale
 * targets return a conflict; failed saves reject. No quote search or message edits are allowed.
 * Check cancellation before admitting a write. An already-issued save may settle after Stop,
 * but the launch will not expose its backlink or execute with a late result.
 */
export interface ChatSelectionLaunchPort {
  prepare(snapshot: ChatSelectionSnapshot, signal: AbortSignal): Promise<PreparedChatSelection>
}

export type SelectionLaunchTarget =
  | { readonly kind: 'book'; readonly book: BookScriptContext }
  | ({ readonly kind: 'chat'; readonly snapshot: ChatSelectionSnapshot } & ChatSelectionLaunchPort)
  /** Legacy saved messages have no durable IDs yet. Capture source/revision evidence in the
   * adapter before any UI; initialize IDs only after admission and the parameter form. */
  | {
      readonly kind: 'captured-chat'
      readonly text: string
      prepare(signal: AbortSignal): Promise<
        | {
            readonly status: 'ready'
            readonly snapshot: ChatSelectionSnapshot
            readonly anchorId: string
            readonly backlink: string
          }
        | { readonly status: 'conflict'; readonly reason: string }
      >
    }

export interface SelectionExecution {
  readonly source: SelectionRunSource
  readonly selection: SelectionScriptContext
  readonly book?: BookScriptContext
  readonly signal: AbortSignal
}

export interface SelectionLaunchPorts {
  admit(path: string, source: SelectionRunSource, signal: AbortSignal): Promise<ParsedScript>
  showParams(
    script: ParsedScript,
    text: string,
    signal: AbortSignal
  ): Promise<Record<string, unknown> | null>
  execute(
    path: string,
    params: Record<string, unknown>,
    options: SelectionExecution
  ): Promise<string>
  output?(output: string, script: ParsedScript): void
}

export type SelectionLaunchOutcome =
  | { readonly status: 'done'; readonly output: string }
  | { readonly status: 'cancelled' }
  | { readonly status: 'conflict'; readonly reason: string }

/** Book-compatible parameter precedence and conversion, shared by both source types. */
export function selectionParams(
  script: ParsedScript,
  words: string
): { params: Record<string, unknown>; missing: boolean } {
  const params: Record<string, unknown> = {}
  let missing = false
  for (const p of script.meta.params) {
    const value = p.selection && words ? words : p.default
    if (value === undefined || value === '') {
      if (p.required) missing = true
      continue
    }
    if (p.type === 'boolean') params[p.name] = value === 'true'
    else if (p.type === 'number') params[p.name] = Number(value)
    else params[p.name] = value
  }
  return { params, missing }
}

/** One launch; never reads current UI selection after capture or creates an anchor on rerun. */
export async function runFromSelection(
  path: string,
  target: SelectionLaunchTarget,
  ports: SelectionLaunchPorts,
  signal: AbortSignal = new AbortController().signal
): Promise<SelectionLaunchOutcome> {
  const book = target.kind === 'book' ? Object.freeze({ ...target.book }) : undefined
  const snapshot = target.kind === 'chat' ? captureSelection(target.snapshot) : undefined
  // Capture the adapter as well: changing a tab must not change which writer owns this run.
  const prepare: ((signal: AbortSignal) => Promise<PreparedChatSelection>) | undefined =
    target.kind === 'chat'
      ? target.prepare.bind(target, snapshot!)
      : target.kind === 'captured-chat'
        ? target.prepare.bind(target)
        : undefined
  const source = target.kind === 'book' ? 'book' : 'chat-selection'
  const text = target.kind === 'captured-chat' ? target.text : (book?.text ?? snapshot!.text)
  try {
    const script = await waitForScript(() => ports.admit(path, source, signal), signal)
    let { params, missing } = selectionParams(script, text)
    if (missing) {
      const answers = await waitForScript(() => ports.showParams(script, text, signal), signal)
      if (!answers) return { status: 'cancelled' }
      params = answers
    }
    signal.throwIfAborted()
    let selection: SelectionScriptContext
    if (book) selection = bookSelection(book)
    else {
      const prepared = await waitForScript(() => prepare!(signal), signal)
      signal.throwIfAborted()
      if (prepared.status === 'conflict') return prepared
      // A broken adapter is not permission to hand a script an apparently usable source link.
      if (!prepared.anchorId || !prepared.backlink)
        throw new Error('Selection backlink was not saved')
      selection = captureSelection({
        ...(prepared.snapshot ?? snapshot!),
        anchorId: prepared.anchorId,
        backlink: prepared.backlink,
      })
    }
    const output = await waitForScript(
      () => ports.execute(script.path, params, { source, selection, book, signal }),
      signal
    )
    signal.throwIfAborted()
    ports.output?.(output, script)
    return { status: 'done', output }
  } catch (error) {
    if (signal.aborted) return { status: 'cancelled' }
    throw error
  }
}
