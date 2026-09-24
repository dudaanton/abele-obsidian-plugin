/**
 * What a GitHub tab can search, and how its results open: the repository at the commit the tab
 * stands on — a pull request's head, a commit, the ref a file was read at, the default branch for
 * an issue — and, for a pull request or a commit, just what it changed.
 *
 * The tab's code search panel and go to definition both go through here, so a lookup started
 * from either reuses the index the other built.
 */
import { repoWeb } from '../origin'
import { Notice } from 'obsidian'
import type { DiffFile } from '../api'
import type { GithubClient } from '../client'
import { parsePatch } from '../patch'
import { isMarkdownPath } from '../markdownPreview'
import { findDefinitions, type DefinitionHit } from './definitions'
import { searchChanges, type FetchWhole } from './changes'
import { QueryError, type CodeQuery } from './textSearch'
import type { RepoIndex } from './repoIndex'
import {
  TooLargeError,
  cachedIndex,
  defaultBranch,
  githubCodeSearch,
  loadTree,
  matchFileNames,
  repoIndex,
  type RepoRef,
  type Stage,
} from './source'
import type { CodeNav } from './navAddon'

export type Scope = 'changes' | 'repo' | 'names'

export interface ResultLine {
  /** What the line is called beside the text: its number, and "before" for a removed one. */
  label: string
  text: string
  column: number
  length: number
  url: string
}

export interface ResultFile {
  path: string
  url: string
  lines: ResultLine[]
}

export interface CodeResults {
  files: ResultFile[]
  /** Matching lines, or files for a name search. */
  total: number
  capped: boolean
  /** Said above the results: where they came from, when it is not the obvious place. */
  note?: string
}

/** The changes a tab shows, and how a line in them is linked. */
export interface TabChanges {
  files: DiffFile[]
  /** The link to a changed file, or a line in it: the pull request's files, or the commit. */
  lineUrl(hash: string, side?: 'L' | 'R', line?: number): string
}

export interface TabCodeSource {
  client(): GithubClient
  repo(): RepoRef
  /** The ref as a person reads it — a branch, a short SHA. */
  refLabel(): string
  /** The full SHA the tab's code is at. */
  sha(): Promise<string>
  /** The changed files, loading them if the tab has not yet; null for a tab that changes nothing. */
  changes(): Promise<TabChanges | null>
  /** The file a blob tab shows. */
  blob(): { path: string; text: string } | null
  /** Opens a GitHub address — in this tab by the usual rule, or in a new one. */
  open(url: string, newTab: boolean): void
  limitBytes(): number
  /** Asks the tab to show "find references" results. */
  showReferences(name: string): void
  /** Lets the person pick one of several definitions. */
  pick(hits: DefinitionHit[], sha: string, name: string): void
}

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/')

export const webBase = (r: RepoRef) => repoWeb(r)

/**
 * A file at a ref, or a line of it. A line of a markdown file is asked for as its source —
 * `?plain=1`, GitHub's own spelling — so it opens as code at that line, not rendered.
 */
export const blobUrl = (r: RepoRef, ref: string, path: string, line?: number) =>
  `${webBase(r)}/blob/${ref}/${encodePath(path)}${
    line ? `${isMarkdownPath(path) ? '?plain=1' : ''}#L${line}` : ''
  }`

export const STAGE_TEXT: Record<Stage, string> = {
  listing: 'Listing the files…',
  downloading: 'Downloading the repository…',
  unpacking: 'Unpacking…',
  indexing: 'Indexing…',
}

export class TabCode implements CodeNav {
  /** The tab's hashes to paths, for naming the file a diff viewer shows. */
  private hashes = new Map<string, string>()

  constructor(private readonly src: TabCodeSource) {}

  refLabel(): string {
    return this.src.refLabel()
  }

  noteFiles(files: DiffFile[]): void {
    for (const f of files) this.hashes.set(f.hash, f.path)
  }

  pathOf(viewerEl: HTMLElement): string {
    const hash = viewerEl.closest('[data-diff]')?.getAttribute('data-diff')
    if (hash) return this.hashes.get(hash) ?? ''
    return this.src.blob()?.path ?? ''
  }

  /** The whole repository at the tab's commit, downloading it the first time. */
  async index(onStage?: (s: Stage) => void, signal?: AbortSignal): Promise<RepoIndex> {
    const sha = await this.src.sha()
    return repoIndex(this.src.client(), this.src.repo(), sha, {
      limitBytes: this.src.limitBytes(),
      onStage,
      signal,
    })
  }

  async search(
    scope: Scope,
    query: CodeQuery,
    glob: string,
    onStage?: (s: Stage) => void,
    signal?: AbortSignal
  ): Promise<CodeResults> {
    if (scope === 'names') return this.searchNames(query.text)
    if (!query.text) return { files: [], total: 0, capped: false }
    if (scope === 'changes') return this.searchChanges(query, glob)
    return this.searchRepo(query, glob, onStage, signal)
  }

  private async searchNames(text: string): Promise<CodeResults> {
    const sha = await this.src.sha()
    const repo = this.src.repo()
    const tree = await loadTree(this.src.client(), repo, sha)
    const hits = matchFileNames(tree.files, text)
    return {
      files: hits.map(
        (f): ResultFile => ({ path: f.path, url: blobUrl(repo, sha, f.path), lines: [] })
      ),
      total: hits.length,
      capped: hits.length >= 200,
      note: tree.truncated
        ? `GitHub listed only the first ${tree.files.length} files of this repository.`
        : undefined,
    }
  }

  private async searchChanges(query: CodeQuery, glob: string): Promise<CodeResults> {
    const changes = await this.src.changes()
    if (!changes) return { files: [], total: 0, capped: false }
    this.noteFiles(changes.files)
    const sha = await this.src.sha()
    const client = this.src.client()
    const repo = this.src.repo()
    const fetchWhole: FetchWhole = (path) =>
      client.get<string>(
        `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/contents/${encodePath(path)}?ref=${sha}`,
        { accept: 'application/vnd.github.raw+json', text: true, what: 'the file' }
      )
    const result = await searchChanges(changes.files, query, { glob, fetchWhole })
    return {
      files: result.files.map((f) => ({
        path: f.path,
        url: changes.lineUrl(f.hash),
        lines: f.matches.map((m) => ({
          label: m.side === 'L' ? `${m.line} before` : String(m.line),
          text: m.text,
          column: m.column,
          length: m.length,
          url: changes.lineUrl(f.hash, m.side, m.line),
        })),
      })),
      total: result.total,
      capped: result.capped,
    }
  }

  private async searchRepo(
    query: CodeQuery,
    glob: string,
    onStage?: (s: Stage) => void,
    signal?: AbortSignal
  ): Promise<CodeResults> {
    const repo = this.src.repo()
    let index: RepoIndex
    try {
      index = await this.index(onStage, signal)
    } catch (e) {
      if (!(e instanceof TooLargeError)) throw e
      return this.searchOnGithub(query, e)
    }
    const sha = await this.src.sha()
    const result = await index.search(query, { glob, signal })
    return {
      files: result.files.map((f) => ({
        path: f.path,
        url: blobUrl(repo, sha, f.path),
        lines: f.matches.map((m) => ({
          label: String(m.line),
          text: m.text,
          column: m.column,
          length: m.length,
          url: blobUrl(repo, sha, f.path, m.line),
        })),
      })),
      total: result.total,
      capped: result.capped,
    }
  }

  private async searchOnGithub(query: CodeQuery, why: TooLargeError): Promise<CodeResults> {
    if (query.regex) {
      throw new QueryError(
        `${why.message} GitHub's own code search, which is used instead, takes no regular expressions.`
      )
    }
    const client = this.src.client()
    const repo = this.src.repo()
    const [result, branch] = await Promise.all([
      githubCodeSearch(client, repo, query.text),
      defaultBranch(client, repo),
    ])
    return {
      files: result.files.map((f) => ({
        path: f.path,
        url: blobUrl(repo, branch, f.path),
        lines: (result.fragments[f.path] ?? []).map((fragment) => {
          const text = fragment.replace(/\s+/g, ' ').trim()
          return {
            label: '',
            text,
            column: text.toLowerCase().indexOf(query.text.toLowerCase()),
            length: query.text.length,
            url: blobUrl(repo, branch, f.path),
          }
        }),
      })),
      total: result.total,
      capped: result.capped,
      note: `${why.message} These results are from GitHub's own code search, which knows only the default branch (${branch}) and shows fragments rather than lines.`,
    }
  }

  /** Go to definition: one candidate opens, several are offered, none is said. */
  async goToDefinition(name: string, fromPath: string): Promise<void> {
    const repo = this.src.repo()
    let notice: Notice | null = null
    try {
      const sha = await this.src.sha()
      let hits: DefinitionHit[]
      let where = `${repo.owner}/${repo.repo} at ${this.src.refLabel()}`
      try {
        const index =
          cachedIndex(repo, sha) ??
          (await this.index((stage) => {
            notice ??= new Notice(`Looking for ${name}…`, 0)
            notice.setMessage(`Looking for ${name}: ${STAGE_TEXT[stage].toLowerCase()}`)
          }))
        hits = findDefinitions(index.files, name, fromPath)
      } catch (e) {
        if (!(e instanceof TooLargeError)) throw e
        hits = await this.definitionsInTab(name, fromPath)
        where = 'the files open in this tab (the repository is too large to download)'
      }
      notice?.hide()
      notice = null
      if (hits.length === 0) {
        new Notice(
          `No definition of ${name} found in ${where}. The lookup goes by pattern, so it can miss one.`
        )
      } else if (hits.length === 1) {
        this.src.open(blobUrl(repo, sha, hits[0].path, hits[0].line), false)
      } else {
        this.src.pick(hits, sha, name)
      }
    } catch (e) {
      notice?.hide()
      console.debug('[Abele] go to definition failed', e)
      new Notice(`Could not look up ${name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /** For a repository too big to download: the new side of the changed files, and the file shown. */
  private async definitionsInTab(name: string, fromPath: string): Promise<DefinitionHit[]> {
    const blob = this.src.blob()
    if (blob) return findDefinitions([blob], name, fromPath)
    const changes = await this.src.changes()
    if (!changes) return []
    const hits: DefinitionHit[] = []
    for (const file of changes.files) {
      if (!file.patch) continue
      const lines = parsePatch(file.patch).filter((l) => l.new !== undefined)
      const text = lines.map((l) => l.text).join('\n')
      for (const hit of findDefinitions([{ path: file.path, text }], name, fromPath)) {
        hits.push({ ...hit, line: lines[hit.line - 1]?.new ?? hit.line })
      }
    }
    return hits
  }

  findReferences(name: string): void {
    this.src.showReferences(name)
  }
}
