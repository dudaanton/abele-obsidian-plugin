import { ref } from 'vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { SettingsEdits } from './settingsEdits'
import type { CalendarSettings } from '@/calendars/settings'
import type { CompletionMarks } from '@/calendars/completion'
import type { QuickButtonSettings } from '@/quickButton/settings'
import type { LinterSettings } from '@/linter/settings'
import type { Journal } from '@/entities/Journal'
import type { AiSettings, AiChatHistoryEntry } from '@/ai/types'
import type { AccountsListSettings } from '@/helpers/accountRows'
import type { SyncSettings } from '@/sync/settings'
import AbelePlugin from '@/main'
import type { LabelColor } from '@/helpers/taskMeta'
import type { GithubSettings } from '@/github/settings'
import type { ReaderSettings } from '@/reader/settings'
import type { AutomationRule } from '@/automations/types'
import { moveLegacySecrets } from '@/secrets/legacy'
import { applySettingsTo, exportSettingsOf } from './settingsApply'
import { ChatIndexKeeper } from './chatIndexKeeper'
import { SettingsKeeper } from './settingsKeeper'
import type { AbeleSettings, HeaderButtonDefinition, LinkDefinition } from './settingsShape'

export {
  DEFAULT_SETTINGS,
  normalizeConditions,
  PROPERTY_TESTS,
  type AbeleSettings,
  type HeaderButtonCondition,
  type HeaderButtonDefinition,
  type LinkDefinition,
  type PropertyTest,
} from './settingsShape'

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
  public birthDate: string
  public lifeExpectancy: number
  public taskLabelProperty: string
  public taskPriorityProperty: string
  public taskLabelColors: LabelColor[]
  public busyDayThreshold: number
  public excludedPathsForDefaultTemplate: string[]

  public journals: Journal[]
  public ai: AiSettings
  public sync: SyncSettings
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
  public canvasViewer: boolean
  public editorSyntaxHighlight: boolean
  public propertyWidgets: boolean
  public rememberNotePlaces: boolean
  public counterProperties: string[] = []
  public dateProperties: string[] = []
  public priorityProperties: string[] = []
  public labelProperties: string[] = []
  public groupProperties: string[] = []
  public keyboardDiagnostics: boolean
  public github: GithubSettings
  public reader: ReaderSettings
  public calendars: CalendarSettings = calendarSettingsFrom()
  public calendarCompletion: CompletionMarks = {}
  public quickButton: QuickButtonSettings
  public linter: LinterSettings = linterSettingsFrom()
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

  /** Where the chat index is kept: its own file, or `data.json` until that file holds it. */
  private readonly chatIndex = new ChatIndexKeeper()

  /** The settings file itself: every load, reload and write of it, one at a time. */
  private readonly file = new SettingsKeeper({
    plugin: () => this.plugin,
    edits: this.pendingEdits,
    fresh: (fresh) => { this.freshInstall = fresh },
    apply: (settings, toolDefaults, index) => this.applySettings(settings, toolDefaults, index),
    export: () => this.exportSettings(),
    secretStore: () => this.secretStore,
    chatHistory: () => this.ai?.chatHistory ?? [],
    index: this.chatIndex,
    reloaded: () => {
      this.version.value++
      this.tellSaved()
    },
  })

  /**
   * Whether the settings file exists and could not be read. Anything that acts on its own —
   * automations — waits while it is: at startup what is in memory then is defaults, not the
   * person's, and after a reload it is settings the file on disk no longer says.
   */
  get settingsUnreadable(): boolean {
    return this.file.isUnreadable
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

  /**
   * Called after every settings save, and after every reload from disk.
   *
   * A reload is told too because to a listener it is the same event: the settings in memory are
   * not the ones it last read. The sync service built on a server and a pause that another
   * device's `data.json` just replaced would otherwise run on them until some unrelated save.
   *
   * A listener set rather than an import: the sync service reads and writes these settings, and
   * a call the other way would make the two modules import each other.
   */
  private readonly savedListeners = new Set<() => void>()

  private constructor() {}

  public static getInstance(): AbeleConfig {
    if (!AbeleConfig.instance) {
      AbeleConfig.instance = new AbeleConfig()
    }
    return AbeleConfig.instance
  }

  private pendingEdits = new SettingsEdits()

  /** Apply a screen's edit now, remembering only the fields it actually changed. */
  editSettings(apply: () => void): void {
    // Before initialization there is no incoming settings file to reconcile against.
    if (!this.plugin) {
      apply()
      return
    }
    const before = settingsSnapshot(this.exportSettings())
    apply()
    this.pendingEdits.record(before, settingsSnapshot(this.exportSettings()))
  }

  public init(plugin: AbelePlugin): void {
    this.pendingEdits = new SettingsEdits()
    this.plugin = plugin
    this.file.reset()
    this.chatIndex.reset()
  }

  public destroy(): void {
    this.pendingEdits = new SettingsEdits()
    this.plugin = null
  }

  /**
   * Told whenever the settings have been written or reloaded from disk. The returned function
   * unsubscribes.
   */
  public onSaved(cb: () => void): () => void {
    this.savedListeners.add(cb)
    return () => {
      this.savedListeners.delete(cb)
    }
  }

  loadSettings(): Promise<void> {
    if (!this.plugin) {
      throw new Error('AbeleConfig not initialized with plugin instance.')
    }
    return this.file.load()
  }

  /**
   * `data.json` changed on disk without this copy of the plugin writing it: takes it in. Answers
   * whether anything was reloaded — see `SettingsKeeper.reload`.
   */
  reloadSettings(): Promise<boolean> {
    return this.file.reload()
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
    if (this.plugin === plugin) {
      GlobalStore.getInstance().applySettings()
      plugin.syncAiFeatures()
    }


    this.tellSaved()
  }

  private tellSaved(): void {
    for (const cb of [...this.savedListeners]) {
      try {
        cb()
      } catch (error) {
        console.debug('[AbeleConfig] a settings listener threw', error)
      }
    }
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
   * The `sync` block the startup load read off disk, handed over once — or null when there was
   * no file to read it from: see `SettingsKeeper.loadedSync`.
   */
  takeLoadedSync(): { sync: unknown } | null {
    return this.file.takeLoadedSync()
  }

  /**
   * Writes the file again as the settings in memory have it, and does nothing else — for a
   * startup step that moved something out of it, the way `moveLegacySecrets` does.
   */
  async rewrite(): Promise<void> {
    await this.writeSettings()
  }

  /**
   * Writes the chat index (`ai.chatHistory`) to its own file — `ChatStorage` calls this, not
   * `saveSettings`, whenever a chat comes, goes or changes. One write at a time, and none when
   * the index is what the file already holds.
   *
   * With no file to write to (a plugin with no vault, in tests) or a disk that refused it, the
   * index goes into `data.json` instead, as it did before it had a file: a chat is never left
   * listed nowhere.
   */
  async saveChatIndex(): Promise<void> {
    if (this.chatIndex.blocked) return
    const written = await this.chatIndex.toFile(
      () => this.plugin,
      () => this.ai?.chatHistory ?? []
    )
    if (!written) await this.writeSettings()
  }

  /**
   * The write on its own, without the feature sync, after every load, reload and write already
   * asked for.
   */
  private writeSettings(): Promise<void> {
    return this.file.write()
  }

  /**
   * Returns whether a migration rewrote anything, so the caller knows to persist it.
   *
   * `toolDefaults` is what each tool says of itself now; a saved description equal to it is
   * dropped with the shipped defaults. Without it only the shipped defaults are recognised.
   */
  applySettings(
    settings?: AbeleSettings,
    toolDefaults: Record<string, string> = {},
    index: AiChatHistoryEntry[] = this.ai?.chatHistory ?? []
  ): boolean {
    const applied = applySettingsTo(this, settings, toolDefaults, index)
    this.chatIndex.inSettings = applied.indexInSettings
    return applied.migrated
  }

  exportSettings(): AbeleSettings {
    return exportSettingsOf(this, this.chatIndex.outOfSettings)
  }
}
