import { applyTimeToDate, parseDateOrNull, parseDateTimeOrNull } from '@/helpers/datesHelper'
import { FileWatcher } from '@/helpers/FileWatcher'
import { parseNoteContent } from '@/helpers/notesUtils'
import { normalizePath, pathToWikilink } from '@/helpers/pathsHelpers'
import { getEditorForFile, getFileByPath } from '@/helpers/vaultUtils'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { TaskNoteTemplate } from '@/templates/TaskNoteTemplate'
import dayjs from 'dayjs'
import { debounce } from 'obsidian'
import { Task } from './Task'

export class TaskHeader {
  public readonly id: string
  public filePath: string // path of the task file

  public createdAt: dayjs.Dayjs | null = null
  public completedAt: dayjs.Dayjs | null = null
  public date: dayjs.Dayjs | null = null
  public dateTime: dayjs.Dayjs | null = null
  public due: dayjs.Dayjs | null = null
  public dueTime: dayjs.Dayjs | null = null
  public recurrence: string | null = null

  public oldProps: Record<string, any> = {}

  public loaded = false
  public taskNotFound = false
  public watcherInitialized = false
  private fileWatcher: FileWatcher = null

  // to avoid debounced calls after cleanup
  private cleanedUp = false

  constructor(data: { id: string; filePath: string }) {
    this.id = data.id
    this.filePath = normalizePath(data.filePath)
  }

  async load(force = false) {
    if (this.cleanedUp || (this.loaded && !force)) {
      return
    }

    const file = getFileByPath(this.filePath)
    const editor = file ? getEditorForFile(file) : null
    const task = editor ? await parseNoteContent(file, editor.getValue()) : null

    if (task) {
      this.createdAt = parseDateOrNull(task.created)
      this.completedAt = parseDateOrNull(task.completed)
      this.recurrence = task.recurrence || null
      this.date = parseDateOrNull(task.date)
      this.dateTime = parseDateTimeOrNull(task.date, task.dateTime)
      this.date = applyTimeToDate(this.date, this.dateTime)
      this.due = parseDateOrNull(task.due)
      this.dueTime = parseDateTimeOrNull(task.due, task.dueTime)
      this.due = applyTimeToDate(this.due, this.dueTime)

      this.oldProps = { ...task, content: undefined }
    } else {
      this.taskNotFound = true
    }

    this.loaded = true
    this.initWatcher()
  }

  async toggle() {
    if (this.completedAt) {
      this.completedAt = null
    } else {
      this.completedAt = dayjs()

      const task = new Task({ wikilink: pathToWikilink(this.filePath) })

      await task.load()
      await task.loadContent()
      await task.createNewRecurrentTask()
      task.cleanup()
    }

    return this.writeContentToEditor()
  }

  async addEventDate(relativeDate?: string) {
    if (!this.date) {
      this.date = dayjs()

      if (relativeDate) {
        relativeDate = relativeDate.toLowerCase()
        if (relativeDate === 'tomorrow') {
          this.date = this.date.add(1, 'day')
        } else if (relativeDate === 'next week') {
          this.date = this.date.add(1, 'week')
        } else if (relativeDate === 'next month') {
          this.date = this.date.add(1, 'month')
        }
      }
    }
    return this.writeContentToEditor()
  }

  async removeEventDate() {
    this.date = null
    this.dateTime = null
    return this.writeContentToEditor()
  }

  async addDueDate(relativeDate?: string) {
    if (!this.due) {
      this.due = dayjs()

      if (relativeDate) {
        relativeDate = relativeDate.toLowerCase()
        if (relativeDate === 'tomorrow') {
          this.due = this.due.add(1, 'day')
        } else if (relativeDate === 'next week') {
          this.due = this.due.add(1, 'week')
        } else if (relativeDate === 'next month') {
          this.due = this.due.add(1, 'month')
        }
      }
    }
    return this.writeContentToEditor()
  }

  async removeDueDate() {
    this.due = null
    this.dueTime = null
    return this.writeContentToEditor()
  }

  async removeRecurrence() {
    this.recurrence = null
    return this.writeContentToEditor()
  }

  async addEventTime(time?: string) {
    if (!this.date) {
      this.date = dayjs()
    }
    if (time) {
      const [hours, minutes] = time.split(':').map((t) => parseInt(t, 10))
      this.dateTime = this.date.hour(hours).minute(minutes)
      this.date = this.date.hour(hours).minute(minutes)
    } else if (!this.dateTime) {
      this.dateTime = this.date.hour(12).minute(0)
      this.date = this.date.hour(12).minute(0)
    }
    return this.writeContentToEditor()
  }

  async addDueTime(time?: string) {
    if (!this.due) {
      this.due = dayjs()
    }
    if (time) {
      const [hours, minutes] = time.split(':').map((t) => parseInt(t, 10))
      this.dueTime = this.due.hour(hours).minute(minutes)
      this.due = this.due.hour(hours).minute(minutes)
    } else if (!this.dueTime) {
      this.dueTime = this.due.hour(12).minute(0)
      this.due = this.due.hour(12).minute(0)
    }
    return this.writeContentToEditor()
  }

  async addRecurrence(recurrence: string) {
    this.recurrence = recurrence
    return this.writeContentToEditor()
  }

  async removeEventTime() {
    this.dateTime = null
    return this.writeContentToEditor()
  }

  async writeContentToEditor() {
    const { app } = GlobalStore.getInstance()

    const editor = getEditorForFile(getFileByPath(this.filePath))
    if (!editor) return

    const file = getFileByPath(this.filePath)
    const currentContent = await parseNoteContent(file, editor.getValue())

    console.log(this.createdAt)

    const newContent = new TaskNoteTemplate(app).createTemplate({
      ...this,
      content: currentContent.content,
    })

    editor.setValue(newContent)
  }

  initWatcher() {
    if (this.watcherInitialized) {
      return
    }
    this.fileWatcher = new FileWatcher(
      GlobalStore.getInstance().app,
      this.filePath,
      debounce(
        (event) => {
          if (event.oldPath && event.newPath && event.oldPath !== event.newPath) {
            // file renamed
            this.filePath = event.newPath
          }

          this.load(true)
        },
        AbeleConfig.getInstance().refreshDelay,
        true
      )
    )

    this.watcherInitialized = true
  }

  cleanTaskData() {
    this.createdAt = null
    this.completedAt = null
    this.date = null
    this.dateTime = null
    this.due = null
    this.dueTime = null
    this.recurrence = null
    this.loaded = false
    this.taskNotFound = false
    this.oldProps = {}
  }

  cleanup() {
    this.cleanedUp = true

    this.fileWatcher.cleanup()
    this.fileWatcher = null
    this.watcherInitialized = false
    this.cleanTaskData()
  }
}
