import { DATE_FORMAT } from '@/constants/dates'
import { extractDateFromFilename } from '@/helpers/datesHelper'
import { createNoteFromTemplate, renderTemplate } from '@/helpers/notesUtils'
import { normalizePath } from '@/helpers/pathsHelpers'
import { GlobalStore } from '@/stores/GlobalStore'
import dayjs from 'dayjs'
import { nanoid } from 'nanoid'
import { TFile } from 'obsidian'

const MAX_PERIODS_TO_CHECK = 100

export interface JournalDTO {
  id: string
  name: string
  type: string
  isDefault: boolean
  dateProperty?: string
  templatePath?: string
  newPathTemplate?: string
  recurrence: 'daily' | 'weekly' | 'monthly' | 'yearly'
  dayOfPeriod?: 'first' | 'last' | number
}

export class Journal {
  id: string
  name: string
  type: string // type property value or path RegExp to check if note is a journal
  isDefault: boolean
  dateProperty?: string // frontmatter property to set the date on, e.g. "date"
  templatePath?: string // path to the journal template note
  newPathTemplate?: string // template for the new journal note path, e.g. "Journal/{{DATE:YYYY-MM-DD}}"
  recurrence: 'daily' | 'weekly' | 'monthly' | 'yearly'
  private _dayOfPeriod?: 'first' | 'last' | number

  constructor(data: JournalDTO) {
    this.id = data.id ?? nanoid()
    this.name = data.name
    this.type = data.type
    this.isDefault = data.isDefault
    this.dateProperty = data.dateProperty
    this.templatePath = data.templatePath
    this.newPathTemplate = data.newPathTemplate
    this.recurrence = data.recurrence
    this.dayOfPeriod = data.dayOfPeriod
  }

  get dayOfPeriod(): 'first' | 'last' | number | undefined {
    return this._dayOfPeriod
  }

  set dayOfPeriod(value: string | number) {
    if (value === 'first' || value === 'last') {
      this._dayOfPeriod = value
    }

    if (typeof value === 'number' && !isNaN(value) && value >= 1 && value <= 366) {
      this._dayOfPeriod = value
    }
  }

  // returns a Dayjs if the note at the given path is a journal of this type, otherwise undefined
  checkIfNotePathIsJournal(path: string) {
    const { app } = GlobalStore.getInstance()

    const file = app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) return

    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter

    const type = frontmatter?.type

    if (this.type.startsWith('/')) {
      const regex = new RegExp(this.type.slice(1, -1))
      if (!regex.test(path)) return
    } else if (this.type !== type) {
      return
    }

    let parsedDate: dayjs.Dayjs
    if (!frontmatter?.dateProperty) {
      parsedDate = extractDateFromFilename(file.name)
    } else {
      const date = frontmatter[this.dateProperty]
      if (!date) return
      parsedDate = dayjs(date, DATE_FORMAT)
    }

    if (!parsedDate?.isValid()) return

    return parsedDate
  }

  get isDefaultDailyJournal() {
    return this.isDefault && this.recurrence === 'daily'
  }

  get dayjsReccurence() {
    switch (this.recurrence) {
      case 'daily':
        return 'day'
      case 'weekly':
        return 'week'
      case 'monthly':
        return 'month'
      case 'yearly':
        return 'year'
      default:
        return 'day'
    }
  }

  getNextDate(fromDate: dayjs.Dayjs) {
    const baseDate = fromDate.add(1, this.dayjsReccurence)

    if (this.recurrence === 'yearly' && this.dayOfPeriod) {
      if (this.dayOfPeriod === 'first') {
        return baseDate.month(0).date(1)
      } else if (this.dayOfPeriod === 'last') {
        return baseDate.month(11).endOf('month')
      } else if (typeof this.dayOfPeriod === 'number') {
        const startOfYear = baseDate.month(0).date(1)
        const targetDate = startOfYear.add(this.dayOfPeriod - 1, 'day')
        return targetDate
      }
    }

    if (this.recurrence === 'monthly' && this.dayOfPeriod) {
      if (this.dayOfPeriod === 'first') {
        return baseDate.date(1)
      } else if (this.dayOfPeriod === 'last') {
        return baseDate.endOf('month')
      } else if (typeof this.dayOfPeriod === 'number') {
        return baseDate.date(this.dayOfPeriod)
      }
    }

    if (this.recurrence === 'weekly' && this.dayOfPeriod) {
      if (typeof this.dayOfPeriod === 'number') {
        const dayOfWeek = (this.dayOfPeriod - 1) % 7 // 0 (Sunday) to 6 (Saturday)
        return baseDate.startOf('week').add(dayOfWeek, 'day')
      } else if (this.dayOfPeriod === 'first') {
        return baseDate.startOf('week')
      } else if (this.dayOfPeriod === 'last') {
        return baseDate.endOf('week')
      }
    }

    return baseDate
  }

  getPrevDate(fromDate: dayjs.Dayjs) {
    const baseDate = fromDate.subtract(1, this.dayjsReccurence)

    if (this.recurrence === 'yearly' && this.dayOfPeriod) {
      if (this.dayOfPeriod === 'first') {
        return baseDate.month(0).date(1)
      } else if (this.dayOfPeriod === 'last') {
        return baseDate.month(11).endOf('month')
      } else if (typeof this.dayOfPeriod === 'number') {
        const startOfYear = baseDate.month(0).date(1)
        const targetDate = startOfYear.add(this.dayOfPeriod - 1, 'day')
        return targetDate
      }
    }

    if (this.recurrence === 'monthly' && this.dayOfPeriod) {
      if (this.dayOfPeriod === 'first') {
        return baseDate.date(1)
      } else if (this.dayOfPeriod === 'last') {
        return baseDate.endOf('month')
      } else if (typeof this.dayOfPeriod === 'number') {
        return baseDate.date(this.dayOfPeriod)
      }
    }

    if (this.recurrence === 'weekly' && this.dayOfPeriod) {
      if (typeof this.dayOfPeriod === 'number') {
        const dayOfWeek = (this.dayOfPeriod - 1) % 7 // 0 (Sunday) to 6 (Saturday)
        return baseDate.startOf('week').add(dayOfWeek, 'day')
      } else if (this.dayOfPeriod === 'first') {
        return baseDate.startOf('week')
      } else if (this.dayOfPeriod === 'last') {
        return baseDate.endOf('week')
      }
    }

    return baseDate
  }

  isJournalNoteCreated(date: dayjs.Dayjs) {
    if (!this.newPathTemplate) return false

    const { app } = GlobalStore.getInstance()

    const path = normalizePath(
      renderTemplate(this.newPathTemplate, { date: date.format(DATE_FORMAT) })
    )

    const file = app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) return false

    return true
  }

  findClosestPrevNote(date: dayjs.Dayjs) {
    for (let i = 1; i <= MAX_PERIODS_TO_CHECK; i++) {
      date = this.getPrevDate(date)

      if (this.isJournalNoteCreated(date)) return date
    }

    return null
  }

  findClosestNextNote(date: dayjs.Dayjs) {
    for (let i = 1; i <= MAX_PERIODS_TO_CHECK; i++) {
      date = this.getNextDate(date)

      if (this.isJournalNoteCreated(date)) return date
    }

    return null
  }

  createJournalNote(date: dayjs.Dayjs) {
    const data = {
      date: date.format(DATE_FORMAT),
    }

    createNoteFromTemplate(data, this.newPathTemplate, this.templatePath)
  }

  isJournalDate(date: dayjs.Dayjs): boolean {
    if (this.recurrence === 'daily') {
      return true
    }

    if (!this.dayOfPeriod) {
      return false
    }

    switch (this.recurrence) {
      case 'weekly': {
        if (this.dayOfPeriod === 'first') {
          return date.isSame(date.startOf('week'), 'day')
        }
        if (this.dayOfPeriod === 'last') {
          return date.isSame(date.endOf('week'), 'day')
        }
        if (typeof this.dayOfPeriod === 'number') {
          const targetDayOfWeek = (this.dayOfPeriod - 1) % 7
          return date.day() === targetDayOfWeek
        }
        break
      }
      case 'monthly': {
        if (this.dayOfPeriod === 'first') {
          return date.date() === 1
        }
        if (this.dayOfPeriod === 'last') {
          return date.isSame(date.endOf('month'), 'day')
        }
        if (typeof this.dayOfPeriod === 'number') {
          return date.date() === this.dayOfPeriod
        }
        break
      }
      case 'yearly': {
        if (this.dayOfPeriod === 'first') {
          return date.dayOfYear() === 1
        }
        if (this.dayOfPeriod === 'last') {
          return date.isSame(date.endOf('year'), 'day')
        }
        if (typeof this.dayOfPeriod === 'number') {
          return date.dayOfYear() === this.dayOfPeriod
        }
        break
      }
    }

    return false
  }

  toDTO() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      isDefault: this.isDefault,
      dateProperty: this.dateProperty,
      templatePath: this.templatePath,
      newPathTemplate: this.newPathTemplate,
      recurrence: this.recurrence,
      dayOfPeriod: this.dayOfPeriod,
    }
  }
}
