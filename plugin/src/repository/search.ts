import type { DiffFile } from './conversation'

export interface CodeQuery {
  text: string
  regex?: boolean
  caseSensitive?: boolean
  /** Only whole words — for "find references". */
  wholeWord?: boolean
}

export interface LineMatch {
  /** 1-based. */
  line: number
  /** 0-based, in UTF-16 units of the line. */
  column: number
  length: number
  /** The line itself, cut to a readable length around the match. */
  text: string
}

export interface DefinitionHit extends LineMatch {
  path: string
}

export type Scope = 'changes' | 'repo' | 'names'

export interface TabChanges {
  files: DiffFile[]
  /** The link to a changed file, or a line in it: the pull request's files, or the commit. */
  lineUrl(hash: string, side?: 'L' | 'R', line?: number): string
}

export type Stage = 'listing' | 'downloading' | 'unpacking' | 'indexing'

export interface LineSpan {
  from: number
  to: number
}
