import type { RepositorySource, RepositorySearch, RepositoryTree } from '@/repository/source'
import type { TreeNode, ResultFile } from '@/repository/model'
import { RepoIndex, IndexCache } from '@/github/search/repoIndex'
import { gunzipLimited } from './gunzipLimited'
import { findDefinitions } from '@/github/search/definitions'
import { matchFileNames } from '@/github/search/source'
import { globMatcher } from '@/github/search/textSearch'
import { searchChanges } from '@/github/search/changes'
import type { ForgejoClient } from './forgejoClient'

/** Per-reader immutable indexes: never shared across repositories or credential generations. */
export function forgejoSearch(client: ForgejoClient, api: string, source: () => RepositorySource) {
  const cacheBytes = 8 * 1024 * 1024
  const cache = new IndexCache(2, cacheBytes)
  const sizes = new WeakMap<RepoIndex, number>()
  const check = (signal?: AbortSignal) => {
    client.session.assertCurrent()
    if (signal?.aborted) throw new DOMException('Search cancelled', 'AbortError')
  }
  const files = async (tree: RepositoryTree, signal?: AbortSignal) => {
    const result: TreeNode[] = []
    let visited = 0
    const walk = async (node: TreeNode) => {
      check(signal)
      if (++visited > 100000) throw new Error('The repository exceeds the search file limit.')
      if (node.kind !== 'dir') {
        if (node.kind === 'file' && (!node.mode || node.mode.startsWith('100'))) result.push(node)
        return
      }
      if (!node.children) await tree.expand(node)
      for (const child of node.children ?? []) await walk(child)
    }
    await walk(tree.root)
    check(signal)
    return result
  }
  const index = async (
    sha: string,
    request: Pick<RepositorySearch, 'limitBytes' | 'onStage' | 'signal'>
  ) => {
    check(request.signal)
    if (!Number.isFinite(request.limitBytes) || request.limitBytes <= 0)
      throw new Error('Invalid repository search size limit.')
    const known = cache.get(sha)
    if (known && (sizes.get(known) ?? Infinity) <= request.limitBytes) return known
    request.onStage?.('listing')
    const entries = await files(await source().tree(sha), request.signal)
    const total = entries.reduce((n, entry) => n + (entry.size ?? Infinity), 0)
    if (total > request.limitBytes)
      throw new Error(
        'The repository is too large or has unknown file sizes for the search limit. Server code search is not available for this service.'
      )
    request.onStage?.('downloading')
    const bytes = await client.bytes(`${api}/archive/${encodeURIComponent(sha)}.tar.gz`)
    check(request.signal)
    if (bytes.byteLength > request.limitBytes + entries.length * 1024 + 1024)
      throw new Error('The repository archive exceeds the search size limit.')
    request.onStage?.('unpacking')
    const tar = await gunzipLimited(
      new Uint8Array(bytes),
      request.limitBytes + entries.length * 2048 + 10240,
      () => check(request.signal)
    )
    check(request.signal)
    request.onStage?.('indexing')
    const built = await RepoIndex.fromTarAsync(tar)
    check(request.signal)
    sizes.set(built, total)
    // IndexCache intentionally keeps at least one entry; a large search need not stay resident.
    if (built.bytes <= cacheBytes) cache.set(sha, built)
    console.debug('[Abele] Forge code index built', {
      files: built.files.length,
      binary: built.binary,
      oversized: built.oversized,
    })
    return built
  }
  const search: RepositorySource['search'] = async (request) => {
    check(request.signal)
    const sha = await source().resolve(request.ref)
    check(request.signal)
    if (request.scope === 'changes') {
      const changes = request.changes
      if (!changes) return { files: [], total: 0, capped: false }
      let missing = 0
      for (const file of changes.files) {
        check(request.signal)
        if (!file.patch && file.loadPatch) await file.loadPatch()
        if (!file.patch) missing++
      }
      const result = await searchChanges(changes.files, request.query, { glob: request.glob })
      check(request.signal)
      return {
        total: result.total,
        capped: result.capped || missing > 0,
        note: `Results open the change without a precise diff anchor.${missing ? ` ${missing} files without text patches were not searched.` : ''}`,
        files: result.files.map((file) => ({
          path: file.path,
          url: changes.lineUrl(file.hash),
          lines: file.matches.map((match) => ({
            label: `${match.line}${match.side === 'L' ? ' before' : ''}`,
            text: match.text,
            column: match.column,
            length: match.length,
            url: changes.lineUrl(file.hash, match.side, match.line),
          })),
        })),
      }
    }
    if (request.scope === 'names') {
      const entries = await files(await source().tree(sha), request.signal)
      const admits = globMatcher(request.glob)
      const matches = matchFileNames(
        entries
          .filter((entry) => admits(entry.path))
          .map((entry) => ({ path: entry.path, size: entry.size ?? 0 })),
        request.query.text
      )
      check(request.signal)
      return {
        files: matches.map(
          (entry): ResultFile => ({
            path: entry.path,
            url: source().navigation.file(sha, entry.path),
            lines: [],
          })
        ),
        total: matches.length,
        capped: matches.length >= 200,
      }
    }
    const built = await index(sha, request)
    const result = await built.search(request.query, { glob: request.glob, signal: request.signal })
    check(request.signal)
    return {
      total: result.total,
      capped: result.capped,
      note:
        built.binary || built.oversized
          ? `${built.binary} binary and ${built.oversized} oversized files were not searched.`
          : undefined,
      files: result.files.map((file) => ({
        path: file.path,
        url: source().navigation.file(sha, file.path),
        lines: file.matches.map((match) => ({
          label: String(match.line),
          text: match.text,
          column: match.column,
          length: match.length,
          url: source().navigation.file(sha, file.path, match.line),
        })),
      })),
    }
  }
  const definitions: RepositorySource['definitions'] = async (
    ref,
    name,
    fromPath,
    limitBytes,
    onStage
  ) => {
    check()
    const sha = await source().resolve(ref)
    const built = await index(sha, { limitBytes, onStage })
    const result = findDefinitions(built.files, name, fromPath)
    check()
    return result
  }
  return { search, definitions }
}
