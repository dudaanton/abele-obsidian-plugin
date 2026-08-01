import { Footer } from '@/entities/Footer'
import { Footnote } from '@/entities/Footnote'
import { Gallery } from '@/entities/Gallery'
import { Header } from '@/entities/Header'
import { Task } from '@/entities/Task'
import { TaskHeader } from '@/entities/TaskHeader'
import { TasksList } from '@/entities/TasksList'
import { TransactionsList } from '@/entities/TransactionsList'
import { TimeEntryList } from '@/entities/TimeEntryList'
import { AccountsList } from '@/entities/AccountsList'
import { BalanceIndex } from '@/entities/BalanceIndex'
import { extractAliasOrNameFromWikilink } from '@/helpers/pathsHelpers'
import { parseNoteContent, renderTemplate } from '@/helpers/notesUtils'
import {
  cleanFileName,
  cleanNoteName,
  getFolderFromPath,
  normalizePath,
  resolvePath,
  wikilinkToPath,
} from '@/helpers/pathsHelpers'
import { DATE_FORMAT } from '@/constants/dates'
import dayjs from 'dayjs'
import { cleanTaskName } from '@/helpers/tasksUtils'
import { getAvailablePath, readFileContent } from '@/helpers/vaultUtils'
import { VaultWatcher } from '@/helpers/VaultWatcher'
import { AbeleConfig } from '@/services/AbeleConfig'
import { App, TFile } from 'obsidian'
import { computed, ref, shallowRef, toRaw } from 'vue'
import type { FindAndReplaceInstance } from '@/bases/FindAndReplaceView'

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
  public readonly footnotesContainers = ref<Array<Footnote>>([])
  public readonly findAndReplaceModalOpened = ref(false)
  public readonly migrateFromDataviewModalOpened = ref(false)
  public readonly saveMediaModalOpened = ref(false)
  public readonly importFilesModalOpened = ref(false)
  public readonly previewImagePath = ref<string | null>(null)
  public readonly unusedMediaModalOpened = ref(false)
  public readonly deduplicateMediaModalOpened = ref(false)
  public readonly migrateFromFireflyModalOpened = ref(false)
  public readonly migrateDataviewFieldsModalOpened = ref(false)
  public readonly migrateFromTogglModalOpened = ref(false)
  public readonly scriptFormModalOpened = ref(false)
  public readonly scriptFormFields = ref<
    Array<{
      name: string
      label: string
      type?: string
      options?: string[]
      default?: string
      required?: boolean
    }>
  >([])
  public readonly scriptFormResolve = ref<((result: Record<string, string> | null) => void) | null>(
    null
  )

  public readonly timelineSidebarId = ref<string | null>(null)
  public readonly todoSidebarId = ref<string | null>(null)
  public readonly aiSidebarId = ref<string | null>(null)
  public readonly financeSidebarId = ref<string | null>(null)
  public readonly timeTrackingSidebarId = ref<string | null>(null)
  public readonly findAndReplaceBasesInstances = shallowRef<Map<string, FindAndReplaceInstance>>(
    new Map()
  )

  public readonly tasksList = ref<TasksList | null>(null)
  public readonly transactionsList = ref<TransactionsList | null>(null)
  public readonly accountsList = ref<AccountsList | null>(null)
  public readonly balanceIndex = ref<BalanceIndex | null>(null)
  public readonly timeEntryList = ref<TimeEntryList | null>(null)

  public readonly settingsContainer = shallowRef<HTMLElement | null>(null)
  public readonly themeVersion = ref(0)

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

          // Auto-set currency from accounts
          const al = this.accountsList.value
          if (al) {
            const resolveAccount = (wl?: string) => {
              if (!wl) return null
              const path = wikilinkToPath(wl)
              if (!path) return null
              const file = this.app.metadataCache.getFirstLinkpathDest(
                path.replace(/\.md$/, ''),
                event.file.path
              )
              return file ? al.accounts.get(normalizePath(file.path)) : null
            }

            const fromAccount = resolveAccount(parsedContent.from as string)
            const toAccount = resolveAccount(parsedContent.to as string)
            const fromCur = fromAccount?.currency
            const toCur = toAccount?.currency

            const txCurrency = parsedContent.currency as string | undefined
            const txForeignCurrency = parsedContent.foreignCurrency as string | undefined

            if (fromCur && toCur && fromCur !== toCur) {
              if (txCurrency !== fromCur || txForeignCurrency !== toCur) {
                await this.app.fileManager.processFrontMatter(event.file, (frontmatter) => {
                  frontmatter.currency = fromCur
                  frontmatter.foreignCurrency = toCur
                })
              }
            } else {
              const accountCurrency = fromCur || toCur
              if (accountCurrency && txCurrency !== accountCurrency) {
                await this.app.fileManager.processFrontMatter(event.file, (frontmatter) => {
                  frontmatter.currency = accountCurrency
                })
              }
            }
          }

          const data: Record<string, string> = {
            date: (parsedContent.date as string) || dayjs().format(DATE_FORMAT),
            title: newTitle,
            from: stripWikilink(parsedContent.from as string),
            to: stripWikilink(parsedContent.to as string),
            amount: parsedContent.amount != null ? String(parsedContent.amount) : '',
            currency: (parsedContent.currency as string) || config.defaultCurrency || '',
          }

          let rendered = renderTemplate(config.transactionPathTemplate, data)
          if (!rendered.endsWith('.md')) rendered += '.md'

          const newPath = await getAvailablePath(rendered, event.file.path)

          if (newPath !== event.file.path) {
            await this.app.fileManager.renameFile(event.file, newPath)
          }
        }

        const isTimeEntry = fm?.type === 'time-entry'
        if (isTimeEntry) {
          const config = AbeleConfig.getInstance()
          const fileContent = await readFileContent(event.file)
          const parsedContent = await parseNoteContent(event.file, fileContent)
          const groups = Array.isArray(parsedContent.groups)
            ? (parsedContent.groups as string[])
            : []
          const groupsLabel =
            groups.length > 0
              ? groups.map((g: string) => extractAliasOrNameFromWikilink(g)).join(', ')
              : 'Timer'
          const startDt = parsedContent.start ? dayjs(parsedContent.start as string) : null
          const endDt = parsedContent.end ? dayjs(parsedContent.end as string) : null
          const startLabel = startDt?.isValid() ? startDt.format('HH-mm') : ''
          const endLabel = endDt?.isValid() ? endDt.format('HH-mm') : ''

          const data: Record<string, string> = {
            date: (startDt?.isValid() ? startDt : dayjs()).format(DATE_FORMAT),
            groups: groupsLabel,
            start: startLabel,
            end: endLabel,
          }

          let rendered = renderTemplate(config.timeEntryPathTemplate, data)
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

  public initTimeTracking(): void {
    if (!this.timeEntryList.value) {
      this.timeEntryList.value = new TimeEntryList()
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

  /**
   * Remove widgets whose DOM containers no longer exist in the document.
   * This catches cases where CodeMirror doesn't call WidgetType.destroy().
   */
  public cleanupOrphanedWidgets(): void {
    const cleanupArray = <T extends { id: string; cleanup: () => void }>(
      arr: Array<T>,
      attr: string
    ) => {
      for (let i = arr.length - 1; i >= 0; i--) {
        const el = document.querySelector(`[${attr}='${arr[i].id}']`)
        if (!el || !document.body.contains(el)) {
          arr[i].cleanup()
          arr.splice(i, 1)
        }
      }
    }

    cleanupArray(this.footersContainers.value, 'data-footer-id')
    cleanupArray(this.headersContainers.value, 'data-header-id')
    cleanupArray(this.tasksContainers.value, 'data-task-id')
    cleanupArray(this.tasksHeadersContainers.value, 'data-task-header-id')
    cleanupArray(this.galleriesContainers.value, 'data-gallery-id')
    cleanupArray(this.footnotesContainers.value, 'data-footnote-id')
  }

  public destroy(): void {
    if (!this.initialized.value) {
      return
    }

    this.initialized.value = false
    this.currentFile.value = null

    for (const t of this.tasksContainers.value) t.cleanup()
    this.tasksContainers.value = []
    for (const th of this.tasksHeadersContainers.value) th.cleanup()
    this.tasksHeadersContainers.value = []
    for (const f of this.footersContainers.value) f.cleanup()
    this.footersContainers.value = []
    for (const h of this.headersContainers.value) h.cleanup()
    this.headersContainers.value = []
    for (const g of this.galleriesContainers.value) g.cleanup()
    this.galleriesContainers.value = []
    for (const fn of this.footnotesContainers.value) fn.cleanup()
    this.footnotesContainers.value = []

    this.tasksList.value?.cleanup()
    this.tasksList.value = null
    this.timeEntryList.value?.cleanup()
    this.timeEntryList.value = null
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
