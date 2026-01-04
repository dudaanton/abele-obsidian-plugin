import { createTask } from '@/commands/createTask'
import { DATE_FORMAT } from '@/constants/dates'
import { applyTimeToDate, parseDateOrNull, parseDateTimeOrNull } from '@/helpers/datesHelper'
import { FileWatcher } from '@/helpers/FileWatcher'
import { getFrontmatterFromCache, getNoteData } from '@/helpers/notesUtils'
import {
  extractAliasOrNameFromWikilink,
  getNameFromPath,
  normalizePath,
  wikilinkToPath,
} from '@/helpers/pathsHelpers'
import { RecurrenceParser } from '@/helpers/RecurrenceParser'
import { cleanTaskName, createTaskLinkRegex, getRecurrentTaskTitle } from '@/helpers/tasksUtils'
import {
  getBacklinksByPath,
  getEditorForFile,
  getFileByPath,
  getFileByPathOrName,
} from '@/helpers/vaultUtils'
import { genid } from '@/helpers/vueUtils'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { TaskNoteTemplate } from '@/templates/TaskNoteTemplate'
import dayjs from 'dayjs'
import { debounce } from 'obsidian'

export interface TaskCreateDTO {
  title?: string
  description?: string
  createdAt?: dayjs.Dayjs
  completedAt?: dayjs.Dayjs
  date?: dayjs.Dayjs
  dateTime?: dayjs.Dayjs
  due?: dayjs.Dayjs
  dueTime?: dayjs.Dayjs
  recurrence?: string
  content?: string
  oldProps?: Record<string, any>
}

export class Task {
  public readonly id: string
  private _taskPath: string // path of the task file
  private _taskName: string // name of the task file, without extension
  public readonly filePath?: string // path of the file, where the task link is located

  public title = ''
  public description = ''
  public createdAt: dayjs.Dayjs | null = null
  public completedAt: dayjs.Dayjs | null = null
  public date: dayjs.Dayjs | null = null
  public dateTime: dayjs.Dayjs | null = null
  public due: dayjs.Dayjs | null = null
  public dueTime: dayjs.Dayjs | null = null
  public recurrence: string | null = null
  public content: string

  public oldProps: Record<string, any> = {}

  public loaded = false
  public taskNotFound = false
  public watcherInitialized = false
  private fileWatcher: FileWatcher = null

  // to avoid debounced calls after cleanup
  private cleanedUp = false

  constructor(data: TaskCreateDTO & { id?: string; wikilink: string; filePath?: string }) {
    this.id = data.id || genid()
    this._taskPath = wikilinkToPath(data.wikilink)
    this._taskName = extractAliasOrNameFromWikilink(data.wikilink)
    this.filePath = data.filePath ? normalizePath(data.filePath) : undefined

    this.title = data.title || ''
    this.description = data.description || ''
    this.createdAt = data.createdAt || null
    this.completedAt = data.completedAt || null
    this.date = data.date || null
    this.dateTime = data.dateTime || null
    this.due = data.due || null
    this.dueTime = data.dueTime || null
    this.recurrence = data.recurrence || null
    this.content = data.content || ''
    this.oldProps = data.oldProps || {}
  }

  getTaskDate(): dayjs.Dayjs {
    if (this.date && this.due) {
      return this.date.isBefore(this.due) ? this.date : this.due
    } else if (this.date) {
      return this.date
    } else if (this.due) {
      return this.due
    } else if (this.createdAt) {
      return this.createdAt
    }
  }

  // is used to sort tasks by date
  getTaskDateOrToday(): dayjs.Dayjs {
    return this.getTaskDate() ?? dayjs()
  }

  async loadContent() {
    const task = await getNoteData(this.taskPath)

    if (task) {
      const lines = task.content.split('\n').filter((line: string) => line.trim() !== '')
      this.title = lines.length > 0 ? lines[0] : 'New Task'
      this.description = lines.slice(1).join('\n')
      this.content = task.content
    } else {
      this.taskNotFound = true
    }
  }

  async load(force = false) {
    if (this.cleanedUp || (this.loaded && !force)) {
      return
    }
    this.loaded = true

    const frontmatter = getFrontmatterFromCache(this.taskPath)

    if (frontmatter) {
      this.createdAt = parseDateOrNull(frontmatter.created)
      this.completedAt = parseDateOrNull(frontmatter.completed)
      this.recurrence = frontmatter.recurrence || null
      this.date = parseDateOrNull(frontmatter.date)
      this.dateTime = parseDateTimeOrNull(frontmatter.date, frontmatter.dateTime)
      this.date = applyTimeToDate(this.date, this.dateTime)
      this.due = parseDateOrNull(frontmatter.due)
      this.dueTime = parseDateTimeOrNull(frontmatter.due, frontmatter.dueTime)
      this.due = applyTimeToDate(this.due, this.dueTime)

      this.oldProps = { ...frontmatter, content: undefined }
    } else {
      this.taskNotFound = true
    }

    this.initWatcher()
  }

  /** Path to the task file with extension */
  get taskPath(): string {
    // Obsidian will automatically rewrite wikilinks with shortest path by default
    if (this._taskPath) return getFileByPathOrName(this._taskPath)?.path || this._taskPath

    const { tasksFolder } = AbeleConfig.getInstance()

    return normalizePath(tasksFolder ? `${tasksFolder}/${this._taskName}` : this._taskName)
  }

  get taskFolder(): string {
    const parts = this.taskPath.split('/')
    parts.pop()
    return parts.join('/')
  }

  /** Name of the task file without extension */
  get taskName(): string {
    return this._taskName
  }

  createNewRecurrentTask() {
    const recurrenceParser = new RecurrenceParser()
    if (this.recurrence && recurrenceParser.parse(this.recurrence)) {
      let newTaskDue: dayjs.Dayjs | null = null
      let newTaskDate: dayjs.Dayjs | null = null

      if (this.due) {
        newTaskDue = recurrenceParser.getNextDate(this.due, this.recurrence, this.completedAt)
      }

      if (this.date) {
        newTaskDate = recurrenceParser.getNextDate(this.date, this.recurrence, this.completedAt)
      }

      const newTaskTitle = getRecurrentTaskTitle(this.content, newTaskDue || newTaskDate)

      return createTask(
        {
          ...this.toCreateDTO(),
          title: newTaskTitle,
          completedAt: null,
          due: newTaskDue,
          date: newTaskDate,
        },
        false
      )
    }
  }

  async toggle() {
    if (this.completedAt) {
      this.completedAt = null
    } else {
      this.completedAt = dayjs()
      if (!this.content) {
        await this.loadContent()
      }
      this.createNewRecurrentTask()
    }

    return this.writeTaskToFile()
  }

  async writeTaskToFile(focus = false, overwrite = true) {
    const { app } = GlobalStore.getInstance()
    new TaskNoteTemplate(app).createNoteWithTemplate(this, focus, overwrite)
  }

  removeOrphanedLink() {
    if (!this.filePath) return

    const file = getFileByPath(this.filePath)
    if (!file) return

    const editor = getEditorForFile(file)
    if (!editor) return

    const content = editor.getValue()

    const regExp = createTaskLinkRegex(this.taskPath, this.taskName)

    const newContent = content.replace(regExp, '').replace(/\n{3,}/g, '\n\n')
    if (newContent !== content) {
      editor.setValue(newContent)
    }
  }

  async removeTaskEmbedds() {
    const { app } = GlobalStore.getInstance()

    // Find all files that point to this task
    const backlinks = getBacklinksByPath(this.taskPath)

    // there are four supported formats:
    // 1. full path wikilink with alias: [[path/to/task|alias]]
    // 2. full path wikilink without alias: [[path/to/task]]
    // 3. file name wikilink with alias: [[task|alias]]
    // 4. file name wikilink without alias: [[task]]
    const regExp = createTaskLinkRegex(this.taskPath, this.taskName)

    for (const backlink of backlinks) {
      const file = getFileByPath(backlink)
      if (file) {
        const editor = getEditorForFile(file)
        if (editor) {
          const content = editor.getValue()
          const newContent = content.replace(regExp, '').replace(/\n{3,}/g, '\n\n')
          if (newContent !== content) {
            editor.setValue(newContent)
          }
        } else {
          const content = await app.vault.read(file)
          const newContent = content.replace(regExp, '').replace(/\n{3,}/g, '\n\n')
          if (newContent !== content) {
            await app.vault.modify(file, newContent)
          }
        }
      }
    }
  }
  async remove() {
    const { app } = GlobalStore.getInstance()

    await this.removeTaskEmbedds()

    const file = getFileByPath(this.taskPath)
    if (file) {
      await app.vault.delete(file)
    }

    this.cleanup()
  }

  get dates() {
    const dates = []
    if (this.date) {
      dates.push(this.date.format(DATE_FORMAT))
    }
    if (this.due) {
      if (this.date && this.date.isBefore(this.due)) {
        // adding all the dates between date and due
        let current = this.date.add(1, 'day')
        while (current.isBefore(this.due)) {
          dates.push(current.format(DATE_FORMAT))
          current = current.add(1, 'day')
        }
        dates.push(this.due.format(DATE_FORMAT))
      } else {
        dates.push(this.due.format(DATE_FORMAT))
      }
    }
    return dates
  }

  isTaskRelatedToDate(date: dayjs.Dayjs) {
    return this.dates.includes(date.format(DATE_FORMAT))
  }

  initWatcher() {
    if (this.watcherInitialized) {
      return
    }
    this.fileWatcher = new FileWatcher(
      GlobalStore.getInstance().app,
      this.taskPath,
      debounce(
        (event) => {
          if (event.oldPath && event.newPath && event.oldPath !== event.newPath) {
            // file renamed
            this._taskPath = event.newPath
            this._taskName = getNameFromPath(event.newPath)
          }

          this.load(true)
          this.loadContent()
        },
        AbeleConfig.getInstance().refreshDelay,
        true
      )
    )

    this.watcherInitialized = true
  }

  toCreateDTO(): TaskCreateDTO {
    return {
      title: this.title,
      description: this.description,
      createdAt: this.createdAt,
      completedAt: this.completedAt,
      date: this.date,
      dateTime: this.dateTime,
      due: this.due,
      dueTime: this.dueTime,
      recurrence: this.recurrence,
      content: this.content,
      oldProps: this.oldProps,
    }
  }

  cleanTaskData() {
    this.title = ''
    this.description = ''
    this.createdAt = null
    this.completedAt = null
    this.date = null
    this.dateTime = null
    this.due = null
    this.dueTime = null
    this.recurrence = null
    this.content = ''
    this.loaded = false
    this.taskNotFound = false
    this.oldProps = {}
  }

  cleanup() {
    this.cleanedUp = true
    this.fileWatcher?.cleanup()
    this.fileWatcher = null
    this.watcherInitialized = false
    this.cleanTaskData()
  }
}
