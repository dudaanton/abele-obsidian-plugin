import { App } from 'obsidian'
import { GenericTemplate } from './GenericTemplate'
import { AbeleConfig } from '@/services/AbeleConfig'
import { renderTemplate } from '@/helpers/notesUtils'
import { DATETIME_FORMAT } from '@/entities/TimeEntry'
import { DATE_FORMAT } from '@/constants/dates'
import dayjs from 'dayjs'
import { dump } from 'js-yaml'
import { extractAliasOrNameFromWikilink } from '@/helpers/pathsHelpers'

export interface TimeEntryNoteParams {
  start?: dayjs.Dayjs | null
  end?: dayjs.Dayjs | null
  groups?: string[]
}

export class TimeEntryNoteTemplate extends GenericTemplate<TimeEntryNoteParams> {
  constructor(app: App) {
    super(app)
  }

  private getGroupsLabel(params: TimeEntryNoteParams): string {
    if (!params.groups?.length) return 'Timer'
    return params.groups.map((g) => extractAliasOrNameFromWikilink(g)).join(', ')
  }

  private getTimeLabel(dt: dayjs.Dayjs | null | undefined): string {
    if (!dt) return ''
    return dt.format('HH-mm')
  }

  protected getPath(params: TimeEntryNoteParams): string {
    const config = AbeleConfig.getInstance()
    const template = config.timeEntryPathTemplate

    const data: Record<string, string> = {
      date: (params.start || dayjs()).format(DATE_FORMAT),
      groups: this.getGroupsLabel(params),
      start: this.getTimeLabel(params.start),
      end: this.getTimeLabel(params.end),
    }

    const rendered = renderTemplate(template, data)
    const parts = rendered.split('/')
    parts.pop()
    return parts.join('/')
  }

  protected getFilename(params: TimeEntryNoteParams): string {
    const config = AbeleConfig.getInstance()
    const template = config.timeEntryPathTemplate

    const data: Record<string, string> = {
      date: (params.start || dayjs()).format(DATE_FORMAT),
      groups: this.getGroupsLabel(params),
      start: this.getTimeLabel(params.start),
      end: this.getTimeLabel(params.end),
    }

    const rendered = renderTemplate(template, data)
    const parts = rendered.split('/')
    return parts.pop() || 'Timer'
  }

  createTemplate(params: TimeEntryNoteParams): string {
    const frontmatterData: Record<string, any> = {
      type: 'time-entry',
    }

    if (params.start) {
      frontmatterData.start = params.start.format(DATETIME_FORMAT)
    } else {
      frontmatterData.start = dayjs().format(DATETIME_FORMAT)
    }

    frontmatterData.end = params.end ? params.end.format(DATETIME_FORMAT) : null

    if (params.groups?.length) {
      frontmatterData.groups = params.groups
    }

    const frontmatter = dump(frontmatterData, { quotingType: "'" })

    return `---\n${frontmatter}---\n`
  }
}
