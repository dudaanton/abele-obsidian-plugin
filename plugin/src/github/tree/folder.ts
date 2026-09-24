/**
 * One folder of a repository at a ref, as a tab lists it: its entries, folders first, and the
 * README GitHub would render under them.
 */
import { GithubError, type GithubClient } from '../client'
import { repoApiPath } from '../contents'
import { repoWeb } from '../origin'
import { treeCandidates, type GithubTarget } from '../urls'
import type { NodeKind } from './fileTree'

type Of<K extends GithubTarget['kind']> = Extract<GithubTarget, { kind: K }>

export interface FolderEntry {
  name: string
  path: string
  kind: NodeKind | 'symlink'
  /** Bytes, for a file. */
  size?: number
}

export interface FolderData {
  ref: string
  /** Empty for the repository's root. */
  path: string
  entries: FolderEntry[]
  /** GitHub's own address for it. */
  url: string
}

/** A `tree/…` link that names a file: the tab shows the file, as GitHub redirects to it. */
export class NotAFolderError extends GithubError {
  constructor(
    readonly ref: string,
    readonly path: string
  ) {
    super('other', `${path} is a file, not a folder.`)
    this.name = 'NotAFolderError'
  }
}

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/')

/** The contents API's address for a folder; the root has no path at all. */
const folderApiPath = (t: Of<'tree'>, path: string, ref: string) =>
  `${repoApiPath(t)}/contents${path ? `/${encodePath(path)}` : ''}?ref=${encodeURIComponent(ref)}`

interface Listed {
  name?: string
  path?: string
  type?: string
  size?: number
}

const KINDS: Record<string, FolderEntry['kind']> = {
  dir: 'dir',
  file: 'file',
  submodule: 'submodule',
  symlink: 'symlink',
}

/** The contents API's listing of a folder, folders first, then submodules, then files. */
export function folderEntries(listing: Listed[]): FolderEntry[] {
  const entries = listing
    .filter((e) => typeof e.name === 'string' && typeof e.path === 'string')
    .map((e): FolderEntry => {
      const kind = KINDS[e.type ?? ''] ?? 'file'
      return {
        name: e.name,
        path: e.path,
        kind,
        size: kind === 'file' || kind === 'symlink' ? e.size : undefined,
      }
    })
  // A link sorts with the files; only folders and submodules go before them.
  const rank = (k: FolderEntry['kind']) => (k === 'dir' ? 0 : k === 'submodule' ? 1 : 2)
  return entries.sort(
    (a, b) =>
      rank(a.kind) - rank(b.kind) ||
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  )
}

const README = /^readme(\.[a-z0-9]+)?$/i
const MARKDOWN_README = /^readme\.(md|markdown|mdown|mkd|mkdn|mdx)$/i

/** The README GitHub renders under a folder: a markdown one first, then any other. */
export function readmeOf(entries: FolderEntry[]): FolderEntry | null {
  const files = entries.filter((e) => e.kind === 'file')
  return (
    files.find((e) => MARKDOWN_README.test(e.name)) ??
    files.find((e) => README.test(e.name)) ??
    null
  )
}

/** A file's size as GitHub writes it. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * The folder a `tree/…` link names. A branch may hold slashes, so each split of the link is
 * asked in turn, the shortest ref first, as for a file.
 */
export async function loadFolder(client: GithubClient, t: Of<'tree'>): Promise<FolderData> {
  let lastError: unknown = null
  // Capped: a deep path with no match would otherwise cost one request per segment.
  for (const { ref, path } of treeCandidates(t.rest).slice(0, 6)) {
    try {
      const body = await client.get<unknown>(folderApiPath(t, path, ref), {
        what: path ? `the folder ${path}` : 'the repository',
      })
      if (!Array.isArray(body)) throw new NotAFolderError(ref, path)
      return {
        ref,
        path,
        entries: folderEntries(body as Listed[]),
        url: `${repoWeb(t)}/tree/${t.rest.map(encodeURIComponent).join('/')}`,
      }
    } catch (e) {
      if (!(e instanceof GithubError) || e.kind !== 'not-found') throw e
      lastError = e
    }
  }
  throw lastError ?? new GithubError('not-found', 'GitHub has no such folder.')
}
