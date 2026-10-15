/**
 * Several interceptors in a row: each is given what the one before it returned.
 *
 * The runner knows only the order and the patterns. What one interceptor does with the text — a
 * script deciding, an agent reviewing, a reply-only comment beside it — is the caller's `step`,
 * which either passes a text on to the next one or stops the chain there. An entry whose pattern
 * does not match the text it would be given is skipped; one whose pattern does not compile reads
 * it anyway and says why (`broken`).
 */
import type { InterceptorEntry } from '../agents/types'
import { matchesPattern } from './pattern'

/** One interceptor's turn: who, and where it stands among those reading this side. */
export interface ChainStep {
  entry: InterceptorEntry
  /** Its place among the `of` that read this side, from 1. */
  at: number
  of: number
  broken?: string
}

export type StepResult<T> = { kind: 'pass'; text: string } | { kind: 'stop'; result: T }

export type ChainResult<T> =
  /** Every interceptor that read it let it through; `text` is what the last one returned. */
  | { kind: 'done'; text: string }
  /** One stopped it: held it, failed, or answered in its place. `at` is its place, from 1. */
  | { kind: 'stopped'; at: number; entry: InterceptorEntry; result: T }

/**
 * Runs `chain` from the entry at `from` (0-based), one after another, never two at once.
 * `step` is not called for an entry whose pattern does not match the text it would get.
 */
export async function runChain<T>(
  chain: readonly InterceptorEntry[],
  from: number,
  text: string,
  step: (at: ChainStep, text: string) => Promise<StepResult<T>>
): Promise<ChainResult<T>> {
  let current = text
  for (let i = Math.max(0, from); i < chain.length; i++) {
    const entry = chain[i]
    const { matches, broken } = matchesPattern(entry.pattern, current)
    if (!matches) continue
    const outcome = await step(
      { entry, at: i + 1, of: chain.length, ...(broken ? { broken } : {}) },
      current
    )
    if (outcome.kind === 'stop')
      return { kind: 'stopped', at: i + 1, entry, result: outcome.result }
    current = outcome.text
  }
  return { kind: 'done', text: current }
}

/** Whether any entry from `from` on would read `text` at all, judged on the text as it is now. */
export function anyReads(chain: readonly InterceptorEntry[], text: string, from = 0): boolean {
  return chain.slice(from).some((e) => matchesPattern(e.pattern, text).matches)
}

/** Where an entry stands now, by its id, or by its old place when it is gone. */
export function placeOf(
  chain: readonly InterceptorEntry[],
  wait: { entry: string; at: number }
): number {
  const byId = chain.findIndex((e) => e.id === wait.entry)
  return byId >= 0 ? byId : Math.min(wait.at - 1, chain.length)
}
