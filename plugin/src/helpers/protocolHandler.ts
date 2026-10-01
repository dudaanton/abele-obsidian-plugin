import { App, Notice, TFile } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { renderTemplate } from '@/helpers/notesUtils'
import { DATE_FORMAT } from '@/constants/dates'
import { confirmProtocolWrite } from './protocolConfirm'
import { protocolNotePath, type ProtocolWrite } from './protocolWrite'
import dayjs from 'dayjs'

export type { ProtocolWrite } from './protocolWrite'

/** A URL can be opened by any page. Never write until the exact note and text are accepted. */
export async function handleProtocolAction(
  app: App,
  params: Record<string, string>,
  confirm: (write: ProtocolWrite) => Promise<boolean> = confirmProtocolWrite
): Promise<void> {
  const notice = (message: string) => {
    new Notice(`Abele: ${message}`)
  }
  if (!params.data) return notice('Missing required parameter: data')
  const config = AbeleConfig.getInstance()
  const protectedFolders = () => [app.vault.configDir, config.ai?.scriptsFolder ?? '']
  const date = dayjs().format(DATE_FORMAT)
  const journal =
    params.daily !== undefined
      ? config.journals.find((j) => j.name.toLowerCase() === (params.journal ?? '').toLowerCase())
      : undefined
  if (params.daily !== undefined && (!journal || journal.recurrence !== 'daily'))
    return notice('A daily journal is required')
  const rawPath = journal
    ? renderTemplate(journal.newPathTemplate || '', { date })
    : params.path || ''
  const path = protocolNotePath(rawPath, protectedFolders())
  if (!path)
    return notice(
      'Links can write only ordinary notes, outside scripts, hidden and settings folders'
    )
  const existing = app.vault.getAbstractFileByPath(path)
  if (existing && !(existing instanceof TFile)) return notice(`Not a note: ${path}`)
  if (!existing && !journal) return notice(`File not found: ${path}`)
  const current = existing instanceof TFile ? await app.vault.read(existing) : null
  let base = current ?? ''
  if (current === null && journal?.templatePath) {
    const template = app.vault.getAbstractFileByPath(journal.templatePath)
    if (template instanceof TFile) base = renderTemplate(await app.vault.read(template), { date })
  }
  const mode = params.mode === 'replace' ? 'replace' : 'append'
  const content = mode === 'replace' ? params.data : `${base}\n${params.data}`
  if (!(await confirm({ path, mode, current, content, creates: current === null }))) return
  // Settings, the file identity or its contents may have changed while the dialog was open.
  if (
    !protocolNotePath(path, protectedFolders()) ||
    app.vault.getAbstractFileByPath(path) !== existing
  )
    return notice('The target changed; open the link again to review it')
  if (existing instanceof TFile) {
    let changed = false
    await app.vault.process(existing, (now) => {
      if (existing.path !== path || now !== current) {
        changed = true
        return now
      }
      return content
    })
    if (changed) notice('The note changed; open the link again to review it')
  } else {
    const parent = path.split('/').slice(0, -1).join('/')
    if (parent && !app.vault.getAbstractFileByPath(parent)) await app.vault.createFolder(parent)
    await app.vault.create(path, content)
  }
}
