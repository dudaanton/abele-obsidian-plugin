/**
 * Searching only what a pull request or a commit changed: the diffs the tab already loaded,
 * and — for a file GitHub sends no diff for because it is too large — the file itself at the
 * change's commit, fetched once.
 *
 * A match in a diff is reported by the number the line has in the file: the new side for an
 * added or unchanged line, the old side for a removed one, which is how a `#diff-…R42` link
 * names it.
 */
import type { DiffFile } from '../api'
import { parsePatch } from '../patch'
import { compileQuery, globMatcher, searchText, type CodeQuery, type LineMatch } from './textSearch'

export interface ChangeMatch extends LineMatch {
  /** Which side of the diff the line is on: `L` a removed line, `R` the rest. */
  side: 'L' | 'R'
}

export interface ChangeHits {
  path: string
  /** `#diff-<hash>`, for the link that opens the diff there. */
  hash: string
  matches: ChangeMatch[]
}

export interface ChangeSearch {
  files: ChangeHits[]
  total: number
  capped: boolean
}

/** A file whose diff GitHub left out, read whole at the change's commit; null when it cannot be. */
export type FetchWhole = (path: string) => Promise<string | null>

/** Files without a diff fetched whole, at most — each is a request. */
const MAX_FETCHED = 20

export async function searchChanges(
  files: DiffFile[],
  query: CodeQuery,
  options: { glob?: string; limit?: number; fetchWhole?: FetchWhole } = {}
): Promise<ChangeSearch> {
  const re = compileQuery(query)
  const admits = globMatcher(options.glob)
  const limit = options.limit ?? 500
  const out: ChangeHits[] = []
  let total = 0
  let fetched = 0

  for (const file of files) {
    if (!admits(file.path)) continue
    let matches: ChangeMatch[] = []
    if (file.patch) {
      const lines = parsePatch(file.patch)
      const doc = lines.map((l) => l.text).join('\n')
      for (const m of searchText(doc, re)) {
        const line = lines[m.line - 1]
        if (!line || line.type === 'hunk' || line.type === 'note') continue
        const side = line.type === 'del' ? 'L' : 'R'
        const n = side === 'L' ? line.old : line.new
        if (n !== undefined) matches.push({ ...m, line: n, side })
      }
    } else if (file.status !== 'removed' && options.fetchWhole && fetched < MAX_FETCHED) {
      fetched++
      const text = await options.fetchWhole(file.path).catch((): null => null)
      if (text !== null)
        matches = searchText(text, re).map((m): ChangeMatch => ({ ...m, side: 'R' }))
    }
    if (!matches.length) continue
    total += matches.length
    const room = limit - out.reduce((n, f) => n + f.matches.length, 0)
    if (room <= 0) continue
    out.push({ path: file.path, hash: file.hash, matches: matches.slice(0, room) })
  }
  const returned = out.reduce((n, f) => n + f.matches.length, 0)
  return { files: out, total, capped: returned < total }
}
