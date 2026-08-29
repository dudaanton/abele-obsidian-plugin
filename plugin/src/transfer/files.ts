/**
 * The scripts, skills and prompts themselves.
 *
 * The settings sections carry the *configuration* — which folder the scripts live in, what the
 * system prompt says. These carry the files: a transfer that names a scripts folder and leaves
 * the scripts behind hands the other device an empty folder.
 *
 * Skills and prompts are notes marked as such in their frontmatter and may sit anywhere, so
 * they travel by their path. A script is known by its place inside the scripts folder instead,
 * because the receiving vault is entitled to keep its scripts somewhere else.
 */
import { TFile, type App } from 'obsidian'
import type { EntryStatus, PlannedEntry } from './entries'
import type { TransferEntry, TransferFile } from './types'

const SKILL_TYPE = 'abele-skill'
const PROMPT_TYPE = 'abele-prompt'

const noteType = (app: App, file: TFile): unknown =>
  app.metadataCache.getFileCache(file)?.frontmatter?.type

/** Everything in the vault that a transfer can carry as a file. */
export async function collectFiles(app: App, scriptsFolder: string): Promise<TransferEntry[]> {
  const entries: TransferEntry[] = []

  if (scriptsFolder) {
    const prefix = `${scriptsFolder}/`
    for (const file of app.vault.getFiles()) {
      if (!file.path.startsWith(prefix) || file.extension !== 'js') continue
      entries.push({
        section: 'script-files',
        id: file.path,
        label: file.name,
        data: {
          path: file.path.slice(prefix.length),
          content: await app.vault.cachedRead(file),
          base: scriptsFolder,
        } satisfies TransferFile,
      })
    }
  }

  for (const file of app.vault.getMarkdownFiles()) {
    const type = noteType(app, file)
    if (type !== SKILL_TYPE && type !== PROMPT_TYPE) continue

    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter
    entries.push({
      section: type === SKILL_TYPE ? 'skill-notes' : 'prompt-notes',
      id: file.path,
      label: String(frontmatter?.name || file.basename),
      data: {
        path: file.path,
        content: await app.vault.cachedRead(file),
      } satisfies TransferFile,
    })
  }

  return entries.sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * Where a file goes on this device.
 *
 * A script follows this vault's scripts folder; only when there is none does it fall back to
 * the folder it came from, which at least keeps the transfer from being lost.
 */
export function targetPath(entry: TransferEntry, scriptsFolder: string): string {
  const file = entry.data as TransferFile
  if (entry.section !== 'script-files') return file.path

  const folder = scriptsFolder || file.base || ''
  return folder ? `${folder}/${file.path}` : file.path
}

/**
 * What each arriving file would do here.
 *
 * Takes the current contents rather than reading them: a plan is drawn synchronously while the
 * list renders, and reading a file is not. `readCurrent` gathers them in one pass beforehand.
 */
export function planFiles(
  entries: TransferEntry[],
  current: Map<string, string>,
  scriptsFolder: string
): PlannedEntry[] {
  return entries.map((entry) => {
    const path = targetPath(entry, scriptsFolder)
    if (!current.has(path)) return { entry, status: 'new' as EntryStatus }

    const same = current.get(path) === (entry.data as TransferFile).content
    return { entry, status: (same ? 'same' : 'replace') as EntryStatus }
  })
}

/** What the vault holds today for the paths these entries would write to. */
export async function readCurrent(
  app: App,
  entries: TransferEntry[],
  scriptsFolder: string
): Promise<Map<string, string>> {
  const current = new Map<string, string>()

  for (const entry of entries) {
    const file = app.vault.getFileByPath(targetPath(entry, scriptsFolder))
    if (file) current.set(file.path, await app.vault.cachedRead(file))
  }

  return current
}

export interface FilesApplied {
  written: number
  /** Paths the vault would not take, so the rest of the transfer is not lost with them. */
  failed: string[]
}

export async function applyFiles(
  app: App,
  entries: TransferEntry[],
  scriptsFolder: string
): Promise<FilesApplied> {
  let written = 0
  const failed: string[] = []

  for (const entry of entries) {
    const path = targetPath(entry, scriptsFolder)
    const { content } = entry.data as TransferFile

    try {
      const existing = app.vault.getFileByPath(path)
      if (existing) {
        await app.vault.modify(existing, content)
      } else {
        await ensureFolder(app, path)
        await app.vault.create(path, content)
      }
      written++
    } catch {
      failed.push(path)
    }
  }

  return { written, failed }
}

/** Obsidian will not create a file inside a folder it does not have. */
async function ensureFolder(app: App, path: string): Promise<void> {
  const folder = path.slice(0, path.lastIndexOf('/'))
  if (!folder) return

  const parts = folder.split('/')
  for (let i = 0; i < parts.length; i++) {
    const step = parts.slice(0, i + 1).join('/')
    if (await app.vault.adapter.exists(step)) continue
    try {
      await app.vault.createFolder(step)
    } catch {
      // Another entry in the same transfer got there first.
    }
  }
}
