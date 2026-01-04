import { Footer } from '@/entities/Footer'
import { Header } from '@/entities/Header'
import { Task } from '@/entities/Task'
import { TaskHeader } from '@/entities/TaskHeader'
import { TasksList } from '@/entities/TasksList'
import { parseNoteContent } from '@/helpers/notesUtils'
import { getFolderFromPath, resolvePath } from '@/helpers/pathsHelpers'
import { cleanTaskName } from '@/helpers/tasksUtils'
import { getAvailablePath, readFileContent } from '@/helpers/vaultUtils'
import { VaultWatcher } from '@/helpers/VaultWatcher'
import { AbeleConfig } from '@/services/AbeleConfig'
import { App, TFile } from 'obsidian'
import { computed, ref } from 'vue'

export class GlobalStore {
  private static instance: GlobalStore
  private _app: App

  public readonly initialized = ref(false)
  public readonly currentFile = ref<TFile>(null)

  public readonly tasksContainers = ref<Array<Task>>([])
  public readonly tasksHeadersContainers = ref<Array<TaskHeader>>([])
  public readonly footersContainers = ref<Array<Footer>>([])
  public readonly headersContainers = ref<Array<Header>>([])
  public readonly findAndReplaceModalOpened = ref(false)
  public readonly migrateFromDataviewModalOpened = ref(false)

  public readonly timelineSidebarId = ref<string | null>(null)
  public readonly todoSidebarId = ref<string | null>(null)

  public readonly tasksList = ref<TasksList | null>(null)

  public readonly settingsTabId = ref<string>(null)

  public readonly weekStartsOnMonday = ref(AbeleConfig.getInstance().weekStartsOnMonday)

  public readonly selectedJournal = computed(() => {
    if (!this.currentFile.value) return

    for (const journal of AbeleConfig.getInstance().journals) {
      const date = journal.checkIfNotePathIsJournal(this.currentFile.value.path)
      if (date) return { date, journal }
    }
  })

  private _vaultWatcher: VaultWatcher
  public get vaultWatcher(): VaultWatcher {
    return this._vaultWatcher
  }

  public static getInstance(): GlobalStore {
    if (!GlobalStore.instance) {
      GlobalStore.instance = new GlobalStore()
    }
    return GlobalStore.instance
  }

  public get app(): App {
    return this._app
  }

  public init(app: App): void {
    if (this.initialized.value) {
      return
    }

    this._app = app
    this._vaultWatcher = new VaultWatcher(app)
    this.tasksList.value = new TasksList()

    console.debug('GlobalStore initialized')
    this.initialized.value = true

    // TODO: move tasks logic to the more appropriate place
    this.vaultWatcher.registerCallback(async (event) => {
      if (event.type === 'modify') {
        const fm = this.app.metadataCache.getFileCache(event.file)?.frontmatter
        const isTask = fm?.type === 'task'
        const isRecurringTask = fm?.recurrence != null
        const taskDate = fm?.due ?? fm?.date

        if (isTask) {
          const fileContent = await readFileContent(event.file)
          const parsedContent = await parseNoteContent(event.file, fileContent)
          const lines = parsedContent.content
            .split('\n')
            .filter((line: string) => line.trim() !== '')
          const rawTitle = isRecurringTask && taskDate ? `${lines[0]} ${taskDate}` : lines[0]
          const newTaskTitle = lines.length > 0 ? cleanTaskName(rawTitle) || 'New Task' : 'New Task'

          const taskFolder = getFolderFromPath(event.file.path)
          const newPath = await getAvailablePath(
            resolvePath(taskFolder, newTaskTitle),
            event.file.path
          )

          if (newPath !== event.file.path) {
            await this.app.fileManager.renameFile(event.file, newPath)
          }
        }
      }
    })
  }

  public destroy(): void {
    if (!this.initialized.value) {
      return
    }

    this.initialized.value = false
    this.currentFile.value = null
    this.tasksContainers.value = []
    this.tasksHeadersContainers.value = []
    this.footersContainers.value = []
    this.tasksList.value?.cleanup()
    this.tasksList.value = null
    this._vaultWatcher.cleanup()

    console.debug('GlobalStore destroyed')
  }
}
