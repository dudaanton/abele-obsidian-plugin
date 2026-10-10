import { type RunSource } from './ScriptRuns'

import type { FormField } from './types'

import type { BookScriptContext } from './bookContext'
import { type SelectionScriptContext } from './selectionContext'

import type { RestoreInfo, ViewHost } from './view/View'
import type { AutomationEvent } from '@/automations/types'

/**
 * How to run a script, beyond which one and with what.
 *
 * `execute` used to take these as trailing arguments and still does — an `AbortSignal` in the
 * third place means the same as it always did — so nothing that called it before has to change.
 */
export interface ExecuteOptions {
  /** Explicit user gesture only. Agent, automation, nested and restored runs never prompt. */
  allowApprovalPrompt?: boolean
  signal?: AbortSignal
  /**
   * Shows the script's form and answers with what was filled in, or `null` if it was dismissed.
   *
   * The run's id travels with it, which is what lets a caller that cannot *show* a form —
   * an agent — park the question against the run and answer it later.
   */
  formHandler?: (
    fields: FormField[],
    runId: string,
    signal?: AbortSignal
  ) => Promise<Record<string, string> | null>
  /** Who asked for the run, for the list of runs. Assumed to be an agent when unsaid: that is
   * the one caller that cannot be given a better answer from inside. */
  source?: RunSource
  /** A saved tab being rebuilt: the leaf waiting for the view and the state it kept. */
  restore?: RestoreInfo
  /** An embedded view uses the same component kit without opening a workspace leaf. */
  viewHost?: ViewHost
  /** What set the run off, when an automation did — the script's `event`. */
  event?: AutomationEvent
  /** Told each path the script is about to write; see `buildScriptContext`. */
  onWrite?: (path: string) => void
  /** The message an interceptor script decides about, and the chat around it. */
  intercept?: { message: unknown; chat: unknown }
  /** What started the run, in words, for the list of runs: "Task completed · Tasks/Milk.md". */
  trigger?: string
  /** The words in a book the run was asked for from; the script reads it as `book`. */
  book?: BookScriptContext
  /** Immutable source and durable backlink, also retained for reruns. */
  selection?: SelectionScriptContext
}

/** What came of asking an agent's script to run: it finished, or it stopped to ask something. */
export type ScriptOutcome =
  | { kind: 'done'; output: string }
  | { kind: 'form'; runId: string; fields: FormField[] }
