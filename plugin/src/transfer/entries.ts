/**
 * The settings, as a list of things that can travel one at a time.
 *
 * A section is either a list — providers, agents, links, each item its own entry — or a block
 * of settings with no parts worth choosing between, which travels whole. Both end up as the
 * same `TransferEntry`, so the screen that ticks them and the screen that applies them each
 * have one kind of thing to deal with.
 *
 * Everything here works on a plain `AbeleSettings` and returns a new one. The keychain and
 * the plugin's save are the caller's business — which is what makes the rules about what may
 * be overwritten testable without an Obsidian to run them in.
 */
import type { AbeleSettings } from '@/services/AbeleConfig'
import type { AiSettings } from '@/ai/types'
import type { SectionId, TransferEntry, TransferPayload } from './types'

interface Identified {
  id: string
  name?: string
}

interface ListSection {
  kind: 'list'
  id: SectionId
  label: string
  read(settings: AbeleSettings): Identified[]
  write(settings: AbeleSettings, items: Identified[]): void
  secretsOf?(item: Identified): string[]
}

interface BlockSection {
  kind: 'block'
  id: SectionId
  label: string
  /** The keys this block owns, read off the settings. */
  read(settings: AbeleSettings): Record<string, unknown>
  write(settings: AbeleSettings, data: Record<string, unknown>): void
  secretsOf?(settings: AbeleSettings): string[]
  /** The block's own values include a credential, so it cannot travel in the open. */
  sensitive?: boolean
}

type Section = ListSection | BlockSection

/** The AI settings, always present in practice; absent only in a settings file from before. */
const ai = (settings: AbeleSettings): AiSettings => (settings.ai ?? {}) as AiSettings

const aiList = <T extends Identified>(
  id: SectionId,
  label: string,
  key: keyof AiSettings,
  secretsOf?: (item: T) => string[]
): ListSection => ({
  kind: 'list',
  id,
  label,
  read: (settings) => (ai(settings)[key] as T[] | undefined) ?? [],
  write: (settings, items) => {
    settings.ai = { ...ai(settings), [key]: items }
  },
  secretsOf: secretsOf,
})

const pick = (source: Record<string, unknown>, keys: string[]): Record<string, unknown> =>
  Object.fromEntries(
    keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]])
  )

const aiBlock = (
  id: SectionId,
  label: string,
  keys: string[],
  extra: Partial<BlockSection> = {}
): BlockSection => ({
  kind: 'block',
  id,
  label,
  read: (settings) => pick(ai(settings) as unknown as Record<string, unknown>, keys),
  write: (settings, data) => {
    settings.ai = { ...ai(settings), ...data }
  },
  ...extra,
})

const rootBlock = (
  id: SectionId,
  label: string,
  keys: string[],
  extra: Partial<BlockSection> = {}
): BlockSection => ({
  kind: 'block',
  id,
  label,
  read: (settings) => pick(settings as unknown as Record<string, unknown>, keys),
  write: (settings, data) => Object.assign(settings, data),
  ...extra,
})

/**
 * Everything on offer, in the order the screen shows it.
 *
 * `ai.chatHistory` is deliberately absent: it is a list of paths into the vault it was made
 * in, meaningless in the vault it would arrive at, and the longest thing in the settings.
 */
export const SECTIONS: Section[] = [
  aiBlock('ai-general', 'AI general', [
    'enabled',
    'activeProviderId',
    'activeModelId',
    'auxiliaryModelId',
    'wiseModelId',
    'sequentialAuxiliary',
    'permissionMode',
    'toolModes',
    'defaultScope',
    'defaultFullVaultAccess',
    'chatFolder',
    'braveSearchApiKey',
    'defaultImageModel',
    'systemPrompt',
    'systemPromptFromNote',
    'systemPromptNotePath',
    'defaultAgentId',
    'allowWebSearch',
    'allowFetch',
    'allowWiseModel',
  ]),
  aiList('ai-providers', 'AI providers', 'providers', (p: Identified & { apiKeyId?: string }) =>
    p.apiKeyId ? [p.apiKeyId] : []
  ),
  aiList(
    'ai-image-providers',
    'Image providers',
    'imageProviders',
    (p: Identified & { apiKeyId?: string }) => (p.apiKeyId ? [p.apiKeyId] : [])
  ),
  aiList('ai-agents', 'Agents', 'agents'),
  aiList('ai-interceptors', 'Interceptors', 'interceptors'),
  aiList('ai-secrets', 'Stored keys', 'secrets', (s: Identified & { keyId?: string }) =>
    s.keyId ? [s.keyId] : []
  ),
  aiBlock('ai-prompts', 'Prompts', ['prompts']),
  aiBlock('scripts', 'Scripts', ['scriptsEnabled', 'scriptsFolder']),
  {
    kind: 'list',
    id: 'links',
    label: 'Links',
    read: (settings) => settings.links ?? [],
    write: (settings, items) => {
      settings.links = items as AbeleSettings['links']
    },
  },
  {
    kind: 'list',
    id: 'header-buttons',
    label: 'Header buttons',
    read: (settings) => settings.headerButtons ?? [],
    write: (settings, items) => {
      settings.headerButtons = items as AbeleSettings['headerButtons']
    },
  },
  {
    kind: 'list',
    id: 'journals',
    label: 'Journals',
    read: (settings) => settings.journals ?? [],
    write: (settings, items) => {
      settings.journals = items as AbeleSettings['journals']
    },
  },
  rootBlock('tasks', 'Tasks', [
    'tasksFolder',
    'tasksTimeChoices',
    'tasksDateChoices',
    'tasksRecurrenceChoices',
    'weekStartsOnMonday',
    'busyDayThreshold',
  ]),
  rootBlock(
    'finance',
    'Finance',
    [
      'transactionPathTemplate',
      'transactionTemplatePath',
      'accountsFolder',
      'financeCategoriesFolder',
      'defaultCurrency',
      'pinnedCurrencies',
      'fireflyBaseUrl',
      'fireflyToken',
    ],
    // The Firefly token is kept in the settings themselves rather than the keychain, so this
    // block is a credential whether or not keys were asked for.
    { sensitive: true }
  ),
  rootBlock('time-tracking', 'Time tracking', [
    'timeEntryPathTemplate',
    'timeTrackableNoteTypes',
    'timeTrackAllNotes',
  ]),
  rootBlock('other', 'Other', [
    'refreshDelay',
    'logsNotesTypes',
    'excludedPathsForDefaultTemplate',
    'snippetsFolder',
    'fullWidthSidebars',
  ]),
]

const sectionById = new Map(SECTIONS.map((section) => [section.id, section]))

export const sectionLabel = (id: SectionId): string => sectionById.get(id)?.label ?? id

/** Everything the settings hold that could be sent. An empty section offers nothing. */
export function collectEntries(settings: AbeleSettings): TransferEntry[] {
  return SECTIONS.flatMap((section): TransferEntry[] => {
    if (section.kind === 'list') {
      return section.read(settings).map((item) => ({
        section: section.id,
        id: item.id,
        label: item.name || item.id,
        data: item,
        secretIds: section.secretsOf?.(item) ?? [],
      }))
    }

    const data = section.read(settings)
    if (Object.keys(data).length === 0) return []

    return [
      {
        section: section.id,
        id: section.id,
        label: section.label,
        data,
        secretIds: section.secretsOf?.(settings) ?? [],
        sensitive: section.sensitive,
      },
    ]
  })
}

/**
 * @param readSecret reads a key out of the keychain, or `null` to send none of them
 */
export function buildPayload(
  entries: TransferEntry[],
  readSecret: ((id: string) => string) | null
): TransferPayload {
  const secrets: Record<string, string> = {}

  if (readSecret) {
    for (const entry of entries) {
      for (const id of entry.secretIds ?? []) {
        const value = readSecret(id)
        // A key the keychain does not hold is one this vault never had: sending an empty
        // string would wipe the one waiting on the other side.
        if (value) secrets[id] = value
      }
    }
  }

  return { v: 1, at: new Date().toISOString(), entries, secrets }
}

/** Whether the payload holds anything that must not be readable off the screen. */
export function needsCode(payload: TransferPayload): boolean {
  return Object.keys(payload.secrets).length > 0 || payload.entries.some((entry) => entry.sensitive)
}

export type EntryStatus = 'new' | 'replace' | 'same'

export interface PlannedEntry {
  entry: TransferEntry
  status: EntryStatus
}

export function planEntries(entries: TransferEntry[], settings: AbeleSettings): PlannedEntry[] {
  return entries.map((entry) => {
    const section = sectionById.get(entry.section)
    if (!section) return { entry, status: 'new' as const }

    const current =
      section.kind === 'list'
        ? section.read(settings).find((item) => item.id === entry.id)
        : section.read(settings)

    if (!current || (section.kind === 'block' && Object.keys(current).length === 0)) {
      return { entry, status: 'new' as const }
    }

    const same = JSON.stringify(current) === JSON.stringify(entry.data)
    return { entry, status: same ? ('same' as const) : ('replace' as const) }
  })
}

/** The settings as they would be with these entries in them. The original is left alone. */
export function applyEntries(entries: TransferEntry[], settings: AbeleSettings): AbeleSettings {
  const next = structuredClone(settings)

  for (const entry of entries) {
    const section = sectionById.get(entry.section)
    if (!section) continue

    if (section.kind === 'block') {
      section.write(next, entry.data as Record<string, unknown>)
      continue
    }

    const items = [...section.read(next)]
    const item = entry.data as Identified
    const at = items.findIndex((existing) => existing.id === item.id)
    if (at === -1) items.push(item)
    else items[at] = item
    section.write(next, items)
  }

  return next
}
