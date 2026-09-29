/**
 * The daily note of a day, opened — and made first when there is none, the way the calendar in
 * the timeline sidebar does it: through the plugin's default daily journal (its path and its
 * template). Without one, Obsidian's own Daily notes, when that core plugin is on, with its
 * folder, date format and template.
 */
import dayjs from 'dayjs'
import { Notice, TFile, type App } from 'obsidian'
import { DATE_FORMAT } from '@/constants/dates'
import { createNoteFromTemplate, renderTemplate } from '@/helpers/notesUtils'
import { normalizePath } from '@/helpers/pathsHelpers'
import { AbeleConfig } from '@/services/AbeleConfig'

interface DailyNotesOptions {
  folder?: string
  format?: string
  template?: string
}

const withMd = (path: string) => (path.endsWith('.md') ? path : `${path}.md`)

function coreDailyNotes(app: App): DailyNotesOptions | null {
  const plugin = (
    app as unknown as {
      internalPlugins?: {
        getPluginById?: (
          id: string
        ) => { enabled?: boolean; instance?: { options?: DailyNotesOptions } } | null
      }
    }
  ).internalPlugins?.getPluginById?.('daily-notes')
  return plugin?.enabled ? (plugin.instance?.options ?? {}) : null
}

const open = (app: App, path: string, newLeaf: boolean | string) =>
  app.workspace.openLinkText(path, '', newLeaf as boolean)

/** Opens the daily note of `day` (`YYYY-MM-DD`), making it when it is not there yet. */
export async function openDailyNote(app: App, day: string, newLeaf: boolean | string = false) {
  const journal = AbeleConfig.getInstance().journals.find((j) => j.isDefaultDailyJournal)
  if (journal?.newPathTemplate) {
    const path = withMd(normalizePath(renderTemplate(journal.newPathTemplate, { date: day })))
    if (app.vault.getAbstractFileByPath(path) instanceof TFile) return open(app, path, newLeaf)
    await createNoteFromTemplate({ date: day }, journal.newPathTemplate, journal.templatePath)
    return
  }

  const core = coreDailyNotes(app)
  if (!core) {
    new Notice('No daily journal found. Please check your settings.')
    return
  }
  const date = dayjs(day, DATE_FORMAT)
  const name = date.format(core.format?.trim() || DATE_FORMAT)
  const folder = core.folder?.trim().replace(/\/+$/, '') ?? ''
  const path = withMd(normalizePath(folder ? `${folder}/${name}` : name))
  if (app.vault.getAbstractFileByPath(path) instanceof TFile) return open(app, path, newLeaf)

  let content = ''
  const templatePath = core.template?.trim()
  const template = templatePath && app.vault.getAbstractFileByPath(withMd(templatePath))
  if (template instanceof TFile) {
    const title = name.split('/').pop() ?? name
    content = (await app.vault.read(template))
      .replace(/{{\s*title\s*}}/gi, title)
      .replace(/{{\s*date\s*(?::([^}]*))?}}/gi, (_m, format?: string) =>
        date.format(format?.trim() || core.format?.trim() || DATE_FORMAT)
      )
  }
  const parent = path.split('/').slice(0, -1).join('/')
  if (parent && !app.vault.getAbstractFileByPath(parent)) await app.vault.createFolder(parent)
  await app.vault.create(path, content)
  return open(app, path, newLeaf)
}
