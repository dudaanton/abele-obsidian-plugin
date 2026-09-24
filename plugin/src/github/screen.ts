/**
 * What a GitHub tab has on screen right now, for an agent to ask about: which item, which of a
 * pull request's sections, which files of a diff are open, and the lines the person selected
 * together with their code.
 *
 * The tab's components write it as the person moves around — they are the only ones who know —
 * and `github_views` reads it. It lives on the view's model, so it goes when the tab goes.
 */
import type { InjectionKey } from 'vue'
import type { DiffLine } from './patch'
import type { GithubLink } from './permalinks'

export type PullSection = 'conversation' | 'files' | 'commits'

export interface ScreenSelection {
  /** The file the lines are in. */
  path: string
  /** "Lines 10–20", "Line 3, before the change". */
  label: string
  /** The code, one line per line; a diff's lines keep their `+`, `-` or space. */
  code: string
  /** A link to the lines when one can be made without asking GitHub. */
  url?: string
}

export interface GithubScreen {
  /** The item's title once it has loaded; empty before. */
  title: string
  /** What is shown, which for an issue number that is a pull request is `pull`. */
  kind: string
  /** The pull request's section in front; null for anything else. */
  section: PullSection | null
  /** Paths of the diff files drawn open. */
  expanded: string[]
  selection: ScreenSelection | null
  /** A link to the item itself, labelled, for "Chat about this"; null until it has loaded. */
  link: GithubLink | null
  /** Why the item could not be shown, when it could not. */
  error: string
}

export const emptyScreen = (): GithubScreen => ({
  title: '',
  kind: '',
  section: null,
  expanded: [],
  selection: null,
  link: null,
  error: '',
})

export const SCREEN: InjectionKey<GithubScreen> = Symbol('abele-github-screen')

export function markExpanded(screen: GithubScreen, path: string, open: boolean): void {
  const has = screen.expanded.includes(path)
  if (open && !has) screen.expanded.push(path)
  if (!open && has) screen.expanded.splice(screen.expanded.indexOf(path), 1)
}

/** The code of lines `from`–`to` (1-based, inclusive) of a file's text. */
export function blobCode(text: string, from: number, to: number): string {
  return text
    .split('\n')
    .slice(from - 1, to)
    .join('\n')
}

const SIGN: Record<string, string> = { add: '+', del: '-', ctx: ' ' }

/** The code of diff lines `from`–`to` (1-based rows of the drawn diff), signs kept. */
export function diffCode(lines: DiffLine[], from: number, to: number): string {
  return lines
    .slice(from - 1, to)
    .filter((l) => l.type in SIGN)
    .map((l) => `${SIGN[l.type]}${l.text}`)
    .join('\n')
}
