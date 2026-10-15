import { App, TFile, TFolder } from 'obsidian'
import { TextInputSuggest } from './suggest'
import { ScopeResolver, type ScopeEntry } from '@/ai/ScopeResolver'
import { isChatLog } from '@/ai/chatText'

/** One thing the field can add, as the list shows it. */
export interface ScopeChoice {
  entry: ScopeEntry
  /** What it is, in a word, on the right: «folder», «group · 5 notes», «open note». */
  kind: string
}

const ICONS: Record<ScopeEntry['type'], string> = {
  file: 'file-text',
  folder: 'folder',
  group: 'users',
  pattern: 'regex',
}

/** How many places the list shows. */
const LIMIT = 100

/** A glob, rather than a name: the field takes it as a pattern as typed. */
const GLOB = /[*?]/

/**
 * One field for every kind of place the agent may reach, as the quick switcher mixes notes and
 * headings in one list: the open note first while nothing is typed, a pattern first once the
 * text has a `*` or `?` in it, then folders, group notes with their size, and files.
 */
export class ScopeSuggest extends TextInputSuggest<ScopeChoice> {
  constructor(
    app: App,
    inputEl: HTMLInputElement,
    private readonly taken: () => ScopeEntry[],
    private readonly onChoose: (entry: ScopeEntry) => void
  ) {
    super(app, inputEl)
  }

  getSuggestions(query: string): ScopeChoice[] {
    const q = query.trim().toLowerCase()
    const key = (e: ScopeEntry) => `${e.type}:${e.path}`
    const taken = new Set(this.taken().map(key))
    const out: ScopeChoice[] = []
    // The list holds a hundred; once they are found the rest of the vault is not looked through,
    // and group sizes, the costly part, are not asked for while folders alone fill it.
    const full = () => out.length >= LIMIT
    const push = (choice: ScopeChoice) => {
      if (!full() && !taken.has(key(choice.entry))) out.push(choice)
    }

    if (GLOB.test(q)) push({ entry: { type: 'pattern', path: query.trim() }, kind: 'pattern' })

    const open = this.app.workspace.getActiveFile()
    if (!q && open) push({ entry: { type: 'file', path: open.path }, kind: 'open note' })

    const files = this.app.vault.getAllLoadedFiles()
    const match = (path: string) => !q || GLOB.test(q) || path.toLowerCase().includes(q)
    for (const f of files) {
      if (full()) return out
      if (f instanceof TFolder && !f.isRoot() && match(f.path))
        push({ entry: { type: 'folder', path: f.path }, kind: 'folder' })
    }
    if (full()) return out
    for (const [path, size] of ScopeResolver.getInstance().groupSizes())
      if (match(path))
        push({
          entry: { type: 'group', path },
          kind: `group · ${size} ${size === 1 ? 'note' : 'notes'}`,
        })
    // A chat log is never in reach through a scope, so it is not offered; the open note is
    // listed once, at the top, while nothing is typed, and by its name once something is.
    for (const f of files) {
      if (full()) return out
      if (
        f instanceof TFile &&
        !(!q && f.path === open?.path) &&
        !isChatLog(f.path) &&
        match(f.path)
      )
        push({ entry: { type: 'file', path: f.path }, kind: '' })
    }
    return out
  }

  renderSuggestion(choice: ScopeChoice, el: HTMLElement): void {
    this.rows.draw(el, {
      icon: ICONS[choice.entry.type],
      title: choice.entry.path,
      aux: choice.kind ? [{ flair: choice.kind, cls: 'abele-scope-suggest__kind' }] : [],
    })
  }

  /**
   * Adds it and closes the list. The new row pushes the field down, and a list left open
   * would stay where the field was, over the rows; typing again opens it under the field.
   */
  selectSuggestion(choice: ScopeChoice): void {
    this.onChoose(choice.entry)
    this.inputEl.value = ''
    this.close()
  }
}
