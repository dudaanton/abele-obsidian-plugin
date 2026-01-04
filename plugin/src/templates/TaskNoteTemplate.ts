import { App } from 'obsidian'
import { GenericTemplate } from './GenericTemplate'
import { DATE_FORMAT } from '@/constants/dates'
import dayjs, { Dayjs } from 'dayjs'
import { AbeleConfig } from '@/services/AbeleConfig'
import { dump } from 'js-yaml'

/**
 * Interface for task note template parameters
 */
export interface TaskNoteContentParams {
  createdAt?: dayjs.Dayjs | null
  completedAt?: dayjs.Dayjs | null
  due?: dayjs.Dayjs | null
  dueTime?: dayjs.Dayjs | null
  date?: dayjs.Dayjs | null
  dateTime?: dayjs.Dayjs | null
  recurrence?: string | null
  content?: string
  oldProps?: Record<string, any>
}
/**
 * Interface for task note template parameters
 */
export interface TaskNoteParams extends TaskNoteContentParams {
  taskName: string // filename of the task note
  taskFolder: string // folder where the task note is stored
}

/**
 * Template for task note
 */
export class TaskNoteTemplate extends GenericTemplate<TaskNoteParams> {
  /**
   * Constructor for the today note template
   * @param app The Obsidian app instance
   */
  constructor(app: App) {
    super(app)
  }

  protected getPath(params: TaskNoteParams): string {
    return params.taskFolder || AbeleConfig.getInstance().tasksFolder
  }

  /**
   * Determines the filename for the task note
   * @param params Parameters for the today note
   * @returns The filename for the file note (without extension)
   */
  protected getFilename(params: TaskNoteParams): string {
    return params.taskName
  }

  /**
   * Creates the content for a today note template
   * @param params Parameters for the today note
   * @returns The content of the today note template
   */
  createTemplate(params: TaskNoteContentParams): string {
    const frontmatterData: Record<string, any> = { ...params.oldProps, type: 'task' }

    type PropKey = keyof Omit<TaskNoteContentParams, 'oldProps' | 'content'>

    const propMap: Record<PropKey, { fmKey: string; format?: (val: any) => any }> = {
      completedAt: { fmKey: 'completed', format: (v: Dayjs) => v.format(DATE_FORMAT) },
      date: { fmKey: 'date', format: (v: Dayjs) => v.format(DATE_FORMAT) },
      dateTime: { fmKey: 'dateTime', format: (v: Dayjs) => v.format('HH:mm') },
      due: { fmKey: 'due', format: (v: Dayjs) => v.format(DATE_FORMAT) },
      dueTime: { fmKey: 'dueTime', format: (v: Dayjs) => v.format('HH:mm') },
      recurrence: { fmKey: 'recurrence' },
      createdAt: { fmKey: 'created', format: (v: Dayjs) => v.format(DATE_FORMAT) },
    }

    for (const paramKey of Object.keys(propMap)) {
      const value = params[paramKey as PropKey]
      const { fmKey, format } = propMap[paramKey as PropKey]

      if (value !== null && value !== undefined) {
        frontmatterData[fmKey] = format ? format(value) : value
      } else if (paramKey in params) {
        // Explicitly set to null - remove from frontmatter
        delete frontmatterData[fmKey]
      }
    }

    if (Object.keys(frontmatterData).length === 0) {
      return params.content ?? ''
    }

    const frontmatter = dump(frontmatterData, { quotingType: "'" })

    return `---
${frontmatter}---
${params.content ?? ''}`
  }
}
