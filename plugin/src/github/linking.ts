/**
 * What a GitHub tab does with a link to a place inside it: copies it, or writes it into the note
 * the person was last in.
 *
 * The tab provides a `Linker` to everything under it — comments, diffs, the file view — so each
 * builds its own link from what it knows (a comment its anchor, a diff its file and lines) and
 * hands it here.
 */
import { MarkdownView, Notice, type App, type WorkspaceLeaf } from 'obsidian'
import type { InjectionKey } from 'vue'
import { insertBlockOnOwnLine, insertOnOwnLine } from '@/helpers/editorHelpers'
import { blobLink, markdownLink, type GithubLink, type LineSpan, type LinkItem } from './permalinks'
import { formatSnippet, type SnippetBlock } from './snippetBlock'
import { commitSha, type BlobData, type CommitData } from './api'
import type { GithubClient } from './client'
import type { GithubTarget } from './urls'
import type { CompareData } from './compare'
import type { ChatQuote } from './chatAbout'
import { AbeleConfig } from '@/services/AbeleConfig'

export interface Linker {
  /** The item on screen, once it has loaded; null before, and for a file at a ref. */
  item(): LinkItem | null
  /** Its title, for a link to the item itself. */
  title(): string
  /** A link to lines of the file on screen, pinned to its commit — which may take a request. */
  blobLink(span: LineSpan): Promise<GithubLink>
  copy(link: GithubLink | Promise<GithubLink>): Promise<void>
  insert(link: GithubLink | Promise<GithubLink>): Promise<void>
  /** Writes a card holding the code or the comment itself into the note. */
  insertSnippet(snippet: SnippetBlock | Promise<SnippetBlock>): Promise<void>
  /** Whether a chat can be opened from here: the AI side is on. */
  canAsk(): boolean
  /** Opens a new chat with the link, and the quoted code or words under it, in its input. */
  ask(link: GithubLink | Promise<GithubLink>, quote?: ChatQuote): Promise<void>
}

export const LINKER: InjectionKey<Linker> = Symbol('abele-github-linker')

/**
 * The note the person was last in: the markdown tab focused last, wherever it is. The GitHub tab
 * they are pressing a button in is the active leaf, so "active" would never be a note.
 */
export function recentNoteView(app: App): MarkdownView | null {
  const time = (leaf: WorkspaceLeaf) => (leaf as unknown as { activeTime?: number }).activeTime ?? 0
  const views = app.workspace
    .getLeavesOfType('markdown')
    .sort((a, b) => time(b) - time(a))
    .map((leaf) => leaf.view)
  return views.find((v): v is MarkdownView => v instanceof MarkdownView && !!v.file) ?? null
}

/**
 * Writes the link at the cursor of the note last worked in, on a line of its own, and leaves the
 * cursor after it so a second link goes under the first.
 *
 * @returns false when no note is open
 */
export function insertLink(app: App, link: GithubLink): boolean {
  const view = recentNoteView(app)
  if (!view) {
    new Notice('Open a note to put the link in')
    return false
  }
  const end = insertOnOwnLine(view.editor, markdownLink(link))
  view.editor.setCursor(end)
  new Notice(`Link added to ${view.file?.basename ?? 'the note'}`)
  return true
}

/**
 * Writes a snippet card at the cursor of the note last worked in, as a block of its own with a
 * blank line either side.
 *
 * @returns false when no note is open
 */
export function insertSnippet(app: App, snippet: SnippetBlock): boolean {
  const view = recentNoteView(app)
  if (!view) {
    new Notice('Open a note to put the code in')
    return false
  }
  const end = insertBlockOnOwnLine(view.editor, formatSnippet(snippet))
  view.editor.setCursor(end)
  new Notice(`Added to ${view.file?.basename ?? 'the note'}`)
  return true
}

export async function copyLink(link: GithubLink): Promise<void> {
  await navigator.clipboard.writeText(markdownLink(link))
  new Notice('Link copied')
}

/** A linker's `copy` and `insert`, which wait for a link that is still being made. */
export function sharing(
  app: App
): Pick<Linker, 'copy' | 'insert' | 'insertSnippet' | 'canAsk' | 'ask'> {
  const settle = async <T>(made: T | Promise<T>, then: (made: T) => unknown): Promise<void> => {
    try {
      await then(await made)
    } catch (e) {
      new Notice(`Could not make the link: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return {
    copy: (link) => settle(link, (l) => copyLink(l)),
    insert: (link) => settle(link, (l) => insertLink(app, l)),
    insertSnippet: (snippet) => settle(snippet, (s) => insertSnippet(app, s)),
    canAsk: () => !!AbeleConfig.getInstance().ai?.enabled,
    // Loaded on press, so a GitHub tab does not pull the chat services in with it.
    ask: async (link, quote) => (await import('./chatAbout')).askAboutGithub(link, quote),
  }
}

/**
 * The linker for a tab: what is shown in it, once loaded, and the client it was read with.
 *
 * @param data the loaded item — a commit's full SHA and a file's ref come from it
 */
export function createLinker(o: {
  app: App
  shown: () => GithubTarget | null
  data: () => unknown
  title: () => string
  client: () => GithubClient
}): Linker {
  /** A branch is resolved to its commit once per tab: the link is to what was read. */
  const shas = new Map<string, Promise<string>>()

  return {
    item() {
      const t = o.shown()
      const data = o.data()
      if (!t || !data) return null
      const repo = { host: t.host, owner: t.owner, repo: t.repo }
      switch (t.kind) {
        case 'issue':
        case 'pull':
        case 'discussion':
          return { ...repo, kind: t.kind, number: t.number }
        case 'commit':
          return { ...repo, kind: 'commit', sha: (data as CommitData).sha || t.sha, pull: t.pull }
        case 'compare': {
          // The base as compared: a lone `compare/<head>` names the default branch once loaded.
          const c = data as CompareData
          return { ...repo, kind: 'compare', base: c.base, head: c.head, direct: c.direct }
        }
        case 'blob':
        case 'tree':
          return null
      }
    },
    title: o.title,
    async blobLink(span) {
      const t = o.shown()
      const blob = o.data() as BlobData | null
      if (t?.kind !== 'blob' || !blob) throw new Error('no file is shown')
      let asked = shas.get(blob.ref)
      if (asked === undefined) {
        asked = commitSha(o.client(), t, blob.ref)
        shas.set(blob.ref, asked)
        // A failure is not kept: the next press asks again.
        asked.catch(() => shas.delete(blob.ref))
      }
      return blobLink(t, await asked, blob.path, span)
    },
    ...sharing(o.app),
  }
}
