/**
 * The row of a groups property: Obsidian's own list editor, left exactly as it is — its link
 * pills that open their note, `[[` bringing up its link suggester, any note or text typed in —
 * with one button beside it that offers the notes the vault already uses as groups, most members
 * first, then any other note by name. A group is any note, so nothing typed into the list is
 * refused; the button is only a shortcut to the usual ones.
 *
 * An empty property has no type of its own yet and is drawn as text; it gets the list editor
 * here too, so the first group goes in the way the rest do.
 */
import { SuggestModal, setIcon, TFile, type App } from 'obsidian'
import './kinds.css'
import {
  addGroup,
  collectGroups,
  groupEntries,
  groupLink,
  groupLinkpath,
  suggestGroups,
} from './groups'
import type { GroupNote } from './groups'
import type { StockRender } from './kinds'
import type { WidgetContext } from './widgets'

/** The note an entry points at from `source`, or null when there is none. */
function resolve(app: App, entry: string, source: string): TFile | null {
  const linkpath = groupLinkpath(entry)
  if (!linkpath) return null
  return app.metadataCache.getFirstLinkpathDest(linkpath, source) ?? null
}

/** The notes the vault uses as groups under `key`, most members first, and every note by name. */
function vaultGroups(app: App, key: string) {
  const want = key.toLowerCase()
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
  return { groups, notes }
}

/** What the property holds in the note now: the list editor saves every edit made in it. */
function heldNow(app: App, ctx: WidgetContext, drawn: unknown): unknown {
  const file = app.vault.getAbstractFileByPath(ctx.sourcePath)
  const fm = file instanceof TFile ? app.metadataCache.getFileCache(file)?.frontmatter : null
  if (!fm) return drawn
  const want = ctx.key.toLowerCase()
  for (const k in fm) if (k.toLowerCase() === want) return fm[k]
  return null
}

/** The list the button opens: Obsidian's own suggester dialog, typed into to narrow it. */
export class GroupPicker extends SuggestModal<GroupNote> {
  /** The one opened last — for a test to reach, as nothing else holds it. */
  static last: GroupPicker | null = null
  private readonly vault: ReturnType<typeof vaultGroups>

  constructor(
    app: App,
    key: string,
    private readonly held: ReadonlySet<string>,
    private readonly take: (note: GroupNote) => void
  ) {
    super(app)
    this.vault = vaultGroups(app, key)
    this.setPlaceholder('Add a group…')
    this.emptyStateText = 'No such note'
    GroupPicker.last = this
  }

  getSuggestions(query: string): GroupNote[] {
    return suggestGroups(this.vault.groups, this.vault.notes, this.held, query)
  }

  renderSuggestion(note: GroupNote, el: HTMLElement): void {
    el.addClass('mod-complex')
    const content = el.createDiv({ cls: 'suggestion-content' })
    content.createDiv({ cls: 'suggestion-title', text: note.title })
    const folder = note.path.includes('/') ? note.path.slice(0, note.path.lastIndexOf('/')) : ''
    if (folder) content.createDiv({ cls: 'suggestion-note', text: folder })
    if (note.members) {
      el.createDiv({ cls: 'suggestion-aux' }).createSpan({
        cls: 'suggestion-flair',
        text: String(note.members),
        attr: { 'aria-label': `${note.members} in this group` },
      })
    }
  }

  onChooseSuggestion(note: GroupNote): void {
    this.take(note)
  }

  onClose(): void {
    super.onClose?.()
    if (GroupPicker.last === this) GroupPicker.last = null
  }
}

export function renderGroups(
  el: HTMLElement,
  value: unknown,
  ctx: WidgetContext,
  type: string,
  stock: StockRender
) {
  const list = stock('multitext')
  if (!list) return null
  el.empty()
  const { app } = ctx
  const widget = list(el, value, ctx) as { setValue?: (v: unknown) => void } | null
  let drawn = value

  const add = (note: GroupNote) => {
    const file = app.vault.getAbstractFileByPath(note.path)
    const linktext =
      file instanceof TFile
        ? app.metadataCache.fileToLinktext(file, ctx.sourcePath, true)
        : note.path.replace(/\.md$/i, '')
    const target = (entry: string) =>
      resolve(app, entry, ctx.sourcePath)?.path ?? groupLinkpath(entry)
    const next = addGroup(heldNow(app, ctx, drawn), groupLink(linktext), target)
    if (!next) return
    drawn = next
    widget?.setValue?.(next)
    ctx.onChange(next)
  }

  const button = el.createDiv({
    cls: 'clickable-icon abele-property-groups__pick',
    attr: { role: 'button', 'aria-label': 'Add a group' },
  })
  setIcon(button, 'layers')
  button.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    const held = new Set([
      ctx.sourcePath,
      ...groupEntries(heldNow(app, ctx, drawn))
        .map((entry) => resolve(app, entry, ctx.sourcePath)?.path)
        .filter((p): p is string => !!p),
    ])
    new GroupPicker(app, ctx.key, held, add).open()
  })

  if (widget && typeof widget === 'object') return widget
  return { containerEl: el, type }
}
