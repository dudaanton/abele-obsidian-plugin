import type { App, TFile } from 'obsidian'
import { parseNoteContent } from './notesUtils'
import { getFolderFromPath, resolvePath } from './pathsHelpers'
import { cleanTaskName } from './tasksUtils'
import { getAvailablePath, readFileContent } from './vaultUtils'

/**
 * A task note is named after the first line of its text, and renamed whenever that line
 * changes. A line that links to the task's own note turns this into a loop: the rename makes
 * Obsidian rewrite the link to the new name, the rewritten link changes the line, and the
 * changed line asks for another rename — each round appending the old name to the new one.
 *
 * So a link to the note itself carries no part of the name. Its text is the name, derived
 * from the file rather than written by the user, and counting it would feed the name back
 * into itself. An aliased self-link keeps its alias, which Obsidian leaves alone on rename.
 */

const WIKILINK = /!?\[\[([^\]|]+?)(\|[^\]]*)?\]\]/g

/**
 * How long a name the plugin renamed a task away from still counts as that task's own. It
 * bridges the moment between the rename and Obsidian rewriting the links in the note, when
 * the note still links to a name that no longer exists.
 */
const FORMER_NAME_TTL_MS = 60_000

const formerNames = new Map<string, { names: Set<string>; at: number }>()
const renaming = new Set<string>()

function linkName(target: string): string {
  const name = target.split('/').pop() ?? target
  return name.replace(/\.md$/i, '').trim().toLowerCase()
}

function recentFormerNames(path: string): Set<string> | undefined {
  const entry = formerNames.get(path)
  if (!entry) return undefined
  if (Date.now() - entry.at > FORMER_NAME_TTL_MS) {
    formerNames.delete(path)
    return undefined
  }
  return entry.names
}

/** Whether a wikilink target in `file` points at `file` itself. */
export function isSelfLink(app: App, file: TFile, linkpath: string): boolean {
  const target = linkpath.split('#')[0].trim()
  // `[[#Heading]]` links into the note it is written in.
  if (target === '') return true

  const dest = app.metadataCache.getFirstLinkpathDest(target, file.path)
  if (dest) return dest.path === file.path

  const name = linkName(target)
  return name === file.basename.toLowerCase() || !!recentFormerNames(file.path)?.has(name)
}

/** Drops unaliased links to the note itself from a line of task text. */
export function stripSelfLinks(line: string, isSelf: (linkpath: string) => boolean): string {
  return line
    .replace(WIKILINK, (match, target: string, alias?: string) =>
      alias || !isSelf(target) ? match : ' '
    )
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The path a task note should have for its current text, or null when it already has it.
 * `date` is appended to the name of a recurring task, as its copies would otherwise collide.
 */
export async function taskFileTarget(
  app: App,
  file: TFile,
  date?: string | null
): Promise<string | null> {
  const parsed = await parseNoteContent(file, await readFileContent(file))
  const lines = parsed.content.split('\n').filter((line: string) => line.trim() !== '')

  let title = 'New Task'
  if (lines.length > 0) {
    const line = stripSelfLinks(lines[0], (target) => isSelfLink(app, file, target))
    // A first line that is nothing but a link to the note names nothing new.
    if (line === '') return null
    title = cleanTaskName(date ? `${line} ${date}` : line) || 'New Task'
  }

  const newPath = await getAvailablePath(
    resolvePath(getFolderFromPath(file.path), title),
    file.path
  )
  return newPath === file.path ? null : newPath
}

/**
 * Renames a task note after its text. Changes to a note the plugin is renaming right now are
 * the rename's own echo — Obsidian rewriting links in it — and are not acted on.
 */
export async function syncTaskFileName(app: App, file: TFile, date?: string | null): Promise<void> {
  if (renaming.has(file.path)) return

  const target = await taskFileTarget(app, file, date)
  if (!target || renaming.has(file.path)) return

  const from = file.path
  const previous = formerNames.get(from)
  const names = new Set(recentFormerNames(from) ?? [])
  names.add(file.basename.toLowerCase())
  formerNames.delete(from)
  formerNames.set(target, { names, at: Date.now() })

  renaming.add(from)
  renaming.add(target)
  try {
    await app.fileManager.renameFile(file, target)
  } catch (error) {
    formerNames.delete(target)
    if (previous) formerNames.set(from, previous)
    throw error
  } finally {
    renaming.delete(from)
    renaming.delete(target)
  }
}
