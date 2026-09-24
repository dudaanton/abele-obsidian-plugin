import type { App, TFile } from 'obsidian'
import dayjs from 'dayjs'
import { DATE_FORMAT } from '@/constants/dates'
import { AbeleConfig } from '@/services/AbeleConfig'
import { parseNoteContent, renderTemplate } from './notesUtils'
import { cleanFileName } from './pathsHelpers'
import { cleanTaskName } from './tasksUtils'
import { getAvailablePath } from './vaultUtils'

const stripWikilink = (s?: string | null) => (s ? s.replace(/\[\[|\]\]/g, '').trim() : '')

/** Two paths for one note: equal less the extension and the dots and spaces a name may lose. */
function samePath(a: string, b: string): boolean {
  const bare = (path: string) => {
    const slash = path.lastIndexOf('/')
    const name = cleanFileName(path.slice(slash + 1).replace(/\.md$/, ''))
    return `${path.slice(0, slash + 1)}${name.replace(/[.\s]+$/, '')}`
  }
  return bare(a) === bare(b)
}

/**
 * The path a transaction note should have for its current text and properties, rendered from
 * the transaction path template, or null when it already has it.
 */
export async function transactionFileTarget(app: App, file: TFile): Promise<string | null> {
  // The file, not an editor it is open in: an editor that has not loaded its text — a
  // background tab, a note in reading view on a phone — reads as empty, which renamed the
  // transaction to "New Transaction".
  const parsed = await parseNoteContent(file, await app.vault.read(file))
  const lines = parsed.content.split('\n').filter((line: string) => line.trim() !== '')

  // A text that names nothing leaves the name it has. "New Transaction" is what a new note is
  // called, not what an existing one becomes when its text is cleared or cannot be seen.
  if (lines.length === 0) return null
  const title = cleanTaskName(lines[0])
  if (!title) return null

  const config = AbeleConfig.getInstance()
  const data: Record<string, string> = {
    date: (parsed.date as string) || dayjs().format(DATE_FORMAT),
    title,
    from: stripWikilink(parsed.from as string),
    to: stripWikilink(parsed.to as string),
    amount: parsed.amount != null ? String(parsed.amount) : '',
    currency: (parsed.currency as string) || config.defaultCurrency || '',
  }

  let rendered = renderTemplate(config.transactionPathTemplate, data)
  if (!rendered.endsWith('.md')) rendered += '.md'
  // The name already is this, as the file system keeps it: some drop the dots at the end.
  if (samePath(rendered, file.path)) return null

  const newPath = await getAvailablePath(rendered, file.path)
  return newPath === file.path ? null : newPath
}
