/**
 * The version a tab's links into the repository stay at: a pull request's head commit, a
 * commit's own SHA, the branch, tag or commit a file or a folder was read at. So a folder opened
 * from a pull request's diff, or a file from the tree beside a file, is the code that was being
 * read — not whatever the default branch holds now. An issue or a discussion names no version:
 * for those it is the default branch, which has to be asked for (null here).
 */
import type { GithubTarget } from '../urls'

export function linkRef(shown: GithubTarget, data: unknown): string | null {
  if (!data) return null
  const d = data as { headSha?: string; sha?: string; ref?: string }
  switch (shown.kind) {
    case 'pull':
      return d.headSha || null
    case 'commit':
      return d.sha || shown.sha
    case 'blob':
    case 'tree':
      return d.ref || null
    default:
      return null
  }
}
