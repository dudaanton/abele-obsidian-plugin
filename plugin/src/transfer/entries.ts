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
import { githubSettingsFrom } from '@/github/settings'
import { projectLegacy, validConnectionServer, type GithubConnection } from '@/github/connections'
import { endpoints } from '@/github/urls'
import type { AiSettings } from '@/ai/types'
import { savedKeysWithIds } from '@/ai/savedKeyIds'
import { DEFAULT_TRANSCRIPTION } from '@/ai/transcription'
import { pruneToolDescriptions } from '@/ai/tools/toolDescriptionOverrides'
import { FIREFLY_TOKEN_KEY_ID } from '@/secrets/legacy'
import {
  FILE_SECTION_LABELS,
  isFileSection,
  type SectionId,
  type TransferEntry,
  type TransferPayload,
} from './types'

interface Identified {
  id?: string
  name?: string
  keyId?: string
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
    keys
      .filter((key) => Object.hasOwn(source, key) && source[key] !== undefined)
      .map((key) => [key, source[key]])
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
    settings.ai = { ...ai(settings), ...pick(data, keys) }
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
  write: (settings, data) => Object.assign(settings, pick(data, keys)),
  ...extra,
})

/**
 * Everything on offer, in the order the screen shows it.
 *
 * `ai.chatHistory` is deliberately absent: it is a list of paths into the vault it was made
 * in, meaningless in the vault it would arrive at, and the longest thing in the settings.
 */
export const SECTIONS: Section[] = [
  aiBlock(
    'ai-general',
    'AI general',
    [
      'enabled',
      'activeProviderId',
      'activeModelId',
      'auxiliaryModelId',
      'wiseModelId',
      'sequentialAuxiliary',
      'autoRetry',
      'permissionMode',
      'toolModes',
      'defaultScope',
      'defaultFullVaultAccess',
      'chatFolder',
      'rewindLimitMb',
      'commentAgentId',
      'commentFolder',
      'skillsFolder',
      'braveSearchApiKey',
      'defaultImageModel',
      'systemPrompt',
      'systemPromptFromNote',
      'systemPromptNotePath',
      'defaultAgentId',
      'allowWebSearch',
      'allowFetch',
      'allowWiseModel',
    ],
    {
      // The setting holds the *name* of the key, not the key: without this the other device
      // gets a name pointing at an empty slot in its own keychain.
      secretsOf: (settings) => {
        const id = ai(settings).braveSearchApiKey
        return id ? [id] : []
      },
    }
  ),
  aiBlock('ai-voice', 'Voice input', ['voice'], {
    secretsOf: (settings) => [ai(settings).voice?.apiKeyId || DEFAULT_TRANSCRIPTION.apiKeyId],
  }),
  aiList('ai-providers', 'AI providers', 'providers', (p: Identified & { apiKeyId?: string }) =>
    p.apiKeyId ? [p.apiKeyId] : []
  ),
  aiList(
    'ai-image-providers',
    'Image providers',
    'imageProviders',
    (p: Identified & { apiKeyId?: string }) => (p.apiKeyId ? [p.apiKeyId] : [])
  ),
  // Whole agent definitions travel, including interceptorReplyOnly and the other review settings.
  aiList('ai-agents', 'Agents', 'agents'),
  // Each server travels with the tools it was last seen offering, so the other device tells
  // its agents the same thing without fetching first. There is no command to carry: servers are
  // only ever reached over HTTP. The token is in the keychain; the setting names it.
  aiList('ai-mcp-servers', 'MCP servers', 'mcpServers', (s: Identified & { keyId?: string }) =>
    s.keyId ? [s.keyId] : []
  ),
  aiList('ai-interceptors', 'Interceptors', 'interceptors'),
  {
    ...aiList('ai-secrets', 'Stored keys', 'secrets', (s: Identified & { keyId?: string }) =>
      s.keyId ? [s.keyId] : []
    ),
    read: (settings) => savedKeysWithIds(ai(settings).secrets ?? []),
  },
  // Tool descriptions travel as overrides only: a default carried over would pin the other
  // device to this version's wording, the way saved defaults once pinned every vault.
  aiBlock('ai-prompts', 'Prompts', ['prompts'], {
    read: (settings) => {
      const prompts = ai(settings).prompts
      if (!prompts) return {}
      const { kept } = pruneToolDescriptions(prompts.toolDescriptions)
      return { prompts: { ...prompts, toolDescriptions: kept } }
    },
  }),
  aiBlock('scripts', 'Script settings', [
    'scriptsEnabled',
    'scriptsFolder',
    'toolbarScripts',
    'startupScripts',
    'startupScriptsPaused',
    // Arms the device it arrives on, unless that device was switched off by hand; see
    // `ScriptTrust.ts`. What was confirmed stays on each device and does not travel.
    'confirmForeignScripts',
  ]),
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
    id: 'automations',
    label: 'Automations',
    read: (settings) => settings.automations ?? [],
    write: (settings, items) => {
      settings.automations = items as AbeleSettings['automations']
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
    'birthDate',
    'lifeExpectancy',
    'busyDayThreshold',
    'taskLabelProperty',
    'taskLabelColors',
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
      'accountsList',
    ],
    // The Firefly token is in the keychain; it rides along only when keys are sent. A plain
    // one left in an old settings file is moved there at the next save and never sent.
    { secretsOf: () => [FIREFLY_TOKEN_KEY_ID] }
  ),
  rootBlock('time-tracking', 'Time tracking', [
    'timeEntryPathTemplate',
    'timeTrackableNoteTypes',
    'timeTrackAllNotes',
  ]),
  rootBlock('maps', 'Maps', ['mapCoordinatesProperty', 'mapStyleUrl']),
  rootBlock('github', 'GitHub', ['github'], {
    // Compatibility fields are never offered here: otherwise choosing this block alone leaks
    // an unselected connection's key through the old keyId alias.
    read: (settings) => {
      if (!settings.github) return {}
      const {
        connections: _connections,
        keyId: _keyId,
        server: _server,
        legacyServer: _legacyServer,
        ...general
      } = settings.github
      return { github: general }
    },
    write: (settings, data) => {
      const incoming = data.github as Partial<NonNullable<AbeleSettings['github']>> | undefined
      if (!incoming) return
      if (
        (incoming.server !== undefined &&
          (typeof incoming.server !== 'string' ||
            (incoming.server.trim() && !validConnectionServer(incoming.server.trim())))) ||
        (incoming.notifications?.boundServer !== undefined &&
          (typeof incoming.notifications.boundServer !== 'string' ||
            (incoming.notifications.boundServer.trim() &&
              !validConnectionServer(incoming.notifications.boundServer.trim()))))
      ) {
        throw new Error('Invalid GitHub connection server in this transfer.')
      }
      const current = githubSettingsFrom(settings.github)
      if (
        incoming.keyId &&
        current.connections.some(
          (c) =>
            c.keyId === incoming.keyId &&
            endpoints(c.server).origin !== endpoints(incoming.server ?? '').origin
        )
      ) {
        throw new Error(
          'This legacy GitHub token slot already belongs to another server. Transfer connections from a current plugin version instead.'
        )
      }
      // A transfer made by an older version carries the main credential in its GitHub block.
      // Never replace an already imported connection list with stale compatibility fields.
      const hasList = Array.isArray(incoming.connections)
      const connections =
        current.connections.length || (!incoming.keyId && !incoming.server)
          ? current.connections
          : githubSettingsFrom(incoming).connections
      settings.github = projectLegacy(
        githubSettingsFrom({
          ...current,
          ...incoming,
          connections:
            hasList && !current.connections.length
              ? githubSettingsFrom(incoming).connections
              : connections,
        })
      )
    },
    secretsOf: (settings) => {
      const id = settings.github?.notifications?.boundKeyId ?? settings.github?.notifications?.keyId
      return id ? [id] : []
    },
  }),
  {
    kind: 'list',
    id: 'github-connections',
    label: 'GitHub connections',
    read: (settings) =>
      settings.github?.connections ??
      (settings.github ? githubSettingsFrom(settings.github).connections : []),
    write: (settings, items) => {
      // A partial batch must not invent a default that overrides a later arriving default.
      settings.github = {
        ...(settings.github ?? githubSettingsFrom()),
        connections: items as GithubConnection[],
      }
    },
    secretsOf: (item) =>
      (item as GithubConnection).keyId ? [(item as GithubConnection).keyId] : [],
  },
  rootBlock('calendars', 'Calendars', ['calendars'], {
    // Each calendar's link or password is in the keychain; the settings hold only where.
    secretsOf: (settings) =>
      (settings.calendars?.feeds ?? []).map((feed) => feed.keyId).filter(Boolean),
  }),
  // Whole, so the scripts chosen for words selected in a book (`selectionScripts`) go with it.
  rootBlock('reader', 'Book reader', ['reader']),
  rootBlock('quick-button', 'Quick button', ['quickButton']),
  // Whole: the folders it skips and every rule's setup, script rules included by their names.
  rootBlock('linter', 'Linter', ['linter']),
  rootBlock('other', 'Other', [
    'refreshDelay',
    'logsNotesTypes',
    'excludedPathsForDefaultTemplate',
    'snippetsFolder',
    'fullWidthSidebars',
    'halfWidthSidebarsOnTablet',
    'mermaidViewer',
    'propertyWidgets',
    'rememberNotePlaces',
    'counterProperties',
    'dateProperties',
    'priorityProperties',
    'labelProperties',
    'groupProperties',
  ]),
]

const sectionById = new Map(SECTIONS.map((section) => [section.id, section]))

// Named keys have no separate item id: their slot is their identity across devices.
const itemId = (section: SectionId, item: Identified): string =>
  (section === 'ai-secrets' ? item.keyId : item.id) ?? ''

/** Only references in the accepted settings can authorize a keychain write.
 * The sender's secretIds are display/export metadata, never write authority.
 */
export function arrivingSecretIds(
  entries: TransferEntry[],
  applied: AbeleSettings = applyEntries(entries, { ai: {} } as AbeleSettings)
): string[] {
  const ids = new Set<string>()
  for (const entry of settingsToApply(entries)) {
    const section = sectionById.get(entry.section)
    if (!section?.secretsOf) continue
    let references: string[]
    if (section.kind === 'list') {
      // Duplicated ids and connection normalization can replace or discard an earlier row.
      const id = itemId(section.id, entry.data as Identified)
      const item = section.read(applied).find((item) => itemId(section.id, item) === id)
      references = item ? section.secretsOf(item) : []
    } else {
      // A sparse destination ensures an omitted field cannot select an existing local key.
      const incoming = { ai: {} } as AbeleSettings
      section.write(incoming, entry.data as Record<string, unknown>)
      // Fixed/default slots belong to an actual incoming block, not an empty entry or
      // foreign fields which the section refused to write.
      if (!Object.keys(section.read(incoming)).length) continue
      references = section.secretsOf(incoming)
      const appliedReferences = section.secretsOf(applied)
      // Legacy-only blocks may migrate connections. Both sides use the normalized rows,
      // never a raw alias that a modern connection list or existing local list discarded.
      if (entry.section === 'github') {
        references.push(...(incoming.github?.connections ?? []).map((c) => c.keyId))
        appliedReferences.push(...(applied.github?.connections ?? []).map((c) => c.keyId))
      }
      references = references.filter((id) => appliedReferences.includes(id))
    }
    for (const id of references) {
      if (typeof id === 'string' && id && !id.startsWith('abele-store-')) ids.add(id)
    }
  }
  return [...ids]
}

export const sectionLabel = (id: SectionId): string =>
  sectionById.get(id)?.label ?? FILE_SECTION_LABELS[id as keyof typeof FILE_SECTION_LABELS] ?? id

/** The settings half of a mixed list; the files are planned and written by `files.ts`. */
export const settingsOnly = (entries: TransferEntry[]): TransferEntry[] =>
  entries.filter((entry) => !isFileSection(entry.section))

export const filesOnly = (entries: TransferEntry[]): TransferEntry[] =>
  entries.filter((entry) => isFileSection(entry.section))

/** Everything the settings hold that could be sent. An empty section offers nothing. */
export function collectEntries(settings: AbeleSettings): TransferEntry[] {
  return SECTIONS.flatMap((section): TransferEntry[] => {
    if (section.kind === 'list') {
      return section.read(settings).map((item) => ({
        section: section.id,
        id: itemId(section.id, item),
        label: item.name || itemId(section.id, item),
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

/** Imported executable controls require a deliberate local enable, even when unchanged. */
function disabledOnArrival(entry: TransferEntry): TransferEntry {
  if (entry.section !== 'automations' && entry.section !== 'header-buttons') return entry
  return { ...entry, data: { ...(entry.data as Record<string, unknown>), enabled: false } }
}

export type EntryStatus = 'new' | 'replace' | 'same'

export interface PlannedEntry {
  entry: TransferEntry
  status: EntryStatus
}

export function planEntries(entries: TransferEntry[], settings: AbeleSettings): PlannedEntry[] {
  return settingsOnly(entries)
    .map(disabledOnArrival)
    .map((entry) => {
      const section = sectionById.get(entry.section)
      if (!section) return { entry, status: 'new' as const }

      const current =
        section.kind === 'list'
          ? section.read(settings).find((item) => itemId(section.id, item) === entry.id)
          : section.read(settings)

      if (!current || (section.kind === 'block' && Object.keys(current).length === 0)) {
        return { entry, status: 'new' as const }
      }

      const same = JSON.stringify(current) === JSON.stringify(entry.data)
      return { entry, status: same ? ('same' as const) : ('replace' as const) }
    })
}

/**
 * Merging adds what arrived to what is here; replacing makes what is here into what arrived.
 *
 * Replacing is per section, and only for the sections the transfer carried: a transfer of
 * providers must not empty the agents. Files are never dropped either way — see
 * `removedByReplace`.
 */
export type ApplyMode = 'merge' | 'replace'

/** What replacing would take out of this vault: local items the transfer did not carry. */
export function removedByReplace(
  entries: TransferEntry[],
  settings: AbeleSettings
): { section: SectionId; id: string; label: string }[] {
  const arriving = settingsOnly(entries)
  const sections = new Set(arriving.map((entry) => entry.section))

  return [...sections].flatMap((id) => {
    const section = sectionById.get(id)
    if (section?.kind !== 'list') return []

    const keeping = new Set(arriving.filter((e) => e.section === id).map((e) => e.id))
    return section
      .read(settings)
      .filter((item) => !keeping.has(itemId(id, item)))
      .map((item) => ({ section: id, id: itemId(id, item), label: item.name || itemId(id, item) }))
  })
}

/** The same incoming field projection governs both settings and keychain writes. */
function settingsToApply(entries: TransferEntry[]): TransferEntry[] {
  const arriving = settingsOnly(entries)
    .map(disabledOnArrival)
    .sort(
      (a, b) =>
        Number(a.section === 'github-connections') - Number(b.section === 'github-connections')
    )
  if (!arriving.some((entry) => entry.section === 'github-connections')) return arriving
  return arriving.map((entry) => {
    if (entry.section !== 'github') return entry
    const data = (entry.data as { github?: Record<string, unknown> }).github
    if (!data) return entry
    const { keyId: _keyId, server: _server, connections: _connections, ...general } = data
    return { ...entry, data: { github: general } }
  })
}

/** The settings as they would be with these entries in them. The original is left alone. */
export function applyEntries(
  entries: TransferEntry[],
  settings: AbeleSettings,
  mode: ApplyMode = 'merge'
): AbeleSettings {
  // Through JSON rather than `structuredClone`: the live settings are observed by the app, so
  // their arrays are reactive proxies, and cloning one of those throws `DataCloneError`. These
  // settings are JSON on disk anyway, so nothing survives the trip that was not already there.
  const next = JSON.parse(JSON.stringify(settings)) as AbeleSettings

  const arriving = settingsToApply(entries)
  for (const entry of arriving) {
    if (entry.section !== 'github-connections') continue
    const c = entry.data as Partial<GithubConnection> | null
    if (
      !c ||
      typeof c.id !== 'string' ||
      c.id !== entry.id ||
      !c.id ||
      typeof c.name !== 'string' ||
      typeof c.keyId !== 'string' ||
      typeof c.server !== 'string' ||
      (c.server.trim() && !validConnectionServer(c.server.trim())) ||
      entry.secretIds?.some((id) => id !== c.keyId)
    ) {
      throw new Error(
        'Invalid GitHub connection in this transfer. Check its name, server and credential reference.'
      )
    }
  }

  if (mode === 'replace') {
    // Emptied first, then filled by the loop below: doing it in one pass would drop items the
    // transfer is about to put back, in an order nobody asked for.
    for (const id of new Set(arriving.map((entry) => entry.section))) {
      const section = sectionById.get(id)
      if (section?.kind === 'list') section.write(next, [])
    }
  }

  for (const entry of arriving) {
    const section = sectionById.get(entry.section)
    if (!section) continue

    if (section.kind === 'block') {
      section.write(next, entry.data as Record<string, unknown>)
      continue
    }

    const items = [...section.read(next)]
    const item = entry.data as Identified
    const at = items.findIndex(
      (existing) => itemId(section.id, existing) === itemId(section.id, item)
    )
    if (at === -1) items.push(item)
    else items[at] = item
    section.write(next, items)
  }

  if (arriving.some((e) => e.section === 'github' || e.section === 'github-connections')) {
    const github = githubSettingsFrom(next.github)
    next.github = github
    const owners = new Map<string, string>()
    const bind = (keyId: string | undefined, server: string) => {
      if (!keyId) return
      const origin = endpoints(server).origin
      const previous = owners.get(keyId)
      if (previous && previous !== origin)
        throw new Error(
          'A GitHub credential reference cannot belong to different servers. Give each connection its own keychain slot.'
        )
      owners.set(keyId, origin)
    }
    const bindSettings = (value: ReturnType<typeof githubSettingsFrom>) => {
      for (const connection of value.connections) bind(connection.keyId, connection.server)
      bind(
        value.notifications.boundKeyId ?? value.notifications.keyId,
        value.notifications.boundServer ?? value.server
      )
    }
    // A transfer without keys leaves local/synced secrets in their slots. Validate against
    // the pre-transfer bindings too: replacing a row (or a whole section) cannot erase the
    // evidence that an existing slot belongs to a different server. A new server needs a
    // distinct slot, even if its connection was independently migrated with the same ID.
    bindSettings(githubSettingsFrom(settings.github))
    bindSettings(github)
  }
  return next
}
