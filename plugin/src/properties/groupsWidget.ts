/**
 * The row of a groups property: each group as Obsidian's own link pill — the group note's name,
 * opened by a click (in a new tab with Mod, as any link), shown as a link to nothing when the note
 * is not there — each with its ×, and a field that adds one more, picked from the notes the vault
 * already uses as groups, most members first, or from any other note by name.
 *
 * There is no free text: a group is a note, and a link to a note that does not exist groups
 * nothing (`ScopeResolver` skips it). Backspace in the empty field takes the last group off.
 */
import { AbstractInputSuggest, Keymap, setIcon, TFile, type App } from 'obsidian'
import './kinds.css'
import {
  addGroup,
  collectGroups,
  groupEntries,
  groupLink,
  groupLinkpath,
  groupTitle,
  removeGroupAt,
  suggestGroups,
  type GroupNote,
} from './groups'
import type { WidgetContext } from './widgets'

/** The note an entry points at from `source`, or null when there is none. */
function resolve(app: App, entry: string, source: string): TFile | null {
  const linkpath = groupLinkpath(entry)
  if (!linkpath) return null
  return app.metadataCache.getFirstLinkpathDest(linkpath, source) ?? null
}

/**
 * The notes the vault uses as groups under `key`, most members first, and every note by name.
 * Read once each time the field is entered and kept while it is typed into.
 */
let known: {
  key: string
  at: number
  groups: GroupNote[]
  notes: { path: string; title: string }[]
} | null = null

function vaultGroups(app: App, key: string) {
  const want = key.toLowerCase()
  if (known && known.key === want && Date.now() - known.at < 5000) return known
  const values: { value: unknown; source: string }[] = []
  const files = app.vault.getMarkdownFiles()
  for (const file of files) {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter
    if (!fm) continue
    for (const k in fm)
      if (k.toLowerCase() === want) values.push({ value: fm[k], source: file.path })
  }
  const titles = new Map(files.map((f) => [f.path, f.basename]))
  const groups = collectGroups(
    values,
    (entry, source) => resolve(app, entry, source)?.path ?? null,
    (path) => titles.get(path) ?? path
  )
  const notes = files.map((f) => ({ path: f.path, title: f.basename }))
  known = { key: want, at: Date.now(), groups, notes }
  return known
}

class GroupSuggest extends AbstractInputSuggest<GroupNote> {
  shown = false

  constructor(
    app: App,
    private readonly field: HTMLInputElement,
    private readonly key: string,
    private readonly held: () => Set<string>,
    private readonly take: (note: GroupNote) => void
  ) {
    super(app, field)
  }

  protected getSuggestions(query: string): GroupNote[] {
    const { groups, notes } = vaultGroups(this.app, this.key)
    return suggestGroups(groups, notes, this.held(), query)
  }

  renderSuggestion(note: GroupNote, el: HTMLElement): void {
    el.addClass('mod-complex', 'abele-property-groups__choice')
    const content = el.createDiv({ cls: 'suggestion-content' })
    content.createDiv({ cls: 'suggestion-title', text: note.title })
    const folder = note.path.includes('/') ? note.path.slice(0, note.path.lastIndexOf('/')) : ''
    if (folder) content.createDiv({ cls: 'suggestion-note', text: folder })
    if (note.members) {
      const aux = el.createDiv({ cls: 'suggestion-aux' })
      aux.createSpan({
        cls: 'suggestion-flair',
        text: String(note.members),
        attr: { 'aria-label': `${note.members} in this group` },
      })
    }
  }

  selectSuggestion(note: GroupNote): void {
    this.take(note)
    this.field.value = ''
    this.close()
  }

  open(): void {
    this.shown = true
    super.open()
  }

  close(): void {
    this.shown = false
    super.close()
  }
}

export function renderGroups(el: HTMLElement, value: unknown, ctx: WidgetContext, type: string) {
  el.empty()
  const { app } = ctx
  let current = value
  const row = el.createDiv({ cls: 'multi-select-container abele-property-groups' })
  const pills = row.createDiv({ cls: 'abele-property-groups__pills' })
  const input = row.createEl('input', {
    cls: 'abele-property-groups__input',
    attr: {
      type: 'text',
      placeholder: 'Add group',
      'aria-label': 'Add group',
      autocapitalize: 'none',
      enterkeyhint: 'done',
    },
  })

  const write = (next: string[] | null) => {
    current = next
    show(next)
    ctx.onChange(next)
  }
  const target = (entry: string) =>
    resolve(app, entry, ctx.sourcePath)?.path ?? groupLinkpath(entry)
  const add = (note: GroupNote) => {
    const file = app.vault.getAbstractFileByPath(note.path)
    const linktext =
      file instanceof TFile
        ? app.metadataCache.fileToLinktext(file, ctx.sourcePath, true)
        : note.path.replace(/\.md$/i, '')
    const next = addGroup(current, groupLink(linktext), target)
    if (next) write(next)
  }
  const removeAt = (index: number) => write(removeGroupAt(current, index))

  const show = (v: unknown) => {
    pills.empty()
    groupEntries(v).forEach((entry, index) => {
      const file = resolve(app, entry, ctx.sourcePath)
      const linkpath = groupLinkpath(entry)
      const title = groupTitle(entry, file?.basename)
      const pill = pills.createDiv({ cls: 'multi-select-pill abele-property-groups__pill' })
      pill.dataset.group = file?.path ?? linkpath
      const link = pill.createDiv({
        cls: 'multi-select-pill-content internal-link',
        text: title,
        attr: { 'data-href': linkpath },
      })
      if (!file) link.addClass('is-unresolved')
      link.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        void app.workspace.openLinkText(linkpath, ctx.sourcePath, Keymap.isModEvent(e))
      })
      link.addEventListener('mouseover', (e) => {
        app.workspace.trigger('hover-link', {
          event: e,
          source: 'preview',
          hoverParent: { hoverPopover: null },
          targetEl: link,
          linktext: linkpath,
          sourcePath: ctx.sourcePath,
        })
      })
      const x = pill.createDiv({
        cls: 'multi-select-pill-remove-button',
        attr: { role: 'button', 'aria-label': `Remove ${title}` },
      })
      setIcon(x, 'x')
      x.addEventListener('click', (e) => {
        e.stopPropagation()
        removeAt(index)
      })
    })
  }

  // Entered again: what the vault holds may have changed since the last read.
  input.addEventListener('focus', () => (known = null), true)
  const held = () =>
    new Set([
      ctx.sourcePath,
      ...groupEntries(current).map((e) => resolve(app, e, ctx.sourcePath)?.path ?? ''),
    ])
  const suggest = new GroupSuggest(app, input, ctx.key, held, add)
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return
    if (e.key === 'Enter' && !suggest.shown) {
      e.preventDefault()
    } else if (e.key === 'Backspace' && !input.value) {
      const entries = groupEntries(current)
      if (entries.length) removeAt(entries.length - 1)
    } else if (e.key === 'Escape') {
      input.value = ''
      input.blur()
    }
  })
  // A click on the row, between the pills, is a click into the field.
  row.addEventListener('click', (e) => {
    if (e.target === row || e.target === pills) input.focus()
  })
  show(current)

  return {
    containerEl: el,
    type,
    inputEl: input,
    focus: () => input.focus(),
    onFocus: () => input.focus(),
    setValue: (next: unknown) => {
      current = next
      show(next)
    },
  }
}
