import { App, FuzzySuggestModal, type Command, type FuzzyMatch } from 'obsidian'
import type { ParsedScript } from '@/scripting/types'

/**
 * Choosing what a header button or a link runs, by typing part of its name.
 *
 * These used to be `Dropdown`s. A dropdown lists everything and offers no way to search it, so
 * with a folder of scripts — let alone Obsidian's several hundred commands — finding the one
 * you meant was scrolling a list on a phone. This is the modal the command palette is built
 * from: the list narrows as you type, and what comes back is always something that exists,
 * which a free-text field with suggestions could not promise.
 */
class RunnablePicker<T> extends FuzzySuggestModal<T> {
  private resolve: (item: T | null) => void = () => {}
  private picked = false

  constructor(
    app: App,
    private readonly items: T[],
    private readonly title: (item: T) => string,
    private readonly subtitle: (item: T) => string,
    placeholder: string
  ) {
    super(app)
    this.setPlaceholder(placeholder)
  }

  getItems(): T[] {
    return this.items
  }

  /** What the query is matched against — the description too, so a script is findable by what it does. */
  getItemText(item: T): string {
    return `${this.title(item)} ${this.subtitle(item)}`.trim()
  }

  /**
   * Name over description, in Obsidian's own suggestion classes so the theme styles both.
   * Built through the row itself rather than the ambient `createDiv`, which belongs to the
   * main window — and settings, since 1.13, can be a window of its own.
   */
  renderSuggestion(match: FuzzyMatch<T>, el: HTMLElement): void {
    el.createDiv({ cls: 'suggestion-title', text: this.title(match.item) })

    const subtitle = this.subtitle(match.item)
    if (subtitle) el.createDiv({ cls: 'suggestion-note', text: subtitle })
  }

  onChooseItem(item: T): void {
    this.picked = true
    this.resolve(item)
  }

  onClose(): void {
    window.setTimeout(() => {
      if (!this.picked) this.resolve(null)
    }, 0)
  }

  pick(): Promise<T | null> {
    return new Promise((resolve) => {
      this.resolve = resolve
      this.open()
    })
  }
}

/** Every command Obsidian knows. Not part of the plugin API, so the reach for it lives here. */
export function listCommands(app: App): Command[] {
  return (app as unknown as { commands: { listCommands(): Command[] } }).commands.listCommands()
}

export function pickScript(app: App, scripts: ParsedScript[]): Promise<ParsedScript | null> {
  return new RunnablePicker(
    app,
    scripts,
    (script) => script.meta.name,
    (script) => script.meta.description,
    'Search for a script...'
  ).pick()
}

export function pickCommand(app: App): Promise<Command | null> {
  return new RunnablePicker(
    app,
    [...listCommands(app)].sort((a, b) => a.name.localeCompare(b.name)),
    (command) => command.name,
    () => '',
    'Search for a command...'
  ).pick()
}
