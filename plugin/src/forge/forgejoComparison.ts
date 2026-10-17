import { shallowReactive } from 'vue'
import type { RepositorySource } from '@/repository/source'
import type {
  BlobContent,
  ComparisonIndex,
  FileCounts,
  PinnedFile,
  TreeNode,
} from '@/repository/model'
import { compareTrees } from '@/github/comparison/trees'
import { decodeBlob } from '@/github/comparison/text'
import { computeDiff } from '@/github/comparison/compute'
import { findNode } from '@/github/tree/fileTree'
import type { ForgejoClient } from './forgejoClient'

const AUTOMATIC_BYTES = 1024 * 1024
const MAX_BYTES = 8 * 1024 * 1024

/** Exact endpoint trees and git blobs, independent of native compare response differences. */
export function forgejoComparison(
  client: ForgejoClient,
  api: string,
  source: () => RepositorySource
) {
  // Reject indexes supplied by another repository, account, or credential generation.
  const owned = new WeakSet<ComparisonIndex>()
  const check = (signal?: AbortSignal) => {
    client.session.assertCurrent()
    if (signal?.aborted) throw new DOMException('Comparison cancelled', 'AbortError')
  }
  const index = async (
    base: string,
    head: string,
    signal?: AbortSignal
  ): Promise<ComparisonIndex> => {
    check(signal)
    const baseSha = await source().resolve(base),
      targetSha = await source().resolve(head)
    check(signal)
    const before = await source().tree(baseSha)
    check(signal)
    const after = await source().tree(targetSha)
    const changes = await compareTrees(before, after, signal)
    check(signal)
    const result: ComparisonIndex = {
      baseSha,
      targetSha,
      base: before,
      target: after,
      changes,
      counts: shallowReactive(new Map<string, FileCounts>()),
    }
    owned.add(result)
    return result
  }
  const blob = async (node: TreeNode | undefined, signal?: AbortSignal): Promise<BlobContent> => {
    check(signal)
    if (!node) return { kind: 'text', text: '' }
    if (!node.sha) throw new Error('The service did not return a blob identity.')
    const raw = await client.get<{ encoding?: string; content?: string }>(
      `${api}/git/blobs/${encodeURIComponent(node.sha)}`
    )
    check(signal)
    if (raw.encoding !== 'base64' || typeof raw.content !== 'string')
      throw new Error('The service did not return supported blob bytes.')
    if (raw.content.length > Math.ceil(MAX_BYTES / 3) * 4 + 1024)
      throw new Error('This file exceeds the comparison memory budget.')
    const bytes = Uint8Array.from(atob(raw.content.replace(/\s/g, '')), (c) => c.charCodeAt(0))
    if (bytes.length > MAX_BYTES) throw new Error('This file exceeds the comparison memory budget.')
    return decodeBlob(bytes)
  }
  const file = async (
    index: ComparisonIndex,
    path: string,
    large = false,
    signal?: AbortSignal
  ): Promise<PinnedFile> => {
    check(signal)
    if (!owned.has(index)) throw new Error('This comparison belongs to another repository reader.')
    let change = index.changes.find((c) => c.path === path || c.previousPath === path)
    if (!change) {
      await index.target.reveal(path)
      check(signal)
      const node = findNode(index.target.root, path)
      if (!node || node.kind === 'dir')
        throw new Error('The file was not found in the comparison tree.')
      change = { path, status: 'unchanged', base: node, target: node }
    }
    path = change.path
    const result: PinnedFile = {
      baseSha: index.baseSha,
      targetSha: index.targetSha,
      path,
      index,
      change,
    }
    const unavailable = (note: string, canLoadLarge = false) => {
      check(signal)
      index.counts.set(path, { state: 'unavailable' })
      return { ...result, note, canLoadLarge }
    }
    const nodes = [change.base, change.target].filter((n): n is TreeNode => !!n)
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
      // Sequential reads bound peak memory even on a phone.
      const before = await blob(change.base, signal),
        after = await blob(change.target, signal)
      check(signal)
      result.before = before
      result.after = after
      if (before.text === undefined || after.text === undefined)
        return unavailable('Binary or unsupported encoding. Text counts are unavailable (—).')
      if (
        !large &&
        (before.text.match(/\n/g)?.length ?? 0) + (after.text.match(/\n/g)?.length ?? 0) > 20000
      )
        return unavailable(
          'Many lines: load the diff explicitly, or open either side separately.',
          true
        )
      result.text = await computeDiff(before.text, after.text, signal)
      check(signal)
      index.counts.set(path, {
        state: 'ready',
        additions: result.text.additions,
        deletions: result.text.deletions,
      })
      if (before.text.includes('\r\n') !== after.text.includes('\r\n'))
        result.note = 'Line endings differ between the base and target (CRLF / LF).'
      if ([before, after].some((b) => b.kind === 'lfs'))
        result.note = 'Git LFS pointer text only. No payload is downloaded.'
      if (nodes.some((n) => n.mode === '120000'))
        result.note = 'Symlink text only. The link is not followed.'
      return result
    } catch (error) {
      index.counts.delete(path)
      check(signal)
      return unavailable(
        error instanceof Error ? error.message : 'The comparison could not be read.'
      )
    }
  }
  return { index, file }
}
