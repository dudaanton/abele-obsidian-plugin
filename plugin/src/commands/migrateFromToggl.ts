import { requestUrl } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { TimeEntryNoteTemplate } from '@/templates/TimeEntryNoteTemplate'
import { getAvailablePath } from '@/helpers/vaultUtils'
import { cleanFileName, extractAliasOrNameFromWikilink } from '@/helpers/pathsHelpers'
import { DATETIME_FORMAT } from '@/entities/TimeEntry'
import { renderTemplate } from '@/helpers/notesUtils'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DATE_FORMAT } from '@/constants/dates'
import dayjs from 'dayjs'
import { TFile } from 'obsidian'

const TOGGL_API = 'https://api.track.toggl.com/api/v9'

interface TogglTimeEntry {
  id: number
  description: string | null
  start: string
  stop: string | null
  duration: number
  project_id: number | null
  workspace_id: number
  tags: string[]
}

interface TogglProject {
  id: number
  name: string
  workspace_id: number
}

export interface TogglMigrationResult {
  entriesCreated: number
  notesCreated: number
  skipped: number
  errors: string[]
}

export interface TogglMigrationProgress {
  stage: string
  percent: number
  result: TogglMigrationResult
}

function authHeader(apiToken: string): string {
  return 'Basic ' + btoa(`${apiToken}:api_token`)
}

async function fetchTogglTimeEntries(
  apiToken: string,
  startDate: dayjs.Dayjs,
  endDate: dayjs.Dayjs
): Promise<TogglTimeEntry[]> {
  const response = await requestUrl({
    url: `${TOGGL_API}/me/time_entries?start_date=${startDate.format('YYYY-MM-DD')}&end_date=${endDate.add(1, 'day').format('YYYY-MM-DD')}`,
    headers: {
      Authorization: authHeader(apiToken),
      'Content-Type': 'application/json',
    },
  })

  return response.json as TogglTimeEntry[]
}

async function fetchTogglProjects(apiToken: string): Promise<Map<number, string>> {
  const response = await requestUrl({
    url: `${TOGGL_API}/me/projects`,
    headers: {
      Authorization: authHeader(apiToken),
      'Content-Type': 'application/json',
    },
  })

  const projects = response.json as TogglProject[]
  const map = new Map<number, string>()
  for (const p of projects) {
    map.set(p.id, p.name)
  }
  return map
}

async function ensureNote(folder: string, name: string): Promise<void> {
  const { app } = GlobalStore.getInstance()
  const safeName = cleanFileName(name) || 'Untitled'
  const path = `${folder}/${safeName}.md`

  if (app.vault.getAbstractFileByPath(path)) return

  // Ensure folder exists
  const parts = path.split('/')
  parts.pop()
  let current = ''
  for (const part of parts) {
    current = current ? `${current}/${part}` : part
    if (!app.vault.getAbstractFileByPath(current)) {
      await app.vault.createFolder(current)
    }
  }

  await app.vault.create(path, '')
}

export async function migrateFromToggl(
  apiToken: string,
  startDate: dayjs.Dayjs,
  endDate: dayjs.Dayjs,
  onProgress?: (progress: TogglMigrationProgress) => void
): Promise<TogglMigrationResult> {
  const result: TogglMigrationResult = {
    entriesCreated: 0,
    notesCreated: 0,
    skipped: 0,
    errors: [],
  }

  const report = (stage: string, percent: number) => {
    onProgress?.({ stage, percent, result: { ...result } })
  }

  report('Fetching projects...', 5)
  let projectMap: Map<number, string>
  try {
    projectMap = await fetchTogglProjects(apiToken)
  } catch (e) {
    result.errors.push(`Failed to fetch projects: ${e}`)
    projectMap = new Map()
  }

  report('Fetching time entries...', 15)
  let entries: TogglTimeEntry[]
  try {
    entries = await fetchTogglTimeEntries(apiToken, startDate, endDate)
  } catch (e) {
    result.errors.push(`Failed to fetch time entries: ${e}`)
    return result
  }

  report(`Found ${entries.length} entries`, 20)

  const { app } = GlobalStore.getInstance()
  const config = AbeleConfig.getInstance()
  const createdNotes = new Set<string>()
  const total = entries.length

  for (let i = 0; i < total; i++) {
    const entry = entries[i]
    const percent = 20 + Math.round(((i + 1) / total) * 75)

    try {
      if (!entry.stop) {
        result.skipped++
        continue
      }

      const groups: string[] = []
      const description = entry.description?.trim()
      const projectName = entry.project_id ? projectMap.get(entry.project_id) : null

      if (description) {
        const safeName = cleanFileName(description)
        const noteKey = `Toggl/${safeName}`
        groups.push(`[[${noteKey}|${safeName}]]`)
        if (!createdNotes.has(noteKey)) {
          await ensureNote('Toggl', description)
          createdNotes.add(noteKey)
          result.notesCreated++
        }
      }

      if (projectName) {
        const safeName = cleanFileName(projectName)
        const noteKey = `Toggl/${safeName}`
        groups.push(`[[${noteKey}|${safeName}]]`)
        if (!createdNotes.has(noteKey)) {
          await ensureNote('Toggl', projectName)
          createdNotes.add(noteKey)
          result.notesCreated++
        }
      }

      const start = dayjs(entry.start)
      const end = dayjs(entry.stop)

      const groupsLabel =
        groups.length > 0
          ? groups.map((g) => extractAliasOrNameFromWikilink(g)).join(', ')
          : 'Timer'

      const pathData: Record<string, string> = {
        date: start.format(DATE_FORMAT),
        groups: groupsLabel,
        start: start.format('HH-mm'),
        end: end.format('HH-mm'),
      }

      let rendered = renderTemplate(config.timeEntryPathTemplate, pathData)
      if (!rendered.endsWith('.md')) rendered += '.md'

      const availablePath = await getAvailablePath(rendered)
      if (!availablePath) {
        result.errors.push(`Could not determine path for entry ${entry.id}`)
        result.skipped++
        continue
      }

      const pathNoExt = availablePath.endsWith('.md') ? availablePath.slice(0, -3) : availablePath
      const parts = pathNoExt.split('/')
      const entryName = parts.pop() || 'Timer'
      const entryFolder = parts.join('/')

      const template = new TimeEntryNoteTemplate(app)
      await template.createNoteWithTemplate({ start, end, groups, entryName, entryFolder }, false)

      result.entriesCreated++
      report(`Importing ${i + 1}/${total}...`, percent)
    } catch (e) {
      result.errors.push(`Entry ${entry.id}: ${e}`)
    }
  }

  report('Done', 100)
  return result
}
