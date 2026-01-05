import { App, Notice, TFile } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { Journal } from '@/entities/Journal'
import { renderTemplate } from '@/helpers/notesUtils'
import { normalizePath } from '@/helpers/pathsHelpers'
import { DATE_FORMAT } from '@/constants/dates'
import dayjs from 'dayjs'

export interface ProtocolParams {
  daily?: string
  journal?: string
  data: string
  path?: string
  mode?: 'append' | 'replace'
}

function parseProtocolParams(params: Record<string, string>): ProtocolParams {
  return {
    daily: params.daily,
    journal: params.journal,
    data: params.data,
    path: params.path,
    mode: (params.mode as 'append' | 'replace') || 'append',
  }
}

function findJournal(journalName: string): Journal | null {
  const config = AbeleConfig.getInstance()
  return config.journals.find((j) => j.name.toLowerCase() === journalName.toLowerCase()) || null
}

function validateParams(params: ProtocolParams): string | null {
  if (!params.data) {
    return 'Missing required parameter: data'
  }

  if (params.daily !== undefined) {
    if (!params.journal) {
      return 'Parameter "journal" is required when "daily" is specified'
    }

    const journal = findJournal(params.journal)
    if (!journal) {
      return `Journal "${params.journal}" not found`
    }

    if (journal.recurrence !== 'daily') {
      return `Journal "${params.journal}" is not a daily journal (recurrence: ${journal.recurrence})`
    }
  } else if (!params.path) {
    return 'Either "daily" or "path" parameter is required'
  }

  return null
}

async function getOrCreateDailyNote(app: App, journal: Journal): Promise<TFile | null> {
  const today = dayjs()

  if (!journal.newPathTemplate) {
    new Notice('Abele: Journal has no path template configured')
    return null
  }

  const notePath = normalizePath(
    renderTemplate(journal.newPathTemplate, { date: today.format(DATE_FORMAT) })
  )

  let file = app.vault.getAbstractFileByPath(notePath)

  if (file instanceof TFile) {
    return file
  }

  // Create the daily note using journal's method
  journal.createJournalNote(today)

  // Wait a bit for file creation and return it
  await new Promise((resolve) => setTimeout(resolve, 500))

  file = app.vault.getAbstractFileByPath(notePath)
  if (file instanceof TFile) {
    return file
  }

  new Notice('Abele: Failed to create daily note')
  return null
}

async function getFileByPath(app: App, path: string): Promise<TFile | null> {
  const normalizedPath = normalizePath(path)
  const file = app.vault.getAbstractFileByPath(normalizedPath)

  if (file instanceof TFile) {
    return file
  }

  new Notice(`Abele: File not found: ${normalizedPath}`)
  return null
}

async function modifyFileContent(
  app: App,
  file: TFile,
  data: string,
  mode: 'append' | 'replace'
): Promise<void> {
  if (mode === 'replace') {
    await app.vault.modify(file, data)
  } else {
    const currentContent = await app.vault.read(file)
    const newContent = currentContent + '\n' + data
    await app.vault.modify(file, newContent)
  }
}

export async function handleProtocolAction(
  app: App,
  params: Record<string, string>
): Promise<void> {
  const parsed = parseProtocolParams(params)

  const validationError = validateParams(parsed)
  if (validationError) {
    new Notice(`Abele: ${validationError}`)
    return
  }

  let file: TFile | null = null

  if (parsed.daily !== undefined) {
    const journal = findJournal(parsed.journal!)
    if (!journal) return // Already validated above

    file = await getOrCreateDailyNote(app, journal)
  } else if (parsed.path) {
    file = await getFileByPath(app, parsed.path)
  }

  if (!file) return

  await modifyFileContent(app, file, parsed.data, parsed.mode!)
}
