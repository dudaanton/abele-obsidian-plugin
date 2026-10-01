/** File attribution at a ref, scoped to the exact client (and therefore its connection/token). */
import { GithubError, type GithubClient } from './client'
import type { CommitSummary } from './api'

export interface BlameRange {
  start: number
  end: number
  commit: CommitSummary
}

interface FileRef {
  owner: string
  repo: string
  ref: string
  path: string
}

const QUERY = `query($owner: String!, $repo: String!, $ref: String!, $path: String!) {
  repository(owner: $owner, name: $repo) {
    object(expression: $ref) {
      ... on Commit {
        blame(path: $path) {
          ranges { startingLine endingLine commit {
            oid message committedDate author { name avatarUrl user { login avatarUrl } }
          } }
        }
      }
    }
  }
}`

interface Answer {
  repository?: {
    object?: {
      blame?: {
        ranges: {
          startingLine: number
          endingLine: number
          commit: {
            oid: string
            message: string
            committedDate: string
            author?: {
              name?: string
              avatarUrl?: string
              user?: { login: string; avatarUrl?: string } | null
            } | null
          }
        }[]
      }
    } | null
  } | null
}

// Branch refs can move. Keep them briefly, and bound memory even when many files are visited.
const TTL = 60_000
const LIMIT = 32
const caches = new WeakMap<
  GithubClient,
  Map<string, { at: number; value: Promise<BlameRange[]> }>
>()

export function loadBlame(client: GithubClient, file: FileRef): Promise<BlameRange[]> {
  let cache = caches.get(client)
  if (!cache) caches.set(client, (cache = new Map()))
  const { owner, repo, ref, path } = file
  const key = JSON.stringify([owner, repo, ref, path])
  const found = cache.get(key)
  if (found && Date.now() - found.at < TTL) return found.value
  const value = client
    .graphql<Answer>(QUERY, { owner, repo, ref, path }, "the file's line blame")
    .then((data) => {
      const raw = data.repository?.object?.blame?.ranges
      if (!raw)
        throw new GithubError('not-found', 'GitHub found no line blame for this file at this ref.')
      const ranges: BlameRange[] = []
      for (const r of raw) {
        const c = r.commit
        const previous = ranges[ranges.length - 1]
        if (previous && previous.end + 1 === r.startingLine && previous.commit.sha === c.oid) {
          previous.end = r.endingLine
          continue
        }
        ranges.push({
          start: r.startingLine,
          end: r.endingLine,
          commit: {
            sha: c.oid,
            message: c.message,
            date: c.committedDate,
            author: c.author?.user?.login ?? c.author?.name ?? 'unknown',
            login: c.author?.user?.login,
            avatar: c.author?.user?.avatarUrl ?? c.author?.avatarUrl,
          },
        })
      }
      return ranges
    })
    .catch((error: unknown) => {
      if (cache.get(key)?.value === value) cache.delete(key)
      throw error
    })
  cache.delete(key)
  cache.set(key, { at: Date.now(), value })
  if (cache.size > LIMIT) cache.delete(cache.keys().next().value!)
  return value
}

/** Binary lookup for a visible line: no array of one marker per source line. */
export function rangeAt(ranges: readonly BlameRange[], line: number): BlameRange | null {
  let low = 0
  let high = ranges.length - 1
  while (low <= high) {
    const mid = (low + high) >>> 1
    const range = ranges[mid]
    if (line < range.start) high = mid - 1
    else if (line > range.end) low = mid + 1
    else return range
  }
  return null
}
