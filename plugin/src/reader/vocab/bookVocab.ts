/**
 * An open book's vocabulary: the rules that apply to it — notes whose properties name forms of a
 * word for this book or its language, and the book's highlights that name forms — kept on the
 * page's marks as the vault changes, and a tap on an underlined word answered.
 *
 * Notes are found by their properties, not by links: a card for every book in a language need not
 * link to this one. Every note's properties are looked at once when the book opens (Obsidian keeps
 * them parsed), then only the note Obsidian says changed.
 */
import { Menu, TFile, type App } from 'obsidian'
import { openLinkedNote, paneOf } from '../bookLinkedNotes'
import type { BookReading } from '../BookReading'
import type { MarkAlongside } from '../marks'
import {
  highlightRules,
  noteRuleOf,
  ruleApplies,
  ruleOfNote,
  type BookRef,
  type NoteRule,
  type VocabRule,
} from './rules'

/** The notes of the vault that hold a vocabulary rule, followed as they change. */
export class NoteRules {
  private byNote = new Map<string, NoteRule>()
  private off: (() => void)[] = []

  constructor(
    private readonly app: App,
    private readonly onChange: () => void
  ) {}

  start(): void {
    for (const file of this.app.vault.getMarkdownFiles()) this.read(file)
    const { metadataCache, vault } = this.app
    const changed = metadataCache.on('changed', (file) => {
      if (this.read(file)) this.onChange()
    })
    const deleted = metadataCache.on('deleted', (file) => {
      if (this.byNote.delete(file.path)) this.onChange()
    })
    const renamed = vault.on('rename', (file, oldPath) => {
      const had = this.byNote.delete(oldPath)
      const has = file instanceof TFile && this.read(file)
      if (had || has || this.byNote.has(file.path)) this.onChange()
    })
    this.off.push(
      () => metadataCache.offref(changed),
      () => metadataCache.offref(deleted),
      () => vault.offref(renamed)
    )
  }

  stop(): void {
    for (const off of this.off) off()
    this.off = []
    this.byNote.clear()
  }

  /** Reads one note's rule again; whether it changed. */
  private read(file: TFile): boolean {
    if (file.extension !== 'md') return false
    const rule = noteRuleOf(this.app.metadataCache.getFileCache(file)?.frontmatter)
    const before = this.byNote.get(file.path)
    if (!rule) return this.byNote.delete(file.path)
    this.byNote.set(file.path, rule)
    return JSON.stringify(before) !== JSON.stringify(rule)
  }

  /** The rules that apply to a book. */
  applying(book: BookRef): VocabRule[] {
    const out: VocabRule[] = []
    for (const [path, rule] of this.byNote) {
      const applies = ruleApplies(
        rule,
        book,
        (link) => this.app.metadataCache.getFirstLinkpathDest(link, path)?.path ?? null
      )
      if (applies) out.push(ruleOfNote(path, rule))
    }
    return out.sort((a, b) => a.label.localeCompare(b.label))
  }
}

interface SharedRules {
  notes: NoteRules
  listeners: Set<() => void>
}

const sharedRules = new WeakMap<App, SharedRules>()

/** One vault scan and set of listeners while any book tab needs vocabulary. */
function acquireRules(app: App, publish: () => void): { notes: NoteRules; stop(): void } {
  let shared = sharedRules.get(app)
  if (!shared) {
    const listeners = new Set<() => void>()
    const notes = new NoteRules(app, () => { for (const listener of listeners) listener() })
    shared = { notes, listeners }
    sharedRules.set(app, shared)
    notes.start()
  }
  const current = shared
  current.listeners.add(publish)
  let stopped = false
  return {
    notes: current.notes,
    stop: () => {
      if (stopped) return
      stopped = true
      current.listeners.delete(publish)
      if (!current.listeners.size) {
        current.notes.stop()
        sharedRules.delete(app)
      }
    },
  }
}

/** Where a rule leads, opened: its note, or its highlight's entry in the highlights note. */
async function openRule(
  app: App,
  reading: BookReading,
  rule: VocabRule,
  evt?: MouseEvent | KeyboardEvent
): Promise<void> {
  if (rule.target.kind === 'note') {
    await openLinkedNote(app, { path: rule.target.path, line: 0 }, paneOf(evt))
    return
  }
  const { cfi } = rule.target
  const h = reading.highlights().find((x) => x.cfi === cfi)
  if (h) await reading.openNote(h, paneOf(evt))
}

/**
 * An underlined word tapped: the one rule's target opened, or a menu of the rules — with the
 * highlight or linked notes under the same words first, when there are.
 */
export function openRules(
  app: App,
  reading: BookReading,
  rules: VocabRule[],
  at: { x: number; y: number },
  alongside: MarkAlongside | null
): void {
  if (!rules.length) return
  if (rules.length === 1 && !alongside) {
    void openRule(app, reading, rules[0])
    return
  }
  const menu = new Menu()
  if (alongside) {
    menu.addItem((item) =>
      item
        .setTitle(alongside.kind === 'highlight' ? 'Highlight' : 'Notes linking here')
        .setIcon(alongside.kind === 'highlight' ? 'highlighter' : 'link')
        .onClick(() => alongside.open())
    )
    menu.addSeparator()
  }
  for (const rule of rules)
    menu.addItem((item) =>
      item
        .setTitle(rule.label)
        .setIcon(rule.target.kind === 'note' ? 'file-text' : 'quote')
        .onClick((evt) => void openRule(app, reading, rule, evt))
    )
  menu.showAtPosition(at)
}

/** The book's vocabulary kept on its marks; stop it when the book closes. */
export function vocabFor(
  app: App,
  book: TFile,
  reading: BookReading,
  languages: string[]
): { stop(): void; publish(): void } {
  const marks = reading.marks.vocab
  if (!marks) return { stop: () => {}, publish: () => {} }
  // The book's path as it is now: renamed, the file is the same object.
  const ref: BookRef = {
    get path() {
      return book.path
    },
    languages,
  }
  const publish = () =>
    marks.setRules([...notes.applying(ref), ...highlightRules(reading.highlights())])
  const shared = acquireRules(app, publish)
  const notes = shared.notes
  reading.marks.onWords = (rules, at, alongside) => openRules(app, reading, rules, at, alongside)
  reading.onHighlights = publish
  publish()
  return {
    publish,
    stop: () => {
      shared.stop()
      marks.stop()
      reading.onHighlights = () => {}
    },
  }
}
