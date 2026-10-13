import { App, TFile, TFolder, setIcon } from 'obsidian'
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
    const has = (e: ScopeEntry) => this.taken().some((t) => t.type === e.type && t.path === e.path)
    const out: ScopeChoice[] = []
    const push = (choice: ScopeChoice) => {
      if (!has(choice.entry)) out.push(choice)
    }

    if (GLOB.test(q)) push({ entry: { type: 'pattern', path: query.trim() }, kind: 'pattern' })

    const open = this.app.workspace.getActiveFile()
    if (!q && open) push({ entry: { type: 'file', path: open.path }, kind: 'open note' })

    const files = this.app.vault.getAllLoadedFiles()
    const match = (path: string) => !q || GLOB.test(q) || path.toLowerCase().includes(q)
    for (const f of files)
      if (f instanceof TFolder && !f.isRoot() && match(f.path))
        push({ entry: { type: 'folder', path: f.path }, kind: 'folder' })
    for (const [path, size] of ScopeResolver.getInstance().groupSizes())
      if (match(path))
        push({
          entry: { type: 'group', path },
          kind: `group · ${size} ${size === 1 ? 'note' : 'notes'}`,
        })
    // A chat log is never in reach through a scope, so it is not offered; the open note is
    // listed once, at the top, while nothing is typed, and by its name once something is.
    for (const f of files)
      if (
        f instanceof TFile &&
        !(!q && f.path === open?.path) &&
        !isChatLog(f.path) &&
        match(f.path)
      )
        push({ entry: { type: 'file', path: f.path }, kind: '' })
    return out.slice(0, 100)
  }

  renderSuggestion(choice: ScopeChoice, el: HTMLElement): void {
    el.addClass('mod-complex')
    const icon = el.createDiv({ cls: 'suggestion-icon' }).createSpan({ cls: 'suggestion-flair' })
    setIcon(icon, ICONS[choice.entry.type])
    el.createDiv({ cls: 'suggestion-content' }).createDiv({
      cls: 'suggestion-title',
      text: choice.entry.path,
    })
    if (choice.kind)
      el.createDiv({ cls: 'suggestion-aux' }).createSpan({
        cls: 'suggestion-flair abele-scope-suggest__kind',
        text: choice.kind,
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
