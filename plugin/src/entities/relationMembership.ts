import { isWikilink, wikilinkToPath } from '@/helpers/pathsHelpers'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { normalizePath, TFile } from 'obsidian'
import dayjs from '@/helpers/dateLibrary'
import { DATE_FORMAT } from '@/constants/dates'

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
export function belongsToJournalDay(
  path: string,
  frontmatter: Record<string, any> | undefined,
  journalDate: dayjs.Dayjs | null
): boolean {
  if (!journalDate || !frontmatter) return false

  const date = frontmatter.due ?? frontmatter.date ?? frontmatter.created
  if (!date) return false

  const parsedDate = dayjs(date, DATE_FORMAT)
  if (!parsedDate.isValid() || !parsedDate.isSame(journalDate, 'date')) return false

  const config = AbeleConfig.getInstance()
  if (config.isLogType(frontmatter.type, path)) {
    return !config.journals.some((j) => j.checkIfNotePathIsJournal(path))
  }
  return true
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
export function isRelatedPath(
  path: string,
  rootPath: string,
  journalDate: dayjs.Dayjs | null
): boolean {
  const { app } = GlobalStore.getInstance()

  path = normalizePath(path)
  if (path === rootPath) return false

  const file = app.vault.getAbstractFileByPath(path)
  if (!(file instanceof TFile)) return false

  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter
  if (belongsToJournalDay(path, frontmatter, journalDate)) return true

  // One set for the whole question, as `findRelations` keeps one for the whole walk: a note
  // already looked at from one route has nothing new to say from another.
  const visited = new Set<string>()
  return linkedPaths(path).some((target) => isWalkedInto(target, visited, rootPath))
}

/**
 * Whether `findRelations` walks into `path` — this note itself, or a note grouped into one it
 * walks into. Those are the notes whose backlinks all belong here.
 */
export function isWalkedInto(path: string, visited: Set<string>, rootPath: string): boolean {
  if (path === rootPath) return true
  if (visited.has(path)) return false
  visited.add(path)

  const { app } = GlobalStore.getInstance()

  const file = app.vault.getAbstractFileByPath(path)
  if (!(file instanceof TFile)) return false

  const groups = app.metadataCache.getFileCache(file)?.frontmatter?.groups
  if (!Array.isArray(groups)) return false

  const linked = linkedPaths(path)
  for (const group of groups) {
    if (!isWikilink(group)) continue

    const groupFile = app.metadataCache.getFirstLinkpathDest(wikilinkToPath(group), file.path)
    if (!groupFile) continue

    const groupPath = normalizePath(groupFile.path)
    // `findRelations` reaches this note as a backlink of the group, and walks into it because
    // its groups name that group — both have to hold, and a note is never its own group.
    if (groupPath === path || !linked.includes(groupPath)) continue
    if (isWalkedInto(groupPath, visited, rootPath)) return true
  }

  return false
}

/** What `path` links to, counted the way the backlink index counts it. */
export function linkedPaths(path: string): string[] {
  const { app } = GlobalStore.getInstance()

  const targets = app.metadataCache.resolvedLinks[path] ?? {}
  return Object.keys(targets).filter((target) => targets[target])
}
