import { Journal, JournalDTO } from '@/entities/Journal'
import AbelePlugin from '@/main'

export interface AbeleSettings {
  refreshDelay: number // in milliseconds
  tasksFolder?: string // Optional folder path for tasks
  logsNotesTypes?: string[] // Optional array of note types to consider as log notes
  tasksTimeChoices?: string[] // Optional array of time choices for tasks
  tasksDateChoices?: string[] // Optional array of date choices for tasks
  tasksRecurrenceChoices?: string[] // Optional array of recurrence choices for tasks
  weekStartsOnMonday?: boolean // Optional setting for week start day
  journals?: JournalDTO[]
  busyDayThreshold?: number // Optional threshold for busy day
  excludedPathsForDefaultTemplate?: string[] // Paths where default template should not apply
  // Server settings
  baseUrl?: string // Backend API base URL
  apiToken?: string // API authentication token
}

export const DEFAULT_SETTINGS: AbeleSettings = {
  refreshDelay: 300,
  tasksFolder: 'Tasks',
  logsNotesTypes: ['journal', 'log', 'daily'],
  tasksTimeChoices: ['09:00', '12:00', '18:00', '21:00'],
  tasksDateChoices: ['Today', 'Tomorrow', 'Next Week', 'Next Month'],
  tasksRecurrenceChoices: ['Daily', 'Weekly', 'Monthly', 'Yearly'],
  weekStartsOnMonday: true,
  journals: [],
  busyDayThreshold: 3,
  excludedPathsForDefaultTemplate: ['attachments/', 'templates/'],
  baseUrl: '',
  apiToken: '',
}

export class AbeleConfig {
  public plugin: AbelePlugin

  public refreshDelay: number
  public tasksFolder: string
  private _logsNotesTypes: string[] = []
  private _logsNotesPathsRegexps: RegExp[] = []
  public tasksTimeChoices: string[]
  public tasksDateChoices: string[]
  public tasksRecurrenceChoices: string[]
  public weekStartsOnMonday: boolean
  public busyDayThreshold: number
  public excludedPathsForDefaultTemplate: string[]

  public journals: Journal[]
  public baseUrl: string
  public apiToken: string

  public get logsNotesTypes(): string[] {
    return this._logsNotesTypes
  }

  public set logsNotesTypes(values: string[]) {
    this._logsNotesTypes = []
    this._logsNotesPathsRegexps = []

    for (const value of values) {
      this._logsNotesTypes.push(value)

      if (value.startsWith('/') && value.endsWith('/')) {
        try {
          const pattern = value.slice(1, -1)
          this._logsNotesPathsRegexps.push(new RegExp(pattern))
        } catch (e) {
          console.error(`Invalid regex pattern in logsNotesTypes: ${value}`, e)
        }
      }
    }
  }

  isLogType(type: string | null, path: string): boolean {
    if (type) return this._logsNotesTypes.includes(type)

    for (const regexp of this._logsNotesPathsRegexps) {
      if (regexp.test(path)) return true
    }
    return false
  }

  /**
   * Check if a path is excluded from default template application
   */
  isPathExcludedFromDefaultTemplate(path: string): boolean {
    for (const excluded of this.excludedPathsForDefaultTemplate) {
      if (path.startsWith(excluded)) return true
    }
    return false
  }

  private static instance: AbeleConfig

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}

  public static getInstance(): AbeleConfig {
    if (!AbeleConfig.instance) {
      AbeleConfig.instance = new AbeleConfig()
    }
    return AbeleConfig.instance
  }

  public init(plugin: AbelePlugin): void {
    this.plugin = plugin
  }

  public destroy(): void {
    this.plugin = null
  }

  async loadSettings() {
    if (!this.plugin) {
      throw new Error('AbeleConfig not initialized with plugin instance.')
    }

    this.applySettings(await this.plugin.loadData())
  }

  async saveSettings() {
    if (!this.plugin) {
      throw new Error('AbeleConfig not initialized with plugin instance.')
    }

    await this.plugin.saveData(this.exportSettings())
  }

  applySettings(settings?: AbeleSettings): void {
    this.refreshDelay = settings?.refreshDelay || DEFAULT_SETTINGS.refreshDelay
    this.tasksFolder = settings?.tasksFolder || DEFAULT_SETTINGS.tasksFolder
    this.logsNotesTypes = settings?.logsNotesTypes || [...DEFAULT_SETTINGS.logsNotesTypes]
    this.tasksTimeChoices = settings?.tasksTimeChoices || [...DEFAULT_SETTINGS.tasksTimeChoices]
    this.tasksDateChoices = settings?.tasksDateChoices || [...DEFAULT_SETTINGS.tasksDateChoices]
    this.tasksRecurrenceChoices = settings?.tasksRecurrenceChoices || [
      ...DEFAULT_SETTINGS.tasksRecurrenceChoices,
    ]
    this.weekStartsOnMonday = settings?.weekStartsOnMonday ?? DEFAULT_SETTINGS.weekStartsOnMonday
    this.journals = (settings?.journals || [...DEFAULT_SETTINGS.journals]).map(
      (j) => new Journal(j)
    )
    this.busyDayThreshold = settings?.busyDayThreshold || DEFAULT_SETTINGS.busyDayThreshold
    this.excludedPathsForDefaultTemplate = settings?.excludedPathsForDefaultTemplate || [
      ...DEFAULT_SETTINGS.excludedPathsForDefaultTemplate,
    ]
    this.baseUrl = settings?.baseUrl || DEFAULT_SETTINGS.baseUrl
    this.apiToken = settings?.apiToken || DEFAULT_SETTINGS.apiToken
  }

  exportSettings(): AbeleSettings {
    return {
      refreshDelay: this.refreshDelay,
      tasksFolder: this.tasksFolder,
      logsNotesTypes: [...this.logsNotesTypes],
      tasksTimeChoices: [...this.tasksTimeChoices],
      tasksDateChoices: [...this.tasksDateChoices],
      tasksRecurrenceChoices: [...this.tasksRecurrenceChoices],
      weekStartsOnMonday: this.weekStartsOnMonday,
      journals: this.journals.map((j) => j.toDTO()),
      busyDayThreshold: this.busyDayThreshold,
      excludedPathsForDefaultTemplate: [...this.excludedPathsForDefaultTemplate],
      baseUrl: this.baseUrl,
      apiToken: this.apiToken,
    }
  }
}
