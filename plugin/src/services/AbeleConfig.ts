import { ref } from 'vue'
import { nanoid } from 'nanoid'
import { Notice } from 'obsidian'
import { Journal, JournalDTO } from '@/entities/Journal'
import { AiSettings, DEFAULT_AI_SETTINGS, ImageProvider, migrateOldPermissions } from '@/ai/types'
import { migrateAgents } from '@/ai/agents/migration'
import { pruneToolDescriptions } from '@/ai/tools/toolDescriptionOverrides'
import {
  DEFAULT_ACCOUNTS_LIST,
  normalizeAccountsList,
  type AccountsListSettings,
} from '@/helpers/accountRows'
import AbelePlugin from '@/main'
import { isKitColor } from '@/constants/colors'
import { DEFAULT_LABEL_PROPERTY, type LabelColor } from '@/helpers/taskMeta'
import { DEFAULT_GITHUB_SETTINGS, githubSettingsFrom, type GithubSettings } from '@/github/settings'
import {
  DEFAULT_CALENDAR_SETTINGS,
  calendarSettingsFrom,
  type CalendarSettings,
} from '@/calendars/settings'
import { DEFAULT_READER_SETTINGS, readerSettingsFrom, type ReaderSettings } from '@/reader/settings'
import {
  DEFAULT_QUICK_BUTTON,
  quickButtonSettingsFrom,
  type QuickButtonSettings,
} from '@/quickButton/settings'
import { normalizeRule, type AutomationRule } from '@/automations/types'
import { moveLegacySecrets, notePlainSecrets } from '@/secrets/legacy'

export interface AbeleSettings {
  refreshDelay: number // in milliseconds
  tasksFolder?: string // Optional folder path for tasks
  logsNotesTypes?: string[] // Optional array of note types to consider as log notes
  tasksTimeChoices?: string[] // Optional array of time choices for tasks
  tasksDateChoices?: string[] // Optional array of date choices for tasks
  tasksRecurrenceChoices?: string[] // Optional array of recurrence choices for tasks
  weekStartsOnMonday?: boolean // Optional setting for week start day
  /** Frontmatter property a task's labels are read from. */
  taskLabelProperty?: string
  /** A colour per label value. A label with no entry here is grey. */
  taskLabelColors?: LabelColor[]
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
  /**
   * Legacy: the Firefly III token as it was once saved, in the clear. Moved into the keychain
   * at the next save and dropped from the file (`src/secrets/legacy.ts`); read the token with
   * `fireflyToken()`, never from here.
   */
  fireflyToken?: string
  /** What the accounts panel lists and how it orders them. */
  accountsList?: AccountsListSettings
  // Time tracking settings
  timeEntryPathTemplate?: string // Path template for new time entries
  timeTrackableNoteTypes?: string[] // Note types that show timer button in header
  timeTrackAllNotes?: boolean // Show timer button for all notes
  // Links
  links?: LinkDefinition[]
  // Buttons added to the header of notes of a given type
  headerButtons?: HeaderButtonDefinition[]
  /** Scripts run by themselves when something happens to a note. */
  automations?: AutomationRule[]
  // Maps
  /** Note property holding a place's `lat, lon`. What the agent is told to write into. */
  mapCoordinatesProperty?: string
  /** A MapLibre style URL of one's own, instead of the free tiles the plugin ships with. */
  mapStyleUrl?: string
  // Other
  snippetsFolder?: string
  fullWidthSidebars?: boolean
  /** On a tablet, sidebars take half the screen. The phone has its own, `fullWidthSidebars`. */
  halfWidthSidebarsOnTablet?: boolean
  /** ```mermaid blocks drawn by the plugin's viewer, with zoom and full screen, not Obsidian's. */
  mermaidViewer?: boolean
  /**
   * The plugin's own drawing of some properties: a wallet's balance, arithmetic in numbers, file
   * cards for File and Files properties and for `cover`. Off is Obsidian's own drawing.
   */
  propertyWidgets?: boolean
  /**
   * A panel at the top of the screen showing what the page reports about the on-screen
   * keyboard. For finding out from a phone what no emulator shows; stays on its device.
   */
  keyboardDiagnostics?: boolean
  // GitHub links opened inside Obsidian
  github?: GithubSettings
  // The book reader: page layout, text and colours
  reader?: ReaderSettings
  /** External calendars shown beside the tasks, read only. Their links and passwords are keys. */
  calendars?: CalendarSettings
  /** The floating button on a phone and the menu it opens. */
  quickButton?: QuickButtonSettings
  /**
   * The synced secret store, encrypted — see `src/secrets/`. Kept as whatever the file holds:
   * it is opened and checked by the store, never by the settings, and never shown to an agent
   * nor carried by a settings transfer.
   */
  secretStore?: unknown
}

export interface LinkDefinition {
  id: string
  name: string
  type: 'script' | 'command'
  scriptName: string
  commandId: string
  waitForSync: boolean
}

/**
 * A button placed in the header of every note of a given type, running a script.
 *
 * `params` holds a value per parameter the script declares, and each value is a template:
 * `{{title}}`, `{{path}}` and any frontmatter field of the note are substituted before the
 * script runs, which is what lets one button mean something different on each note.
 */
export interface HeaderButtonDefinition {
  id: string
  /** Shown on the button, beside its icon. */
  name: string
  /** A lucide icon name, as everywhere else in the header. */
  icon: string
  /** Note types this button belongs to, matched against the note's `type` frontmatter. */
  noteTypes: string[]
  scriptName: string
  /** Parameter values, by parameter name. Empty means the script's own default. */
  params: Record<string, string>
  /** Off keeps the button configured without showing it anywhere. Absent means on. */
  enabled?: boolean
  /** Only the icon in the header, with the name as its tooltip, for a header already full. */
  iconOnly?: boolean
  /** On every note, whatever its type or folder. */
  allNotes?: boolean
  /** Folders whose notes, at any depth, show the button — besides the notes of `noteTypes`. */
  folders?: string[]
  /**
   * Frontmatter the note must have, on top of where it is: the button shows on a note of its
   * types or folders only when these hold. A button naming no type and no folder shows on any
   * note these hold for.
   */
  conditions?: HeaderButtonCondition[]
  /** `all` (the default) needs every condition to hold, `any` one of them. */
  conditionMode?: 'all' | 'any'
}

/** What a header button asks of one frontmatter property. */
export type PropertyTest = 'equals' | 'not-equals' | 'filled' | 'empty'

export const PROPERTY_TESTS: PropertyTest[] = ['equals', 'not-equals', 'filled', 'empty']

export interface HeaderButtonCondition {
  property: string
  test: PropertyTest
  /** Compared for `equals` and `not-equals`, ignored by the other two. */
  value: string
}

/**
 * A button's conditions as they may arrive: from an older settings file (none at all), from
 * another device, or typed by hand into `data.json`. Anything that is not a condition is
 * dropped rather than left to break the header, and a test nobody knows reads as `equals`.
 */
export function normalizeConditions(raw: unknown): HeaderButtonCondition[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map((c) => ({
      property: typeof c.property === 'string' ? c.property : '',
      test: PROPERTY_TESTS.includes(c.test as PropertyTest) ? (c.test as PropertyTest) : 'equals',
      value:
        typeof c.value === 'string'
          ? c.value
          : typeof c.value === 'number' || typeof c.value === 'boolean'
            ? String(c.value)
            : '',
    }))
}

/** A link as settings, an agent or a transfer may have left it, made whole. */
export function normalizeLink(raw: Partial<LinkDefinition>): LinkDefinition {
  return {
    ...raw,
    id: raw.id || nanoid(),
    name: raw.name ?? '',
    scriptName: raw.scriptName ?? '',
    type: raw.type || 'script',
    commandId: raw.commandId || '',
    waitForSync: raw.waitForSync ?? true,
  }
}

/**
 * A header button made whole. Older settings files have no buttons at all, and a button saved
 * before a field existed is missing it rather than holding a default — so each one is filled in
 * on the way in, and so is one an agent adds with only the fields it cared about.
 */
export function normalizeHeaderButton(
  raw: Partial<HeaderButtonDefinition>
): HeaderButtonDefinition {
  return {
    ...raw,
    id: raw.id || nanoid(),
    name: raw.name ?? '',
    scriptName: raw.scriptName ?? '',
    icon: raw.icon || 'play',
    noteTypes: raw.noteTypes || [],
    params: raw.params || {},
    enabled: raw.enabled ?? true,
    iconOnly: raw.iconOnly ?? false,
    allNotes: raw.allNotes ?? false,
    folders: raw.folders || [],
    conditions: normalizeConditions(raw.conditions),
    conditionMode: raw.conditionMode === 'any' ? 'any' : 'all',
  }
}

export const DEFAULT_SETTINGS: AbeleSettings = {
  refreshDelay: 300,
  tasksFolder: 'Tasks',
  logsNotesTypes: ['journal', 'log', 'daily'],
  tasksTimeChoices: ['09:00', '12:00', '18:00', '21:00'],
  tasksDateChoices: ['Today', 'Tomorrow', 'Next Week', 'Next Month'],
  tasksRecurrenceChoices: ['Daily', 'Weekly', 'Monthly', 'Yearly'],
  weekStartsOnMonday: true,
  taskLabelProperty: DEFAULT_LABEL_PROPERTY,
  taskLabelColors: [],
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
  accountsList: DEFAULT_ACCOUNTS_LIST,
  timeEntryPathTemplate: 'Time/{{date:YYYY/MM}}/{{groups}} {{start}}',
  timeTrackableNoteTypes: ['task'],
  timeTrackAllNotes: false,
  links: [],
  headerButtons: [],
  automations: [],
  mapCoordinatesProperty: 'coordinates',
  mapStyleUrl: '',
  snippetsFolder: '',
  fullWidthSidebars: false,
  halfWidthSidebarsOnTablet: false,
  mermaidViewer: true,
  propertyWidgets: true,
  keyboardDiagnostics: false,
  github: { ...DEFAULT_GITHUB_SETTINGS },
  reader: { ...DEFAULT_READER_SETTINGS },
  calendars: { ...DEFAULT_CALENDAR_SETTINGS, feeds: [] },
  quickButton: { ...DEFAULT_QUICK_BUTTON },
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
  public taskLabelProperty: string
  public taskLabelColors: LabelColor[]
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
  public accountsList: AccountsListSettings
  public timeEntryPathTemplate: string
  public timeTrackableNoteTypes: string[]
  public timeTrackAllNotes: boolean
  public links: LinkDefinition[]
  public headerButtons: HeaderButtonDefinition[]
  public automations: AutomationRule[] = []
  public mapCoordinatesProperty: string
  public mapStyleUrl: string
  public snippetsFolder: string
  public fullWidthSidebars: boolean
  public halfWidthSidebarsOnTablet: boolean
  public mermaidViewer: boolean
  public propertyWidgets: boolean
  public keyboardDiagnostics: boolean
  public github: GithubSettings
  public reader: ReaderSettings
  public calendars: CalendarSettings = calendarSettingsFrom()
  public quickButton: QuickButtonSettings
  /** Carried through untouched; `SecretStore` is the only thing that reads or writes it. */
  public secretStore: unknown = undefined
  /**
   * The plugin found no settings file when it loaded: its first start in this vault, which is
   * when the documentation opens by itself. Not a setting — nothing saves it.
   */
  public freshInstall = false

  /**
   * Moves on every save and every reload from disk. The fields above are plain, so anything
   * on screen that shows one of them reads this too — that is what redraws it when the
   * settings change underneath it.
   */
  public readonly version = ref(0)

  /**
   * Set when `data.json` exists but could not be read. Nothing is written until it reads
   * again: what is in memory then is defaults, and saving them would replace every setting
   * the file still holds with nothing.
   */
  private unreadable = false
  /** Said once per failed load: saves come from chats as well, and each would repeat it. */
  private unreadableTold = false

  /**
   * Whether the settings file exists and could not be read. Anything that acts on its own —
   * automations — waits while it is: what is in memory then is defaults, not the person's.
   */
  get settingsUnreadable(): boolean {
    return this.unreadable
  }

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

    // `null` is no file at all — a fresh install. `undefined` is a file Obsidian could not
    // parse, and that is still somebody's settings.
    const stored = await this.plugin.loadData()
    this.freshInstall = stored === null
    this.unreadable = stored === undefined
    this.unreadableTold = false
    if (this.unreadable) console.error('[Abele] data.json could not be read; not writing to it')

    const migrated = this.applySettings(stored ?? undefined, await codeToolDescriptions())

    // Migration only rewrites the settings held in memory. Persisting it here is what stops
    // the same migration running again on the next launch — and, for the Comment agent,
    // what stops a fresh one being minted every time the vault is opened.
    if (migrated) await this.writeSettings()
  }

  /**
   * `data.json` changed on disk without this copy of the plugin writing it — sync from another
   * device, most often. Keeping the settings loaded at startup would write them back over it
   * at the next save, whatever that save was about.
   */
  async reloadSettings() {
    await this.loadSettings()
    this.version.value++
  }

  async saveSettings() {
    if (!this.plugin) {
      throw new Error('AbeleConfig not initialized with plugin instance.')
    }

    const plugin = this.plugin
    // A credential still held in the clear goes to the keychain before the file is written,
    // so the write that follows is the one that drops it.
    moveLegacySecrets(this)
    await this.writeSettings()
    this.version.value++

    // The agent's commands and ribbon icon are registered from a setting, and this is the one
    // road every settings change takes — so switching it on takes effect here rather than at
    // the next restart. Read from the local: the plugin may have unloaded during the write.
    if (this.plugin === plugin) plugin.syncAiFeatures()
  }

  /**
   * At startup and when settings arrive from another device: a credential still in the clear
   * goes to the keychain and the file is written without it. Only the write — the features
   * are not synced from here, for the same reason `loadSettings` does not.
   */
  async moveLegacySecrets(): Promise<void> {
    if (moveLegacySecrets(this)) await this.writeSettings()
  }

  /**
   * The write on its own, without the feature sync.
   *
   * A save during `loadSettings` must not register the AI features early: `onload` does that
   * itself, further down, and doing it here would reorder half the plugin's startup.
   */
  private async writeSettings(): Promise<void> {
    if (!this.plugin) return
    if (this.unreadable) {
      if (this.unreadableTold) return
      this.unreadableTold = true
      new Notice(
        'Abele could not read its settings file, so changes to settings are not being saved. ' +
          'Restore the file, or delete it to start from defaults, and reload the plugin.'
      )
      return
    }
    await this.plugin.saveData(this.exportSettings())
  }

  /**
   * Returns whether a migration rewrote anything, so the caller knows to persist it.
   *
   * `toolDefaults` is what each tool says of itself now; a saved description equal to it is
   * dropped with the shipped defaults. Without it only the shipped defaults are recognised.
   */
  applySettings(settings?: AbeleSettings, toolDefaults: Record<string, string> = {}): boolean {
    this.refreshDelay = settings?.refreshDelay || DEFAULT_SETTINGS.refreshDelay
    this.tasksFolder = settings?.tasksFolder || DEFAULT_SETTINGS.tasksFolder
    this.logsNotesTypes = settings?.logsNotesTypes || [...DEFAULT_SETTINGS.logsNotesTypes]
    this.tasksTimeChoices = settings?.tasksTimeChoices || [...DEFAULT_SETTINGS.tasksTimeChoices]
    this.tasksDateChoices = settings?.tasksDateChoices || [...DEFAULT_SETTINGS.tasksDateChoices]
    this.tasksRecurrenceChoices = settings?.tasksRecurrenceChoices || [
      ...DEFAULT_SETTINGS.tasksRecurrenceChoices,
    ]
    this.weekStartsOnMonday = settings?.weekStartsOnMonday ?? DEFAULT_SETTINGS.weekStartsOnMonday
    this.taskLabelProperty =
      settings?.taskLabelProperty?.trim() || DEFAULT_SETTINGS.taskLabelProperty
    // Cleaned on the way in: the file can be edited by hand, and a colour the kit has no class
    // for would render as nothing. Grey is the absence of a colour, so it is not stored.
    this.taskLabelColors = (settings?.taskLabelColors ?? [])
      .filter((c) => typeof c?.value === 'string' && c.value.trim() && isKitColor(c.color))
      .filter((c) => c.color !== 'grey')
      .map((c) => ({ value: c.value.trim(), color: c.color }))
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
    let migrated = migrateAgents(this.ai)
    // Settings used to save every default tool description, and a saved one replaces the
    // tool's own — so a vault stayed on the descriptions of the version that first saved it.
    // Only the ones the person changed are kept; the rest go, once, and the file is rewritten.
    const descriptions = pruneToolDescriptions(this.ai.prompts?.toolDescriptions, toolDefaults)
    if (descriptions.dropped > 0 && this.ai.prompts) {
      this.ai = {
        ...this.ai,
        prompts: { ...this.ai.prompts, toolDescriptions: descriptions.kept },
      }
      migrated = true
    }
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
    this.fireflyToken = settings?.fireflyToken ?? DEFAULT_SETTINGS.fireflyToken ?? ''
    notePlainSecrets(this)
    this.accountsList = normalizeAccountsList(settings?.accountsList)
    this.timeEntryPathTemplate =
      settings?.timeEntryPathTemplate ?? DEFAULT_SETTINGS.timeEntryPathTemplate
    this.timeTrackableNoteTypes = settings?.timeTrackableNoteTypes || [
      ...DEFAULT_SETTINGS.timeTrackableNoteTypes,
    ]
    this.timeTrackAllNotes = settings?.timeTrackAllNotes ?? DEFAULT_SETTINGS.timeTrackAllNotes
    this.links = (settings?.links || []).map(normalizeLink)
    this.headerButtons = (settings?.headerButtons || []).map(normalizeHeaderButton)
    this.automations = (Array.isArray(settings?.automations) ? settings.automations : []).map(
      (rule) => normalizeRule(rule)
    )
    this.mapCoordinatesProperty =
      settings?.mapCoordinatesProperty ?? DEFAULT_SETTINGS.mapCoordinatesProperty
    this.mapStyleUrl = settings?.mapStyleUrl ?? DEFAULT_SETTINGS.mapStyleUrl
    this.snippetsFolder = settings?.snippetsFolder ?? DEFAULT_SETTINGS.snippetsFolder
    this.fullWidthSidebars = settings?.fullWidthSidebars ?? DEFAULT_SETTINGS.fullWidthSidebars
    this.halfWidthSidebarsOnTablet =
      settings?.halfWidthSidebarsOnTablet ?? DEFAULT_SETTINGS.halfWidthSidebarsOnTablet
    this.mermaidViewer = settings?.mermaidViewer ?? DEFAULT_SETTINGS.mermaidViewer ?? true
    this.propertyWidgets = settings?.propertyWidgets ?? DEFAULT_SETTINGS.propertyWidgets ?? true
    this.keyboardDiagnostics = settings?.keyboardDiagnostics ?? false
    this.github = githubSettingsFrom(settings?.github)
    this.reader = readerSettingsFrom(settings?.reader)
    this.calendars = calendarSettingsFrom(settings?.calendars)
    this.quickButton = quickButtonSettingsFrom(settings?.quickButton)
    this.secretStore = settings?.secretStore

    return migrated
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
      taskLabelProperty: this.taskLabelProperty,
      taskLabelColors: this.taskLabelColors.map((c) => ({ ...c })),
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
      ...(this.fireflyToken ? { fireflyToken: this.fireflyToken } : {}),
      accountsList: { ...this.accountsList, types: [...this.accountsList.types] },
      timeEntryPathTemplate: this.timeEntryPathTemplate,
      timeTrackableNoteTypes: [...this.timeTrackableNoteTypes],
      timeTrackAllNotes: this.timeTrackAllNotes,
      links: [...this.links],
      headerButtons: [...this.headerButtons],
      automations: this.automations.map((rule) => ({
        ...rule,
        noteTypes: [...rule.noteTypes],
        folders: [...rule.folders],
        params: { ...rule.params },
      })),
      mapCoordinatesProperty: this.mapCoordinatesProperty,
      mapStyleUrl: this.mapStyleUrl,
      snippetsFolder: this.snippetsFolder,
      fullWidthSidebars: this.fullWidthSidebars,
      halfWidthSidebarsOnTablet: this.halfWidthSidebarsOnTablet,
      mermaidViewer: this.mermaidViewer,
      propertyWidgets: this.propertyWidgets,
      keyboardDiagnostics: this.keyboardDiagnostics,
      github: { ...this.github },
      reader: { ...this.reader },
      calendars: {
        ...this.calendars,
        feeds: this.calendars.feeds.map((feed) => ({ ...feed })),
      },
      quickButton: {
        ...this.quickButton,
        actions: this.quickButton.actions.map((action) => ({ ...action })),
      },
      ...(this.secretStore ? { secretStore: this.secretStore } : {}),
    }
  }
}

/**
 * What each tool says of itself, for telling a saved copy of it from an override. Loaded when
 * the settings are, not imported: the tools import these settings, and building them costs
 * nothing that must not happen before the settings exist. Nothing is lost if it fails — the
 * shipped defaults are still recognised.
 */
async function codeToolDescriptions(): Promise<Record<string, string>> {
  try {
    const tools = await import('@/ai/tools')
    return tools.codeToolDescriptions()
  } catch (err) {
    console.debug('[Abele] tool descriptions unavailable while loading settings', err)
    return {}
  }
}
