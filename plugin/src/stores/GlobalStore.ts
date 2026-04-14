import { Footer } from '@/entities/Footer'
import { Gallery } from '@/entities/Gallery'
import { Header } from '@/entities/Header'
import { Task } from '@/entities/Task'
import { TaskHeader } from '@/entities/TaskHeader'
import { TasksList } from '@/entities/TasksList'
import { TransactionsList } from '@/entities/TransactionsList'
import { AccountsList } from '@/entities/AccountsList'
import { BalanceIndex } from '@/entities/BalanceIndex'
import { parseNoteContent, renderTemplate } from '@/helpers/notesUtils'
import {
  cleanFileName,
  cleanNoteName,
  getFolderFromPath,
  resolvePath,
} from '@/helpers/pathsHelpers'
import { DATE_FORMAT } from '@/constants/dates'
import dayjs from 'dayjs'
import { cleanTaskName } from '@/helpers/tasksUtils'
import { getAvailablePath, readFileContent } from '@/helpers/vaultUtils'
import { VaultWatcher } from '@/helpers/VaultWatcher'
import { AbeleConfig } from '@/services/AbeleConfig'
import { App, TFile } from 'obsidian'
import { computed, ref, toRaw } from 'vue'

export class GlobalStore {
  private static instance: GlobalStore
  private _app: App

  public readonly initialized = ref(false)
  public readonly currentFile = ref<TFile>(null)

  public readonly tasksContainers = ref<Array<Task>>([])
  public readonly tasksHeadersContainers = ref<Array<TaskHeader>>([])
  public readonly footersContainers = ref<Array<Footer>>([])
  public readonly headersContainers = ref<Array<Header>>([])
  public readonly galleriesContainers = ref<Array<Gallery>>([])
  public readonly findAndReplaceModalOpened = ref(false)
  public readonly migrateFromDataviewModalOpened = ref(false)
  public readonly saveMediaModalOpened = ref(false)
  public readonly unusedMediaModalOpened = ref(false)
  public readonly deduplicateMediaModalOpened = ref(false)
  public readonly migrateFromFireflyModalOpened = ref(false)
  public readonly migrateDataviewFieldsModalOpened = ref(false)

  public readonly timelineSidebarId = ref<string | null>(null)
  public readonly todoSidebarId = ref<string | null>(null)
  public readonly aiSidebarId = ref<string | null>(null)
  public readonly financeSidebarId = ref<string | null>(null)

  public readonly tasksList = ref<TasksList | null>(null)
  public readonly transactionsList = ref<TransactionsList | null>(null)
  public readonly accountsList = ref<AccountsList | null>(null)
  public readonly balanceIndex = ref<BalanceIndex | null>(null)

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

        const isTransaction = fm?.type === 'transaction'
        if (isTransaction) {
          const config = AbeleConfig.getInstance()
          const fileContent = await readFileContent(event.file)
          const parsedContent = await parseNoteContent(event.file, fileContent)
          const lines = parsedContent.content
            .split('\n')
            .filter((line: string) => line.trim() !== '')
          const newTitle =
            lines.length > 0 ? cleanTaskName(lines[0]) || 'New Transaction' : 'New Transaction'

          const stripWikilink = (s?: string | null) => (s ? s.replace(/\[\[|\]\]/g, '').trim() : '')

          const data: Record<string, string> = {
            date: fm.date || dayjs().format(DATE_FORMAT),
            title: newTitle,
            from: stripWikilink(fm.from),
            to: stripWikilink(fm.to),
            amount: fm.amount != null ? String(fm.amount) : '',
            currency: fm.currency || config.defaultCurrency || '',
          }

          let rendered = renderTemplate(config.transactionPathTemplate, data)
          if (!rendered.endsWith('.md')) rendered += '.md'

          const newPath = await getAvailablePath(rendered, event.file.path)

          if (newPath !== event.file.path) {
            await this.app.fileManager.renameFile(event.file, newPath)
          }
        }
      }
    })
  }

  public initTasksList(): void {
    if (!this.tasksList.value) {
      this.tasksList.value = new TasksList()
    }
  }

  public initFinance(): void {
    if (!this.transactionsList.value) {
      this.transactionsList.value = new TransactionsList()
    }
    if (!this.accountsList.value) {
      this.accountsList.value = new AccountsList()
    }
    if (!this.balanceIndex.value && this.transactionsList.value && this.accountsList.value) {
      this.balanceIndex.value = new BalanceIndex(
        toRaw(this.transactionsList.value) as unknown as TransactionsList,
        toRaw(this.accountsList.value) as unknown as AccountsList
      )
    }
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
    this.galleriesContainers.value = []
    this.tasksList.value?.cleanup()
    this.tasksList.value = null
    this.balanceIndex.value?.cleanup()
    this.balanceIndex.value = null
    this.transactionsList.value?.cleanup()
    this.transactionsList.value = null
    this.accountsList.value?.cleanup()
    this.accountsList.value = null
    this.aiSidebarId.value = null
    this._vaultWatcher.cleanup()

    console.debug('GlobalStore destroyed')
  }
}
