import { TimeEntry, TimeEntryCreateDTO, DATETIME_FORMAT } from '@/entities/TimeEntry'
import { TimeEntryNoteTemplate } from '@/templates/TimeEntryNoteTemplate'
import { extractAliasOrNameFromWikilink } from '@/helpers/pathsHelpers'
import { renderTemplate } from '@/helpers/notesUtils'
import dayjs from 'dayjs'
import { getAvailablePath } from '@/helpers/vaultUtils'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { DATE_FORMAT } from '@/constants/dates'
import { TimeEntryList } from '@/entities/TimeEntryList'
import { Notice, TFile } from 'obsidian'
import { toRaw } from 'vue'

function getTimeLabel(dt: dayjs.Dayjs | null | undefined): string {
  if (!dt) return ''
  return dt.format('HH-mm')
}

function getGroupsLabel(groups?: string[]): string {
  if (!groups?.length) return 'Timer'
  return groups.map((g) => extractAliasOrNameFromWikilink(g)).join(', ')
}

function getNewTimeEntryPath(params?: {
  start?: dayjs.Dayjs
  end?: dayjs.Dayjs | null
  groups?: string[]
}): string {
  const config = AbeleConfig.getInstance()
  const template = config.timeEntryPathTemplate

  const data: Record<string, string> = {
    date: (params?.start || dayjs()).format(DATE_FORMAT),
    groups: getGroupsLabel(params?.groups),
    start: getTimeLabel(params?.start || dayjs()),
    end: getTimeLabel(params?.end),
  }

  let rendered = renderTemplate(template, data)
  if (!rendered.endsWith('.md')) {
    rendered += '.md'
  }

  return rendered
}

export const stopActiveTimeEntry = async (): Promise<boolean> => {
  const store = GlobalStore.getInstance()
  const rawList = toRaw(store.timeEntryList.value) as unknown as TimeEntryList | null
  if (!rawList) return false

  const actives = rawList.activeEntries.value as TimeEntry[]
  if (!actives.length) return false

  const now = dayjs()
  for (const active of actives) {
    const file = store.app.vault.getAbstractFileByPath(active.entryPath)
    if (file instanceof TFile) {
      await store.app.fileManager.processFrontMatter(file, (frontmatter) => {
        frontmatter.end = now.format(DATETIME_FORMAT)
      })
    }
  }

  return true
}

export const createTimeEntry = async (data?: TimeEntryCreateDTO, focus = true): Promise<void> => {
  // Stop any active timer first
  await stopActiveTimeEntry()

  const now = dayjs()
  const start = data?.start || now
  const groups = data?.groups || []

  const availablePath = await getAvailablePath(getNewTimeEntryPath({ start, groups }))
  if (!availablePath) {
    new Notice('Failed to determine available path for the new time entry.', 3000)
    return
  }

  const pathNoExt = availablePath.endsWith('.md') ? availablePath.slice(0, -3) : availablePath
  const parts = pathNoExt.split('/')
  const entryName = parts.pop() || 'Timer'
  const entryFolder = parts.join('/')

  const { app } = GlobalStore.getInstance()
  const template = new TimeEntryNoteTemplate(app)

  await template.createNoteWithTemplate({ start, end: null, groups, entryName, entryFolder }, focus)
}
