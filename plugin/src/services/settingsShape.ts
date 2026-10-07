import { AiSettings, DEFAULT_AI_SETTINGS } from '@/ai/types'
import { type AutomationRule } from '@/automations/types'
import { DEFAULT_LIFE_YEARS } from '@/bases/lifeWeeks'
import { type CompletionMarks } from '@/calendars/completion'
import { DEFAULT_CALENDAR_SETTINGS, type CalendarSettings } from '@/calendars/settings'
import { JournalDTO } from '@/entities/Journal'
import { DEFAULT_GITHUB_SETTINGS, type GithubSettings } from '@/github/settings'
import { DEFAULT_ACCOUNTS_LIST, type AccountsListSettings } from '@/helpers/accountRows'
import { DEFAULT_LABEL_PROPERTY, type LabelColor } from '@/helpers/taskMeta'
import { DEFAULT_LINTER_SETTINGS, type LinterSettings } from '@/linter/settings'
import { DEFAULT_QUICK_BUTTON, type QuickButtonSettings } from '@/quickButton/settings'
import { DEFAULT_READER_SETTINGS, type ReaderSettings } from '@/reader/settings'
import { defaultSyncSettings, type SyncSettings } from '@/sync/settings'
import { nanoid } from 'nanoid'

export interface AbeleSettings {
  refreshDelay: number // in milliseconds
  tasksFolder?: string // Optional folder path for tasks
  logsNotesTypes?: string[] // Optional array of note types to consider as log notes
  tasksTimeChoices?: string[] // Optional array of time choices for tasks
  tasksDateChoices?: string[] // Optional array of date choices for tasks
  tasksRecurrenceChoices?: string[] // Optional array of recurrence choices for tasks
  weekStartsOnMonday?: boolean // Optional setting for week start day
  /** The person's birth date, `YYYY-MM-DD`, for the calendar's life in weeks; empty when unset. */
  birthDate?: string
  /** The years the life in weeks is drawn to. */
  lifeExpectancy?: number
  /** Frontmatter property a task's labels are read from. */
  taskLabelProperty?: string
  /** Frontmatter property used for task priority, independent of widget property lists. */
  taskPriorityProperty?: string
  /** A colour per label value. A label with no entry here is grey. */
  taskLabelColors?: LabelColor[]
  journals?: JournalDTO[]
  busyDayThreshold?: number // Optional threshold for busy day
  excludedPathsForDefaultTemplate?: string[] // Paths where default template should not apply
  // AI Agent settings
  ai?: AiSettings
  // Device sync: only what every device on the vault shares. Where this device syncs and what
  // it takes is in the vault's local storage (`src/sync/connection.ts`), not here.
  sync?: SyncSettings
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
  /** Newly opened .canvas leaves use the read-only explanatory viewer. */
  canvasViewer?: boolean
  /** Fill fenced-code language gaps in Source and Live Preview using Obsidian's Prism. */
  editorSyntaxHighlight?: boolean
  /**
   * The plugin's own drawing of some properties: a wallet's balance, arithmetic in numbers, file
   * cards for File and Files properties and for `cover`. Off is Obsidian's own drawing.
   */
  propertyWidgets?: boolean
  /**
   * Notes open where they were last left — scroll and cursor, saved on each device — unless
   * they are opened at a place of their own: a heading, a search result, a book's highlight.
   */
  rememberNotePlaces?: boolean
  /** Property names drawn as a counter: the number with − and + beside it. Empty counts as 0. */
  counterProperties?: string[]
  /** Property names drawn as a date: a day back and on, how far away, its daily note. */
  dateProperties?: string[]
  /** Property names drawn as a task priority, raised and lowered. */
  priorityProperties?: string[]
  /** Property names drawn as labels: pills, and a field adding one from those the vault uses. */
  labelProperties?: string[]
  /** Property names drawn as groups: link pills, and a field adding a group note. */
  groupProperties?: string[]
  /**
   * A panel at the top of the screen showing what the page reports about the on-screen
   * keyboard. For finding out from a phone what no emulator shows. Not carried by a settings
   * transfer, but it is in `data.json`, so a sync of the settings file takes it along.
   */
  keyboardDiagnostics?: boolean
  // GitHub links opened inside Obsidian
  github?: GithubSettings
  // The book reader: page layout, text and colours
  reader?: ReaderSettings
  /** External calendars shown beside the tasks, read only. Their links and passwords are keys. */
  calendars?: CalendarSettings
  /** Owner completion of single external event occurrences; travels with calendars. */
  calendarCompletion?: CompletionMarks
  /** The floating button on a phone and the menu it opens. */
  quickButton?: QuickButtonSettings
  /** The linter: folders it never looks in, and how each rule is set up. */
  linter?: LinterSettings
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
 * A button placed in the header of every note of a given type, running a script or any command.
 *
 * A script button sits in the plugin's own header inside the note and can hand the script
 * parameters. A command button sits among the icons at the top right of the note — Obsidian's
 * own header — and runs any command Obsidian knows: core, another plugin's, the plugin's own,
 * or a script's, which is a command too.
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
  /** What pressing it does. Absent means `script`, what every button did before commands. */
  runs?: 'script' | 'command'
  scriptName: string
  /** The command a `command` button runs, by its id: `editor:toggle-bold`. */
  commandId?: string
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
  /** Tags whose notes show the button, nested ones under them included, with or without `#`. */
  tags?: string[]
  /**
   * A command button on files other than notes too — a PDF, a canvas, a book, an image — as long
   * as its folders or tags let them; a note's type and properties they do not have.
   */
  otherFiles?: boolean
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
    runs: raw.runs === 'command' ? 'command' : 'script',
    scriptName: raw.scriptName ?? '',
    commandId: typeof raw.commandId === 'string' ? raw.commandId : '',
    icon: raw.icon || 'play',
    noteTypes: raw.noteTypes || [],
    params: raw.params || {},
    enabled: raw.enabled ?? true,
    iconOnly: raw.iconOnly ?? false,
    allNotes: raw.allNotes ?? false,
    folders: raw.folders || [],
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t) => typeof t === 'string') : [],
    otherFiles: raw.otherFiles === true,
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
  birthDate: '',
  lifeExpectancy: DEFAULT_LIFE_YEARS,
  taskLabelProperty: DEFAULT_LABEL_PROPERTY,
  taskPriorityProperty: 'priority',
  taskLabelColors: [],
  journals: [],
  busyDayThreshold: 3,
  excludedPathsForDefaultTemplate: ['attachments/', 'templates/'],
  ai: { ...DEFAULT_AI_SETTINGS },
  sync: defaultSyncSettings(),
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
  canvasViewer: true,
  editorSyntaxHighlight: true,
  propertyWidgets: true,
  rememberNotePlaces: true,
  counterProperties: [],
  dateProperties: ['date', 'due'],
  priorityProperties: ['priority'],
  labelProperties: ['labels'],
  groupProperties: ['groups'],
  keyboardDiagnostics: false,
  github: { ...DEFAULT_GITHUB_SETTINGS },
  reader: { ...DEFAULT_READER_SETTINGS },
  calendars: { ...DEFAULT_CALENDAR_SETTINGS, feeds: [] },
  calendarCompletion: {},
  quickButton: { ...DEFAULT_QUICK_BUTTON },
  linter: { ...DEFAULT_LINTER_SETTINGS, rules: {} },
}
