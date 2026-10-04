import { isWikilink, pathToWikilink, wikilinkToPath } from '@/helpers/pathsHelpers'
import { getBacklinksByPath } from '@/helpers/vaultUtils'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { normalizePath, TFile } from 'obsidian'
import { Task } from './Task'
import { Transaction } from './Transaction'
import { TimeEntry } from './TimeEntry'
import { Log } from './Log'
import { Note } from './Note'
import { markRaw, reactive, shallowRef, toRaw } from 'vue'
import { Journal } from './Journal'
import { acquireVaultNoteIndex } from './vaultNoteIndex'
import { acquireVaultRelationBatches } from './vaultRelationBatches'
import type { RelationChange } from './RelationBatchRouter'
import dayjs from '@/helpers/dateLibrary'
import { DATE_FORMAT } from '@/constants/dates'

export class NoteRelations {
  public filePath: string
  private readonly rootIdentity?: TFile

  /**
   * The journal and day live in refs of their own: they are set by the vault's events, which
   * reach this object itself rather than the reactive copy a footer draws from, and a footer
   * drawn before its note's day was known has to show it once it is.
   */
  private readonly journalState = markRaw({
    journal: shallowRef<Journal | null>(null),
    date: shallowRef<dayjs.Dayjs | null>(null),
  })

  public get journal(): Journal | null {
    return this.journalState.journal.value
  }

  public set journal(journal: Journal | null) {
    this.journalState.journal.value = journal
  }

  public get journalDate(): dayjs.Dayjs | null {
    return this.journalState.date.value
  }

  public set journalDate(date: dayjs.Dayjs | null) {
    this.journalState.date.value = date
  }

  tasks: Map<string, Task> = reactive(new Map())
  transactions: Map<string, Transaction> = reactive(new Map())
  timeEntries: Map<string, TimeEntry> = reactive(new Map())
  logs: Map<string, Log> = reactive(new Map())
  notes: Map<string, Note> = reactive(new Map())

  private noteIndex: ReturnType<typeof acquireVaultNoteIndex> | null = null
  private isActive = false
  private resolved = false
  private batches: ReturnType<typeof acquireVaultRelationBatches> | null = null
  private routing: ReturnType<
    ReturnType<typeof acquireVaultRelationBatches>['router']['subscribe']
  > | null = null

  // to avoid debounced calls after cleanup
  private cleanedUp = false

  constructor(filePath: string) {
    this.filePath = normalizePath(filePath)
    const root = GlobalStore.getInstance().app.vault.getAbstractFileByPath(this.filePath)
    this.rootIdentity = root instanceof TFile ? toRaw(root) : undefined

    this.tellJournal()
    this.findRelations(this.filePath)
    this.startWatching()
  }

  /**
   * Which default journal this note is, and its day — told from the note's metadata. Returns
   * whether that changed.
   *
   * A note open when Obsidian starts is reached before the metadata cache has read it, and is
   * told to be no journal at all; it is told again once the metadata arrives.
   */
  private tellJournal(): boolean {
    let journal: Journal | null = null
    let date: dayjs.Dayjs | null = null
    for (const candidate of AbeleConfig.getInstance().journals) {
      const found = candidate.checkIfNotePathIsJournal(this.filePath)
      if (found && candidate.isDefault) {
        journal = candidate
        date = found
        break
      }
    }

    const same =
      journal === this.journal &&
      (date && this.journalDate
        ? date.isSame(this.journalDate, 'date')
        : !date && !this.journalDate)
    if (same) return false

    this.journal = journal
    this.journalDate = date
    return true
  }

  /** The note's own metadata changed or arrived: a journal it has become brings its day in. */
  private retellJournal(): void {
    if (!this.tellJournal()) return
    this.removeRemainingRelations()
    this.findRelations(this.filePath)
  }

  private addTask(path: string) {
    path = normalizePath(path)
    if (!this.tasks.has(path)) {
      const task = reactive(new Task({ wikilink: pathToWikilink(path) }))
      task.load()
      this.tasks.set(path, task as Task)
    }
  }

  private removeTask(path: string) {
    path = normalizePath(path)

    const task = this.tasks.get(path)
    if (task) {
      task.cleanup()
      this.tasks.delete(path)
    }

    return task
  }

  private addTransaction(path: string) {
    path = normalizePath(path)
    if (!this.transactions.has(path)) {
      const transaction = reactive(new Transaction({ wikilink: pathToWikilink(path) }))
      transaction.load()
      this.transactions.set(path, transaction as Transaction)
    }
  }

  private removeTransaction(path: string) {
    path = normalizePath(path)

    const transaction = this.transactions.get(path)
    if (transaction) {
      transaction.cleanup()
      this.transactions.delete(path)
    }

    return transaction
  }

  private addTimeEntry(path: string) {
    path = normalizePath(path)
    if (!this.timeEntries.has(path)) {
      const entry = reactive(new TimeEntry({ wikilink: pathToWikilink(path) }))
      entry.load()
      this.timeEntries.set(path, entry as TimeEntry)
    }
  }

  private removeTimeEntry(path: string) {
    path = normalizePath(path)

    const entry = this.timeEntries.get(path)
    if (entry) {
      entry.cleanup()
      this.timeEntries.delete(path)
    }

    return entry
  }

  private addLog(path: string) {
    path = normalizePath(path)
    if (!this.logs.has(path)) {
      const log = reactive(new Log(path, this.filePath))
      log.load()
      this.logs.set(path, log as Log)
    }
  }

  private removeLog(path: string) {
    path = normalizePath(path)

    const log = this.logs.get(path)
    if (log) {
      log.cleanup()
      this.logs.delete(path)
    }

    return log
  }

  private addNote(path: string) {
    path = normalizePath(path)
    if (!this.notes.has(path)) {
      const note = reactive(new Note(path))
      note.load()
      this.notes.set(path, note as Note)
    }
  }

  private removeNote(path: string) {
    path = normalizePath(path)

    const note = this.notes.get(path)
    if (note) {
      note.cleanup()
      this.notes.delete(path)
    }

    return note
  }

  private hasPath(path: string): boolean {
    path = normalizePath(path)
    return (
      this.tasks.has(path) ||
      this.transactions.has(path) ||
      this.timeEntries.has(path) ||
      this.logs.has(path) ||
      this.notes.has(path)
    )
  }

  /**
   * Adds a backlink and its nested relations to the respective maps
   * @param filePath - The main file path
   * @param backlink - The backlink to add
   * @param expandedGroupPaths - Internal parameter; see findRelations
   */
  private addBacklink(
    filePath: string,
    backlink: string,
    expandedGroupPaths: Set<string> = new Set()
  ): void {
    const { app } = GlobalStore.getInstance()

    // avoid self-references
    if (normalizePath(backlink) === normalizePath(filePath)) return

    const file = app.vault.getAbstractFileByPath(backlink)
    if (!(file instanceof TFile)) return

    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter

    const type = frontmatter?.type
    const groups = frontmatter?.groups

    const destination =
      type === 'task'
        ? this.tasks
        : type === 'transaction'
          ? this.transactions
          : type === 'time-entry'
            ? this.timeEntries
            : AbeleConfig.getInstance().isLogType(type, file.path)
              ? this.logs
              : this.notes

    if (!destination.has(file.path)) {
      // Keep unchanged entities alive, but dispose the old kind before reclassifying a note.
      this.removeTask(file.path)
      this.removeTransaction(file.path)
      this.removeTimeEntry(file.path)
      this.removeLog(file.path)
      this.removeNote(file.path)
      if (type === 'task') {
        this.addTask(file.path)
      } else if (type === 'transaction') {
        this.addTransaction(file.path)
      } else if (type === 'time-entry') {
        this.addTimeEntry(file.path)
      } else if (AbeleConfig.getInstance().isLogType(type, file.path)) {
        this.addLog(file.path)
      } else {
        this.addNote(file.path)
      }
    }

    // If the note is grouped into the current file, check for tasks and logs in the group note
    if (Array.isArray(groups) && groups.length > 0) {
      for (const group of groups) {
        if (!isWikilink(group)) continue

        const groupFile = app.metadataCache.getFirstLinkpathDest(wikilinkToPath(group), file.path)
        if (!groupFile) continue

        const groupPath = normalizePath(groupFile.path)
        if (groupPath === filePath && !expandedGroupPaths.has(backlink)) {
          // Marked before recursing, so a node reached again later in the same traversal is
          // recognised as already expanded rather than walked a second time.
          expandedGroupPaths.add(backlink)
          this.findRelations(file.path, expandedGroupPaths)
        }
      }
    }
  }

  /**
   * Finds all relations (tasks, logs, notes) linked to the given file path
   * and adds them to the respective maps
   *
   * @param filePath - The file path to find relations for
   * @param expandedGroupPaths - Internal parameter: the group notes already walked during
   *   this traversal. It is one set shared by the whole walk, not a per-branch trail.
   *
   *   Groups form a graph rather than a tree — a note can belong to several groups, and
   *   those groups to a common parent — so a note is reachable by more than one route. A
   *   per-branch trail only recognises a repeat within a single route, leaving every diamond
   *   in the graph to be walked once per route through it, which compounds: each level of
   *   stacked diamonds doubles the number of routes and therefore the work.
   *
   *   How much this costs depends entirely on the shape of a vault's groups. Where notes
   *   mostly belong to one group the graph is nearly a tree and the saving is small — on the
   *   43k-file test vault, whose generator gives most notes a single group, it removes about
   *   7% of the metadata reads. Where multi-group membership stacks up it is the difference
   *   between linear and exponential: eight levels of diamonds cost 8,754 metadata reads
   *   with a per-branch trail and 116 with this set.
   *
   *   Walking a node twice cannot add anything the first walk missed: every add is guarded
   *   by its destination map, and the walk from a given node depends only on that node. So collapsing
   *   the repeats leaves the resulting relation set unchanged.
   *
   *   The set deliberately lives for one traversal rather than for the instance's lifetime:
   *   `findRelations` also runs incrementally when metadata changes, and a set that
   *   persisted would make those later runs skip the very nodes they were called to revisit.
   */
  findRelations(filePath: string, expandedGroupPaths: Set<string> = new Set()): void {
    const { app } = GlobalStore.getInstance()

    filePath = normalizePath(filePath)

    const backlinks = getBacklinksByPath(filePath)

    for (const backlink of backlinks) {
      this.addBacklink(filePath, backlink, expandedGroupPaths)
    }

    if (this.journalDate && this.filePath === filePath) {
      this.noteIndex ??= acquireVaultNoteIndex(app)
      const paths = this.noteIndex.index.pathsOnDay(this.journalDate.format(DATE_FORMAT))

      for (const path of paths) {
        if (path === this.filePath) continue
        const note = app.vault.getAbstractFileByPath(path)
        if (!(note instanceof TFile)) continue

        const cache = app.metadataCache.getFileCache(note)?.frontmatter
        if (!this.belongsToJournalDay(note.path, cache)) continue

        if (cache.type === 'task') {
          this.addTask(note.path)
        } else if (cache.type === 'transaction') {
          this.addTransaction(note.path)
        } else if (cache.type === 'time-entry') {
          this.addTimeEntry(note.path)
        } else if (AbeleConfig.getInstance().isLogType(cache.type, note.path)) {
          this.addLog(note.path)
        } else {
          this.addNote(note.path)
        }
      }
    }
  }

  /**
   * Whether a note belongs to this journal's day — the one rule for it, used both when the
   * journal is opened and when a note changes while it is open.
   *
   * A note belongs to the day of its `due`, else its `date`, else its `created`. The two used to
   * be written separately and disagreed: a note changing later was taken in if *any* of those
   * fell on the day. A task made today for next week therefore appeared in today's daily note
   * the moment it was created and was gone the next time the note was opened.
   *
   * Another journal is never a log of this one, even when it is dated to the same day.
   */
  private belongsToJournalDay(path: string, frontmatter: Record<string, any> | undefined): boolean {
    if (!this.journalDate || !frontmatter) return false

    const date = frontmatter.due ?? frontmatter.date ?? frontmatter.created
    if (!date) return false

    const parsedDate = dayjs(date, DATE_FORMAT)
    if (!parsedDate.isValid() || !parsedDate.isSame(this.journalDate, 'date')) return false

    const config = AbeleConfig.getInstance()
    if (config.isLogType(frontmatter.type, path)) {
      return !config.journals.some((j) => j.checkIfNotePathIsJournal(path))
    }
    return true
  }

  /**
   * A note other than this one was renamed: drop it under its old name and judge it afresh
   * under the new one, as reopening this note would.
   *
   * It used to carry the entry across unjudged. A task is renamed after its first line when
   * the editor saves, and the same save can give it a date. When the rename landed before the
   * metadata pass ended, the `changed` for the date was judged under the new name — not listed
   * yet, so nothing to take out — and the old entry was then moved to the new name as it was.
   * A task made today for another day stayed in today's note until the note was reopened.
   */
  private relationRenameCallback(oldPath: string, newPath: string): void {
    oldPath = normalizePath(oldPath)
    newPath = normalizePath(newPath)

    const wasRelated = this.hasPath(oldPath)
    if (wasRelated) {
      this.removeTask(oldPath)
      this.removeTransaction(oldPath)
      this.removeTimeEntry(oldPath)
      this.removeLog(oldPath)
      this.removeNote(oldPath)
    }

    if (this.isRelatedPath(newPath)) {
      this.addBacklink(this.filePath, newPath)
      if (this.isWalkedInto(newPath, new Set())) this.findRelations(newPath)
    }
    // Stale descendants are reconciled once at the end of the resolved batch.
  }

  /**
   * Whether `path` belongs among this note's relations — `findRelations` asked backwards, and
   * nothing looser, so a note changing while this one is open lands exactly where reopening
   * this one would put it.
   *
   * Opening gathers what links to this note and walks on only into notes *grouped* into it (and
   * into notes grouped into those). So a note belongs if it links to one of the notes that walk
   * reaches, or — for a journal — if it is dated to the journal's day.
   *
   * This used to be a looser rule of its own: a note belonged if it linked to anything that
   * linked here, or was grouped under anything that did. A task for next week filed under a
   * meeting note that mentions today appeared in today's daily note the moment it was made, and
   * was gone the next time the note was opened.
   */
  private isRelatedPath(path: string): boolean {
    const { app } = GlobalStore.getInstance()

    path = normalizePath(path)
    if (path === this.filePath) return false

    const file = app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) return false

    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter
    if (this.belongsToJournalDay(path, frontmatter)) return true

    // One set for the whole question, as `findRelations` keeps one for the whole walk: a note
    // already looked at from one route has nothing new to say from another.
    const visited = new Set<string>()
    return this.linkedPaths(path).some((target) => this.isWalkedInto(target, visited))
  }

  /**
   * Whether `findRelations` walks into `path` — this note itself, or a note grouped into one it
   * walks into. Those are the notes whose backlinks all belong here.
   */
  private isWalkedInto(path: string, visited: Set<string>): boolean {
    if (path === this.filePath) return true
    if (visited.has(path)) return false
    visited.add(path)

    const { app } = GlobalStore.getInstance()

    const file = app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) return false

    const groups = app.metadataCache.getFileCache(file)?.frontmatter?.groups
    if (!Array.isArray(groups)) return false

    const linked = this.linkedPaths(path)
    for (const group of groups) {
      if (!isWikilink(group)) continue

      const groupFile = app.metadataCache.getFirstLinkpathDest(wikilinkToPath(group), file.path)
      if (!groupFile) continue

      const groupPath = normalizePath(groupFile.path)
      // `findRelations` reaches this note as a backlink of the group, and walks into it because
      // its groups name that group — both have to hold, and a note is never its own group.
      if (groupPath === path || !linked.includes(groupPath)) continue
      if (this.isWalkedInto(groupPath, visited)) return true
    }

    return false
  }

  /** What `path` links to, counted the way the backlink index counts it. */
  private linkedPaths(path: string): string[] {
    const { app } = GlobalStore.getInstance()

    const targets = app.metadataCache.resolvedLinks[path] ?? {}
    return Object.keys(targets).filter((target) => targets[target])
  }

  /**
   * Is called when a relation in removed from the note (e.g. link deleted from the content),
   * but not if the note itself is deleted
   * @param path - The path of the deleted relation
   */
  private unlinkPath(path: string): void {
    path = normalizePath(path)

    const task = this.removeTask(path)
    const transaction = this.removeTransaction(path)
    const timeEntry = this.removeTimeEntry(path)
    const log = this.removeLog(path)
    const note = this.removeNote(path)

    if (!task && !transaction && !timeEntry && !log && !note) return
  }

  /**
   * Removes all relations that are no longer linked from the main file
   */
  private removeRemainingRelations(): void {
    const allPaths = [
      ...this.tasks.keys(),
      ...this.transactions.keys(),
      ...this.timeEntries.keys(),
      ...this.logs.keys(),
      ...this.notes.keys(),
    ]

    for (const path of allPaths) {
      if (!this.isRelatedPath(path)) {
        this.removeTask(path)
        this.removeTransaction(path)
        this.removeTimeEntry(path)
        this.removeLog(path)
        this.removeNote(path)
      }
    }
  }

  private refreshRouting(): void {
    this.routing?.update(
      this.filePath,
      this.journalDate?.format(DATE_FORMAT) ?? null,
      [
        this.filePath,
        ...this.tasks.keys(),
        ...this.transactions.keys(),
        ...this.timeEntries.keys(),
        ...this.logs.keys(),
        ...this.notes.keys(),
      ],
      toRaw(this.rootIdentity)
    )
  }

  private applyChanges(changes: RelationChange[]): void {
    if (this.cleanedUp) return
    if (!this.resolved) {
      if (this.tellJournal()) this.removeRemainingRelations()
      this.findRelations(this.filePath)
      this.resolved = true
    }
    // A folder notification can enumerate children before this summary's own note. Apply
    // its complete rename chain first, so children are judged against the final root path.
    const ownMoves = new Set<RelationChange>()
    const owns = (change: RelationChange, path: string | undefined) =>
      change.identity !== undefined && this.rootIdentity !== undefined
        ? change.identity === toRaw(this.rootIdentity)
        : path === this.filePath
    for (const move of changes) {
      if (move.kind !== 'rename' || !owns(move, move.oldPath)) continue
      this.filePath = move.path
      ownMoves.add(move)
    }
    if (ownMoves.size) this.retellJournal()
    let reconcile = false
    for (const change of changes) {
      if (this.cleanedUp) return
      try {
        const { path, oldPath } = change
        if (change.kind === 'delete') {
          if (owns(change, path)) {
            this.cleanup()
            return
          }
          if (this.hasPath(path)) {
            this.unlinkPath(path)
            reconcile = true
          }
        } else if (change.kind === 'rename') {
          if (ownMoves.has(change)) continue
          reconcile ||= this.hasPath(oldPath)
          this.relationRenameCallback(oldPath, path)
        } else {
          if (path === this.filePath) this.retellJournal()
          const wasRelated = this.hasPath(path)
          if (this.isRelatedPath(path)) {
            this.addBacklink(this.filePath, path)
            if (this.isWalkedInto(path, new Set())) this.findRelations(path)
          } else if (wasRelated) this.unlinkPath(path)
          reconcile ||= wasRelated
        }
      } catch (error) {
        console.error(`[Abele] NoteRelations: a change for ${this.filePath} failed`, error)
      }
    }
    if (reconcile) this.removeRemainingRelations()
    this.refreshRouting()
  }

  private startWatching(): void {
    if (this.isActive) return
    this.batches = acquireVaultRelationBatches(GlobalStore.getInstance().app)
    this.routing = this.batches.router.subscribe((changes) => this.applyChanges(changes))
    this.refreshRouting()
    this.isActive = true
  }

  removeRelations(): void {
    this.tasks.forEach((_, path) => {
      this.removeTask(path)
    })

    this.transactions.forEach((_, path) => {
      this.removeTransaction(path)
    })

    this.timeEntries.forEach((_, path) => {
      this.removeTimeEntry(path)
    })

    this.logs.forEach((_, path) => {
      this.removeLog(path)
    })

    this.notes.forEach((_, path) => {
      this.removeNote(path)
    })
  }

  cleanup(): void {
    if (!this.isActive) return
    this.cleanedUp = true

    this.routing?.stop()
    this.routing = null
    this.batches?.release()
    this.batches = null
    this.removeRelations()
    this.noteIndex?.release()
    this.noteIndex = null
    this.isActive = false
  }
}
