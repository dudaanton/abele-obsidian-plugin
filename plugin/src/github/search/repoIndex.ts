/**
 * A repository at one commit, held in memory as text so it can be searched without asking
 * GitHub again: what a code search, a definition lookup and `github_grep` all read.
 *
 * Built from the archive GitHub sends for that commit. Binary files and files past a size are
 * listed by name but not kept, and the whole index is only as long-lived as the session: a few
 * of them are cached, the least recently used dropped first, under a cap on the memory they take.
 */
import { readTar, stripRoot } from './tar'
import { compileQuery, globMatcher, searchText, type CodeQuery, type LineMatch } from './textSearch'

export interface IndexedFile {
  path: string
  text: string
}

export interface IndexOptions {
  /** A file larger than this is named but not searched. */
  maxFileBytes?: number
}

/** A megabyte of source is a generated file or a data dump, not something to read for code. */
export const MAX_FILE_BYTES = 1024 * 1024

/** Bytes checked for a zero byte, the way git decides a file is binary. */
const SNIFF = 8000

export const isBinary = (data: Uint8Array): boolean => data.subarray(0, SNIFF).includes(0)

export interface FileHits {
  path: string
  matches: LineMatch[]
}

export interface SearchResult {
  files: FileHits[]
  /** Matching lines found, which may be more than were returned. */
  total: number
  /** Stopped at the limit: there are more. */
  capped: boolean
  /** Files looked at. */
  searched: number
}

export interface SearchOptions {
  glob?: string
  /** Matching lines to return at most. */
  limit?: number
  /** Matching lines per file at most, so one noisy file does not fill the page. */
  perFile?: number
  signal?: AbortSignal
}

const decoder = new TextDecoder('utf-8', { fatal: false })

/** Yields to the event loop now and then, so a long search does not freeze the tab. */
const breathe = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0))

export class RepoIndex {
  readonly files: IndexedFile[] = []
  /** Every file's path, the binary and oversized ones included. */
  readonly paths: string[] = []
  binary = 0
  oversized = 0
  /** What the texts take in memory, roughly: two bytes a character. */
  bytes = 0

  static fromTar(tar: Uint8Array, options: IndexOptions = {}): RepoIndex {
    const max = options.maxFileBytes ?? MAX_FILE_BYTES
    const index = new RepoIndex()
    for (const entry of readTar(tar)) {
      const path = stripRoot(entry.path)
      if (!path) continue
      index.paths.push(path)
      if (entry.data.length > max) {
        index.oversized++
        continue
      }
      if (isBinary(entry.data)) {
        index.binary++
        continue
      }
      index.add(path, decoder.decode(entry.data))
    }
    return index
  }

  add(path: string, text: string): void {
    this.files.push({ path, text })
    this.bytes += text.length * 2 + path.length * 2
  }

  file(path: string): IndexedFile | undefined {
    return this.files.find((f) => f.path === path)
  }

  /** Matching lines across the files the glob admits, in path order. */
  async search(query: CodeQuery, options: SearchOptions = {}): Promise<SearchResult> {
    return searchFiles(this.files, query, options)
  }
}

/** The same search over any list of files — a pull request's changed files, say. */
export async function searchFiles(
  files: IndexedFile[],
  query: CodeQuery,
  options: SearchOptions = {}
): Promise<SearchResult> {
  const re = compileQuery(query)
  const admits = globMatcher(options.glob)
  const limit = options.limit ?? 500
  const perFile = options.perFile ?? 50
  const out: FileHits[] = []
  let total = 0
  let returned = 0
  let searched = 0
  let capped = false
  let sinceBreath = 0

  for (const file of files) {
    if (options.signal?.aborted) throw new DOMException('Search cancelled', 'AbortError')
    if (!admits(file.path)) continue
    searched++
    sinceBreath += file.text.length
    if (sinceBreath > 2_000_000) {
      sinceBreath = 0
      await breathe()
    }
    const matches = searchText(file.text, re, perFile + 1)
    if (matches.length === 0) continue
    total += matches.length
    if (capped) continue
    const room = limit - returned
    const kept = matches.slice(0, Math.min(perFile, room))
    returned += kept.length
    if (kept.length < matches.length) capped = true
    if (kept.length) out.push({ path: file.path, matches: kept })
    if (returned >= limit) capped = true
  }
  return { files: out, total, capped, searched }
}

/**
 * The indexes built this session. Keyed by host, repository and full commit SHA — a commit's
 * files never change, so an index is never stale, only old.
 */
export class IndexCache {
  private entries = new Map<string, RepoIndex>()

  constructor(
    private readonly maxEntries = 4,
    private readonly maxBytes = 400 * 1024 * 1024
  ) {}

  get(key: string): RepoIndex | undefined {
    const hit = this.entries.get(key)
    if (hit) {
      // Map order is insertion order: re-inserting makes it the most recent.
      this.entries.delete(key)
      this.entries.set(key, hit)
    }
    return hit
  }

  set(key: string, index: RepoIndex): void {
    this.entries.delete(key)
    this.entries.set(key, index)
    while (
      this.entries.size > 1 &&
      (this.entries.size > this.maxEntries || this.totalBytes() > this.maxBytes)
    ) {
      const oldest = this.entries.keys().next().value as string
      this.entries.delete(oldest)
    }
  }

  totalBytes(): number {
    let n = 0
    for (const index of this.entries.values()) n += index.bytes
    return n
  }

  keys(): string[] {
    return [...this.entries.keys()]
  }

  clear(): void {
    this.entries.clear()
  }
}

export const indexKey = (host: string, owner: string, repo: string, sha: string) =>
  `${host}/${owner}/${repo}@${sha}`.toLowerCase()
