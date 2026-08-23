import { Journal, JournalDTO } from '@/entities/Journal'
import {
  AiSettings,
  DEFAULT_AI_SETTINGS,
  AiProvider,
  ImageProvider,
  migrateOldPermissions,
} from '@/ai/types'
import { migrateAgents } from '@/ai/agents/migration'
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
  // AI Agent settings
  ai?: AiSettings
  // Finance settings
  transactionPathTemplate?: string // Path template for new transactions
  transactionTemplatePath?: string // Path to the template note for new transactions
  accountsFolder?: string // Default folder for new accounts
  financeCategoriesFolder?: string // Default folder for new finance categories
  defaultCurrency?: string // Default currency code for new transactions
  pinnedCurrencies?: string // Comma-separated currencies to show in sidebar
  fireflyBaseUrl?: string // Firefly III instance base URL for migration
  fireflyToken?: string // Firefly III Personal Access Token for migration
  // Time tracking settings
  timeEntryPathTemplate?: string // Path template for new time entries
  timeTrackableNoteTypes?: string[] // Note types that show timer button in header
  timeTrackAllNotes?: boolean // Show timer button for all notes
  // Links
  links?: LinkDefinition[]
  // Other
  snippetsFolder?: string
  fullWidthSidebars?: boolean
}

export interface LinkDefinition {
  id: string
  name: string
  type: 'script' | 'command'
  scriptName: string
  commandId: string
  waitForSync: boolean
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
  ai: { ...DEFAULT_AI_SETTINGS },
  transactionPathTemplate: 'Finance/Transactions/{{date:YYYY/MM}}/{{title}}',
  transactionTemplatePath: '',
  accountsFolder: 'Finance/Accounts',
  financeCategoriesFolder: 'Finance/Categories',
  defaultCurrency: 'EUR',
  pinnedCurrencies: 'EUR',
  fireflyBaseUrl: '',
  fireflyToken: '',
  timeEntryPathTemplate: 'Time/{{date:YYYY/MM}}/{{groups}} {{start}}',
  timeTrackableNoteTypes: ['task'],
  timeTrackAllNotes: false,
  links: [],
  snippetsFolder: '',
  fullWidthSidebars: false,
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
  public ai: AiSettings
  public transactionPathTemplate: string
  public transactionTemplatePath: string
  public accountsFolder: string
  public financeCategoriesFolder: string
  public defaultCurrency: string
  public pinnedCurrencies: string
  public fireflyBaseUrl: string
  public fireflyToken: string
  public timeEntryPathTemplate: string
  public timeTrackableNoteTypes: string[]
  public timeTrackAllNotes: boolean
  public links: LinkDefinition[]
  public snippetsFolder: string
  public fullWidthSidebars: boolean

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

  isTimeTrackable(type: string | null): boolean {
    if (this.timeTrackAllNotes) return true
    if (!type) return false
    return this.timeTrackableNoteTypes.includes(type)
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
    this.ai = settings?.ai ? { ...DEFAULT_AI_SETTINGS, ...settings.ai } : { ...DEFAULT_AI_SETTINGS }
    // Runs before the legacy migrations below, so a settings file predating both is folded
    // into an agent using the values it actually had on disk.
    migrateAgents(this.ai)
    // Migrate old boolean permissions to toolModes
    if (
      settings?.ai &&
      !settings.ai.toolModes &&
      (settings.ai as any).allowWebSearch !== undefined
    ) {
      this.ai.toolModes = migrateOldPermissions(null, settings.ai as any)
    }
    // Migrate image generation settings to imageProviders
    if (settings?.ai && !settings.ai.imageProviders) {
      const old = settings.ai as any
      // Check for v2 format (single imageGeneration object)
      const ig = old.imageGeneration
      // Check for v1 format (openRouterApiKey + imageModel)
      const legacyKey = old.openRouterApiKey || ''
      const legacyModel = old.imageModel || ''

      if (ig) {
        // Migrate v2 → v3
        const provider: ImageProvider = {
          id: 'migrated-img',
          name: ig.apiType === 'openai' ? 'OpenAI' : 'OpenRouter',
          apiType: ig.apiType || 'openrouter',
          endpoint: ig.endpoint || '',
          apiKeyId: ig.apiKeyId || '',
          models: [
            {
              id: ig.model || 'gpt-image-1',
              name: ig.model || 'gpt-image-1',
              size: ig.size || '1024x1024',
              outputFormat: ig.outputFormat || 'png',
              quality: ig.quality || 'medium',
            },
          ],
        }
        this.ai.imageProviders = [provider]
        this.ai.defaultImageModel = `${provider.id}::${provider.models[0].id}`
      } else if (legacyKey || legacyModel) {
        // Migrate v1 → v3
        const modelId = legacyModel || 'google/gemini-2.5-flash-preview:thinking'
        const provider: ImageProvider = {
          id: 'migrated-img',
          name: 'OpenRouter',
          apiType: 'openrouter',
          endpoint: '',
          apiKeyId: legacyKey,
          models: [
            {
              id: modelId,
              name: modelId,
              size: '1024x1024',
              outputFormat: 'png',
              quality: 'medium',
            },
          ],
        }
        this.ai.imageProviders = [provider]
        this.ai.defaultImageModel = `${provider.id}::${modelId}`
      }
    }
    this.transactionPathTemplate =
      settings?.transactionPathTemplate || DEFAULT_SETTINGS.transactionPathTemplate
    this.transactionTemplatePath =
      settings?.transactionTemplatePath ?? DEFAULT_SETTINGS.transactionTemplatePath
    this.accountsFolder = settings?.accountsFolder || DEFAULT_SETTINGS.accountsFolder
    this.financeCategoriesFolder =
      settings?.financeCategoriesFolder || DEFAULT_SETTINGS.financeCategoriesFolder
    this.defaultCurrency = settings?.defaultCurrency || DEFAULT_SETTINGS.defaultCurrency
    this.pinnedCurrencies = settings?.pinnedCurrencies ?? DEFAULT_SETTINGS.pinnedCurrencies
    this.fireflyBaseUrl = settings?.fireflyBaseUrl ?? DEFAULT_SETTINGS.fireflyBaseUrl
    this.fireflyToken = settings?.fireflyToken ?? DEFAULT_SETTINGS.fireflyToken
    this.timeEntryPathTemplate =
      settings?.timeEntryPathTemplate ?? DEFAULT_SETTINGS.timeEntryPathTemplate
    this.timeTrackableNoteTypes = settings?.timeTrackableNoteTypes || [
      ...DEFAULT_SETTINGS.timeTrackableNoteTypes,
    ]
    this.timeTrackAllNotes = settings?.timeTrackAllNotes ?? DEFAULT_SETTINGS.timeTrackAllNotes
    this.links = (settings?.links || []).map((l) => ({
      ...l,
      type: l.type || 'script',
      commandId: l.commandId || '',
      waitForSync: l.waitForSync ?? true,
    }))
    this.snippetsFolder = settings?.snippetsFolder ?? DEFAULT_SETTINGS.snippetsFolder
    this.fullWidthSidebars = settings?.fullWidthSidebars ?? DEFAULT_SETTINGS.fullWidthSidebars
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
      ai: { ...this.ai },
      transactionPathTemplate: this.transactionPathTemplate,
      transactionTemplatePath: this.transactionTemplatePath,
      accountsFolder: this.accountsFolder,
      financeCategoriesFolder: this.financeCategoriesFolder,
      defaultCurrency: this.defaultCurrency,
      pinnedCurrencies: this.pinnedCurrencies,
      fireflyBaseUrl: this.fireflyBaseUrl,
      fireflyToken: this.fireflyToken,
      timeEntryPathTemplate: this.timeEntryPathTemplate,
      timeTrackableNoteTypes: [...this.timeTrackableNoteTypes],
      timeTrackAllNotes: this.timeTrackAllNotes,
      links: [...this.links],
      snippetsFolder: this.snippetsFolder,
      fullWidthSidebars: this.fullWidthSidebars,
    }
  }
}
