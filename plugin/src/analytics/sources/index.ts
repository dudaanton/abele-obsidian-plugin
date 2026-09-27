/**
 * Where the analytics tools get their tables: `{ kind: 'finance' | 'notes' | 'base', … }`, read
 * from the running vault, each row checked against the chat's scope.
 */
import type { App } from 'obsidian'
import { readBase, type BaseSource } from './base'
import { readFinance, type FinanceSource } from './finance'
import { readNotes, type NotesSource } from './notes'
import type { Table } from '../table'

export type SourceSpec = FinanceSource | NotesSource | BaseSource
export type { FinanceSource, NotesSource, BaseSource }

export interface SourceDeps {
  app: App
  inScope: (path: string) => boolean
  today: string
  /** The Bases view id the base probe borrows. */
  probeType: string
}

export async function readSource(spec: unknown, deps: SourceDeps): Promise<Table> {
  if (!spec || typeof spec !== 'object') {
    throw new Error('`source` has to be an object: { kind: "finance" | "notes" | "base", … }.')
  }
  const s = spec as SourceSpec
  switch (s.kind) {
    case 'finance':
      return readFinance(s, deps)
    case 'notes':
      return readNotes(s, deps)
    case 'base':
      if (!s.path) throw new Error('A base source needs `path`, the .base file.')
      return readBase(s, deps)
    default:
      throw new Error(
        `Unknown source kind ${JSON.stringify((s as { kind?: unknown }).kind)}. Use "finance", "notes" or "base".`
      )
  }
}
