import { shallowReactive } from 'vue'
import { commitSha, FolderError } from '../api'
import { GithubError, type GithubClient } from '../client'
import { base64Bytes, repoApiPath } from '../contents'
import { blobCandidates } from '../urls'
import { findNode, type TreeNode } from '../tree/fileTree'
import { repoTree, type RepoTree } from '../tree/repoTree'
import { repositoryKey, type Repository } from './pins'
import { compareTrees, type FileChange } from './trees'
import { decodeBlob, type BlobContent, type TextDiff } from './text'
import { computeDiff } from './compute'

export const AUTOMATIC_BYTES = 1024 * 1024
const MAX_BYTES = 8 * 1024 * 1024
const MAX_CACHE_BYTES = 16 * 1024 * 1024
export interface FileCounts {
  state: 'pending' | 'ready' | 'unavailable'
  additions?: number
  deletions?: number
}
export interface ComparisonIndex {
  baseSha: string
  targetSha: string
  base: RepoTree
  target: RepoTree
  changes: FileChange[]
  counts: Map<string, FileCounts>
}
export interface PinnedFile {
  baseSha: string
  targetSha: string
  path: string
  index: ComparisonIndex
  change: FileChange
  before?: BlobContent
  after?: BlobContent
  text?: TextDiff
  note?: string
  canLoadLarge?: boolean
}
interface SharedRead<T> {
  promise: Promise<T>
  controller: AbortController
  readers: number
  done: boolean
}
const cancelled = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Comparison cancelled', 'AbortError')
}

/** Immutable session data is bounded, deduplicated, and owned by one credential generation. */
export class ComparisonService {
  private readonly indexes = new Map<string, SharedRead<ComparisonIndex>>()
  private readonly blobs = new Map<string, BlobContent>()
  private readonly reading = new Map<string, SharedRead<BlobContent>>()
  private bytes = 0
  private running = 0
  private readonly queue: (() => void)[] = []
  constructor(
    private readonly client: GithubClient,
    private readonly repo: Repository
  ) {}
  clear(): void {
    for (const entry of this.indexes.values()) entry.controller.abort()
    this.indexes.clear()
    this.blobs.clear()
    for (const entry of this.reading.values()) entry.controller.abort()
    this.reading.clear()
    this.bytes = 0
  }
  private check(signal?: AbortSignal): void {
    this.client.assertCurrent()
    cancelled(signal)
  }
  private async limited<T>(read: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    this.check(signal)
    if (this.running >= 3)
      await new Promise<void>((resolve, reject) => {
        const ready = () => {
          signal?.removeEventListener('abort', abort)
          resolve()
        }
        const abort = () => {
          const at = this.queue.indexOf(ready)
          if (at >= 0) this.queue.splice(at, 1)
          reject(new DOMException('Comparison cancelled', 'AbortError'))
        }
        this.queue.push(ready)
        signal?.addEventListener('abort', abort, { once: true })
      })
    else this.running++
    try {
      this.check(signal)
      return await read()
    } finally {
      const next = this.queue.shift()
      if (next) next()
      else this.running--
    }
  }
  /** Resolve the ref before reading its tree. No Contents read is made at a mutable ref. */
  async resolve(
    rest: string[],
    baseSha?: string,
    signal?: AbortSignal
  ): Promise<{ sha: string; path: string; ref: string; kind: 'file' | 'dir' }> {
    let last: unknown
    for (const candidate of blobCandidates(rest).slice(0, 6)) {
      this.check(signal)
      try {
        const sha = await commitSha(this.client, this.repo, candidate.ref)
        if (!/^[a-f\d]{40}$/i.test(sha))
          throw new GithubError('other', 'GitHub did not resolve the target to a commit SHA.')
        const target = await repoTree(this.client, this.repo, sha)
        await target.reveal(candidate.path)
        let node = findNode(target.root, candidate.path)
        if (!node && baseSha) {
          const base = await repoTree(this.client, this.repo, baseSha)
          await base.reveal(candidate.path)
          node = findNode(base.root, candidate.path)
        }
        this.check(signal)
        if (node)
          return {
            sha,
            path: candidate.path,
            ref: candidate.ref,
            kind: node.kind === 'dir' ? 'dir' : 'file',
          }
        last = new GithubError(
          'not-found',
          'The file is absent from both comparison endpoints.',
          404
        )
      } catch (error) {
        if (!(error instanceof GithubError) || error.kind !== 'not-found') throw error
        last = error
      }
    }
    throw last ?? new GithubError('not-found', 'No such file or ref.', 404)
  }
  async index(baseSha: string, targetSha: string, signal?: AbortSignal): Promise<ComparisonIndex> {
    this.check(signal)
    const key = `${baseSha}:${targetSha}`
    let entry = this.indexes.get(key)
    if (!entry) {
      const controller = new AbortController()
      const promise = (async () => {
        const base = await repoTree(this.client, this.repo, baseSha)
        this.check(controller.signal)
        const target = await repoTree(this.client, this.repo, targetSha)
        const changes = await compareTrees(base, target, controller.signal)
        this.check(controller.signal)
        await this.renameMetadata(changes, baseSha, targetSha)
        this.check(controller.signal)
        return {
          baseSha,
          targetSha,
          base,
          target,
          changes,
          counts: shallowReactive(new Map<string, FileCounts>()),
        }
      })()
      entry = { promise, controller, readers: 0, done: false }
      const owned = entry
      this.indexes.set(key, entry)
      void promise.then(
        () => {
          owned.done = true
        },
        () => {
          owned.done = true
          if (this.indexes.get(key) === owned) this.indexes.delete(key)
        }
      )
      while (this.indexes.size > 8) {
        const oldest = this.indexes.keys().next().value!
        const dropped = this.indexes.get(oldest)!
        if (!dropped.readers) dropped.controller.abort()
        this.indexes.delete(oldest)
      }
    }
    entry.readers++
    try {
      const result = await new Promise<ComparisonIndex>((resolve, reject) => {
        const abort = () => reject(new DOMException('Comparison cancelled', 'AbortError'))
        signal?.addEventListener('abort', abort, { once: true })
        void entry.promise
          .then(resolve, reject)
          .finally(() => signal?.removeEventListener('abort', abort))
      })
      this.check(signal)
      return result
    } finally {
      entry.readers--
      if (!entry.done && !entry.readers) {
        entry.controller.abort()
        if (this.indexes.get(key) === entry) this.indexes.delete(key)
      }
    }
  }
  /** One optional compare page, never commit pagination; endpoint trees remain authoritative. */
  private async renameMetadata(changes: FileChange[], base: string, target: string): Promise<void> {
    if (!changes.some((c) => c.status === 'added') || !changes.some((c) => c.status === 'removed'))
      return
    try {
      const answer = await this.client.get<{
        merge_base_commit?: { sha: string }
        files?: { filename: string; previous_filename?: string; status: string; sha?: string }[]
      }>(`${repoApiPath(this.repo)}/compare/${base}...${target}?per_page=1`, {
        what: 'optional rename metadata',
      })
      if (answer.merge_base_commit?.sha !== base) return
      for (const file of answer.files ?? []) {
        if (file.status !== 'renamed' || !file.previous_filename || !file.sha) continue
        const added = changes.find(
          (c) => c.status === 'added' && c.path === file.filename && c.target?.sha === file.sha
        )
        const removed = changes.find(
          (c) => c.status === 'removed' && c.path === file.previous_filename
        )
        if (
          !added ||
          !removed ||
          added.target?.kind !== removed.base?.kind ||
          added.target?.mode !== removed.base?.mode
        )
          continue
        added.status = 'renamed'
        added.base = removed.base
        added.previousPath = removed.path
        changes.splice(changes.indexOf(removed), 1)
      }
    } catch {
      /* Refused, divergent or incomplete metadata never replaces exact tree evidence. */
    }
  }
  private async blob(node?: TreeNode, signal?: AbortSignal): Promise<BlobContent> {
    this.check(signal)
    if (!node) return { kind: 'text', text: '' }
    if (!node.sha) throw new Error('GitHub sent no blob identity.')
    const known = this.blobs.get(node.sha)
    if (known) {
      this.blobs.delete(node.sha)
      this.blobs.set(node.sha, known)
      return known
    }
    let entry = this.reading.get(node.sha)
    if (!entry) {
      const controller = new AbortController()
      const pending = this.limited(async () => {
        const answer = await this.client.get<{ encoding?: string; content?: string }>(
          `${repoApiPath(this.repo)}/git/blobs/${encodeURIComponent(node.sha!)}`,
          { what: `the immutable file ${node.path}` }
        )
        if (
          !['base64', 'utf-8', 'utf8'].includes(answer.encoding ?? '') ||
          typeof answer.content !== 'string'
        )
          throw new Error(
            'GitHub did not supply supported blob bytes. The API may limit this file; open either side on GitHub.'
          )
        const bytes =
          answer.encoding === 'base64'
            ? base64Bytes(answer.content)
            : new TextEncoder().encode(answer.content)
        if (bytes.byteLength > MAX_BYTES)
          throw new Error(
            'This file exceeds the comparison memory budget. Open each side separately.'
          )
        const content = decodeBlob(bytes)
        const size = content.text?.length ? content.text.length * 2 : 0
        this.check(controller.signal)
        this.blobs.set(node.sha!, content)
        this.bytes += size
        while (this.blobs.size > 256 || this.bytes > MAX_CACHE_BYTES) {
          const oldest = this.blobs.keys().next().value!
          this.bytes -= (this.blobs.get(oldest)?.text?.length ?? 0) * 2
          this.blobs.delete(oldest)
        }
        return content
      }, controller.signal)
      entry = { promise: pending, controller, readers: 0, done: false }
      const owned = entry
      this.reading.set(node.sha, entry)
      const settled = () => {
        owned.done = true
        if (this.reading.get(node.sha!) === owned) this.reading.delete(node.sha!)
      }
      void pending.then(settled, settled)
    }
    entry.readers++
    try {
      const result = await new Promise<BlobContent>((resolve, reject) => {
        const abort = () => reject(new DOMException('Comparison cancelled', 'AbortError'))
        signal?.addEventListener('abort', abort, { once: true })
        void entry.promise
          .then(resolve, reject)
          .finally(() => signal?.removeEventListener('abort', abort))
      })
      this.check(signal)
      return result
    } finally {
      entry.readers--
      if (!entry.done && !entry.readers) {
        entry.controller.abort()
        if (this.reading.get(node.sha) === entry) this.reading.delete(node.sha)
      }
    }
  }
  async file(
    index: ComparisonIndex,
    path: string,
    large = false,
    signal?: AbortSignal
  ): Promise<PinnedFile> {
    this.check(signal)
    let change =
      index.changes.find((c) => c.path === path) ??
      index.changes.find((c) => c.previousPath === path)
    if (change) path = change.path
    if (!change) {
      await index.target.reveal(path)
      const node = findNode(index.target.root, path)
      if (!node || node.kind === 'dir')
        throw new Error('The file was not found in the comparison tree.')
      change = { path, status: 'unchanged', base: node, target: node }
    }
    const result: PinnedFile = {
      baseSha: index.baseSha,
      targetSha: index.targetSha,
      path,
      index,
      change,
    }
    const nodes = [change.base, change.target].filter((n): n is TreeNode => !!n)
    const unavailable = (note: string, canLoadLarge = false) => {
      result.note = note
      result.canLoadLarge = canLoadLarge
      index.counts.set(path, { state: 'unavailable' })
      return result
    }
    if (nodes.some((n) => n.kind === 'submodule' || n.mode === '160000'))
      return unavailable('Submodule commit changed. No repository is followed automatically.')
    if (nodes.some((n) => (n.size ?? MAX_BYTES + 1) > MAX_BYTES))
      return unavailable(
        'The file size is unknown or exceeds the comparison memory budget. Open either side separately.'
      )
    if (!large && nodes.some((n) => (n.size ?? 0) > AUTOMATIC_BYTES))
      return unavailable(
        'Large file: load its text explicitly, or open either side separately.',
        true
      )
    index.counts.set(path, { state: 'pending' })
    try {
      const [before, after] = await Promise.all([
        this.blob(change.base, signal),
        this.blob(change.target, signal),
      ])
      this.check(signal)
      result.before = before
      result.after = after
      if ([before, after].some((c) => c.kind === 'binary' || c.kind === 'unsupported'))
        return unavailable('Binary or unsupported encoding. Text counts are unavailable (—).')
      if (
        !large &&
        (before.text!.match(/\n/g)?.length ?? 0) + (after.text!.match(/\n/g)?.length ?? 0) > 20000
      )
        return unavailable(
          'Many lines: load the diff explicitly, or open either side separately.',
          true
        )
      result.text = await this.limited(() => computeDiff(before.text!, after.text!, signal), signal)
      this.check(signal)
      index.counts.set(path, {
        state: 'ready',
        additions: result.text.additions,
        deletions: result.text.deletions,
      })
      if (before.text!.includes('\r\n') !== after.text!.includes('\r\n'))
        result.note = 'Line endings differ between the base and target (CRLF / LF).'
      if ([before, after].some((c) => c.kind === 'lfs'))
        result.note = 'Git LFS pointer text only. No payload is downloaded.'
      if (nodes.some((n) => n.mode === '120000'))
        result.note = 'Symlink text only. The link is not followed.'
      return result
    } catch (error) {
      if (signal?.aborted && index.counts.get(path)?.state === 'pending') index.counts.delete(path)
      this.check(signal)
      const message = error instanceof Error ? error.message : String(error)
      return unavailable(
        error instanceof GithubError && error.kind === 'network'
          ? `This part is not cached for offline use. ${message}`
          : message
      )
    }
  }
  async open(baseSha: string, rest: string[], signal?: AbortSignal): Promise<PinnedFile> {
    const resolved = await this.resolve(rest, baseSha, signal)
    if (resolved.kind === 'dir') throw new FolderError(resolved.sha, resolved.path)
    const index = await this.index(baseSha, resolved.sha, signal)
    return this.file(index, resolved.path, false, signal)
  }
}
// A capability wrapper must never inherit a different caller's still-valid access guard.
const services = new Map<GithubClient, Map<string, ComparisonService>>()
const cacheOwners = new Map<ComparisonService, { client: GithubClient; key: string }>()
export function comparisonService(client: GithubClient, repo: Repository): ComparisonService {
  client.assertCurrent()
  const key = `${client.cacheNamespace}:${repositoryKey(repo)}`
  let repositories = services.get(client)
  if (!repositories) {
    repositories = new Map()
    services.set(client, repositories)
    const owned = repositories
    client.onRetire?.(() => {
      for (const service of owned.values()) {
        service.clear()
        cacheOwners.delete(service)
      }
      owned.clear()
      services.delete(client)
    })
  }
  let service = repositories.get(key)
  if (!service) {
    service = new ComparisonService(client, repo)
    repositories.set(key, service)
  }
  cacheOwners.delete(service)
  cacheOwners.set(service, { client, key })
  while (cacheOwners.size > 8) {
    const oldest = cacheOwners.keys().next().value!
    const owner = cacheOwners.get(oldest)!
    oldest.clear()
    cacheOwners.delete(oldest)
    const rows = services.get(owner.client)
    rows?.delete(owner.key)
    if (!rows?.size) services.delete(owner.client)
  }
  return service
}
