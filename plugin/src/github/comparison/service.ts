import { shallowReactive } from 'vue'
import { commitSha } from '../api'
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
const cancelled = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Comparison cancelled', 'AbortError')
}

/** Immutable session data is bounded, deduplicated, and owned by one credential generation. */
export class ComparisonService {
  private readonly indexes = new Map<string, Promise<ComparisonIndex>>()
  private readonly blobs = new Map<string, BlobContent>()
  private readonly reading = new Map<string, Promise<BlobContent>>()
  private bytes = 0
  private running = 0
  private readonly queue: (() => void)[] = []
  constructor(
    private readonly client: GithubClient,
    private readonly repo: Repository
  ) {}
  clear(): void {
    this.indexes.clear()
    this.blobs.clear()
    this.reading.clear()
    this.bytes = 0
  }
  private check(signal?: AbortSignal): void {
    this.client.assertCurrent()
    cancelled(signal)
  }
  private async limited<T>(read: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.running >= 3) await new Promise<void>((resolve) => this.queue.push(resolve))
    this.running++
    try {
      this.check(signal)
      return await read()
    } finally {
      this.running--
      this.queue.shift()?.()
    }
  }
  /** Resolve the ref before reading its tree. No Contents read is made at a mutable ref. */
  async resolve(
    rest: string[],
    baseSha?: string,
    signal?: AbortSignal
  ): Promise<{ sha: string; path: string; ref: string }> {
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
        if (node && node.kind !== 'dir') return { sha, path: candidate.path, ref: candidate.ref }
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
    let pending = this.indexes.get(key)
    if (!pending) {
      // Shared loads do not inherit one tab's cancellation. Consumers check their generation.
      pending = (async () => {
        const base = await repoTree(this.client, this.repo, baseSha)
        const target = await repoTree(this.client, this.repo, targetSha)
        const changes = await compareTrees(base, target)
        this.client.assertCurrent()
        await this.renameMetadata(changes, baseSha, targetSha)
        return {
          baseSha,
          targetSha,
          base,
          target,
          changes,
          counts: shallowReactive(new Map<string, FileCounts>()),
        }
      })()
      this.indexes.set(key, pending)
      pending.catch(() => {
        if (this.indexes.get(key) === pending) this.indexes.delete(key)
      })
      while (this.indexes.size > 8) this.indexes.delete(this.indexes.keys().next().value!)
    }
    const result = await pending
    this.check(signal)
    return result
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
  private async blob(node?: TreeNode): Promise<BlobContent> {
    this.client.assertCurrent()
    if (!node) return { kind: 'text', text: '' }
    if (!node.sha) throw new Error('GitHub sent no blob identity.')
    const known = this.blobs.get(node.sha)
    if (known) {
      this.blobs.delete(node.sha)
      this.blobs.set(node.sha, known)
      return known
    }
    let pending = this.reading.get(node.sha)
    if (!pending) {
      pending = this.limited(async () => {
        const answer = await this.client.get<{ encoding?: string; content?: string }>(
          `${repoApiPath(this.repo)}/git/blobs/${encodeURIComponent(node.sha!)}`,
          { what: `the immutable file ${node.path}` }
        )
        if (answer.encoding !== 'base64' || typeof answer.content !== 'string')
          throw new Error(
            'GitHub did not supply supported blob bytes. The API may limit this file; open either side on GitHub.'
          )
        const bytes = base64Bytes(answer.content)
        if (bytes.byteLength > MAX_BYTES)
          throw new Error(
            'This file exceeds the comparison memory budget. Open each side separately.'
          )
        const content = decodeBlob(bytes)
        const size = content.text?.length ? content.text.length * 2 : 0
        this.client.assertCurrent()
        this.blobs.set(node.sha!, content)
        this.bytes += size
        while (this.blobs.size > 256 || this.bytes > MAX_CACHE_BYTES) {
          const oldest = this.blobs.keys().next().value!
          this.bytes -= (this.blobs.get(oldest)?.text?.length ?? 0) * 2
          this.blobs.delete(oldest)
        }
        return content
      })
      this.reading.set(node.sha, pending)
      void pending.finally(() => this.reading.delete(node.sha!)).catch(() => {})
    }
    return pending
  }
  async file(
    index: ComparisonIndex,
    path: string,
    large = false,
    signal?: AbortSignal
  ): Promise<PinnedFile> {
    this.check(signal)
    let change = index.changes.find((c) => c.path === path)
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
      const [before, after] = await Promise.all([this.blob(change.base), this.blob(change.target)])
      this.check(signal)
      result.before = before
      result.after = after
      if ([before, after].some((c) => c.kind === 'binary' || c.kind === 'unsupported'))
        return unavailable('Binary or unsupported encoding. Text counts are unavailable (—).')
      result.text = await computeDiff(before.text!, after.text!, signal)
      this.check(signal)
      index.counts.set(path, {
        state: 'ready',
        additions: result.text.additions,
        deletions: result.text.deletions,
      })
      if ([before, after].some((c) => c.kind === 'lfs'))
        result.note = 'Git LFS pointer text only. No payload is downloaded.'
      if (nodes.some((n) => n.mode === '120000'))
        result.note = 'Symlink text only. The link is not followed.'
      return result
    } catch (error) {
      this.check(signal)
      return unavailable(error instanceof Error ? error.message : String(error))
    }
  }
  async open(baseSha: string, rest: string[], signal?: AbortSignal): Promise<PinnedFile> {
    const resolved = await this.resolve(rest, baseSha, signal)
    const index = await this.index(baseSha, resolved.sha, signal)
    return this.file(index, resolved.path, false, signal)
  }
}
const services = new Map<string, ComparisonService>()
export function comparisonService(client: GithubClient, repo: Repository): ComparisonService {
  client.assertCurrent()
  const key = `${client.cacheNamespace}:${repositoryKey(repo)}`
  let service = services.get(key)
  if (!service) {
    service = new ComparisonService(client, repo)
    services.set(key, service)
    client.onRetire?.(() => {
      services.get(key)?.clear()
      services.delete(key)
    })
    while (services.size > 16) {
      const oldest = services.keys().next().value!
      services.get(oldest)?.clear()
      services.delete(oldest)
    }
  }
  return service
}
