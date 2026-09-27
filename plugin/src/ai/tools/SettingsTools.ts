import type { AgentTool } from '../client'
<<<<<<< HEAD
import { AbeleConfig } from '@/services/AbeleConfig'
import {
  AmbiguousItem,
  isHidden,
  itemLine,
  knownRoots,
  redact,
  resolve,
  restoreHidden,
  rootOf,
  typeOf,
} from './settingsPaths'
import {
  addItem,
  isAgent,
  moveItem,
  refuseInterceptor,
  refusePattern,
  removeItem,
  updateItem,
  type ItemResult,
} from './settingsItems'
=======
import { AbeleConfig, DEFAULT_SETTINGS } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '../types'
import { deviceValue, deviceView, deviceWarning, isDevicePath, writeDevice } from './settingsDevice'
>>>>>>> b700e6a9 (feat(sync): the settings tools reach this device's connection, and the write_settings approval shows before, after and where the token goes)

/**
 * Reading and changing the plugin's own settings, from a chat.
 *
 * Two tools rather than one, because they are two different permissions: reading what the
 * vault is configured to do is ordinary, and changing it is not. Each carries its own mode —
 * off, ask, or allowed — like every other tool, so «всё под двумя тоглами» is the tool
 * settings and not a switch of its own.
 *
 * A write is one key at a time on purpose. Handing over the whole settings object would make
 * every change a rewrite of everything, and a model that meant to move the tasks folder would
 * be one malformed object away from replacing the agents, the providers and the journals.
 *
 * The same goes for a list: `write_settings` takes an `op` that works on one item of it —
 * patch, add, remove, move — addressed by id or name, so changing one button out of forty is
 * not a rewrite of all forty. The ops live in the same tool so they live under the same mode:
 * whoever may change a setting may change one item of it, and nobody else.
 */
<<<<<<< HEAD
=======
function knownRoots(): Set<string> {
  const roots = new Set<string>(Object.keys(DEFAULT_SETTINGS))
  for (const key of Object.keys(DEFAULT_AI_SETTINGS)) roots.add(`ai.${key}`)
  return roots
}

/**
 * Settings that are nobody's business but the person's, or nobody's business at all.
 *
 * Secrets first: what is stored is a keychain id rather than a key, but an id is still the
 * handle on somebody's key and there is no reason for a model to hold one. Then the caches —
 * the chat index is hundreds of entries rebuilt from the vault, and reading it costs more than
 * every other setting put together while saying nothing about how anything is configured.
 */
const HIDDEN = [
  // The synced secret store: every key, encrypted. Not a setting, and never an agent's.
  'secretStore',
  'ai.secrets',
  'ai.chatHistory',
  'ai.braveSearchApiKey',
  'fireflyToken',
  'ai.transferKey',
]

/** Key names that hold a secret wherever they turn up, however deep. */
const SECRET_KEYS = /^(apiKeyId|keyId|apiKey|token|secret|password|secretStore)$/i

function isHidden(path: string): boolean {
  const lower = path.toLowerCase()
  // A hidden setting hides everything under it too: `secretStore.entries` is as much the
  // store as `secretStore` is.
  if (HIDDEN.some((hidden) => lower === hidden.toLowerCase())) return true
  if (HIDDEN.some((hidden) => lower.startsWith(`${hidden.toLowerCase()}.`))) return true
  return path.split('.').some((segment) => SECRET_KEYS.test(segment))
}

/** Everything a secret key holds, replaced — the shape stays, the value does not. */
function redact(value: unknown, key = ''): unknown {
  if (SECRET_KEYS.test(key)) return value ? '<hidden>' : ''
  if (Array.isArray(value)) return value.map((item) => redact(item))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [name, inner] of Object.entries(value as Record<string, unknown>)) {
      out[name] = redact(inner, name)
    }
    return out
  }
  return value
}

interface Resolved {
  /** The object the last segment lives on, so a write has somewhere to put the value. */
  parent: Record<string, unknown>
  key: string
  value: unknown
}

/**
 * Walks a dotted path from the live config: `tasksFolder`, `ai.chatFolder`,
 * `ai.agents.0.name`. Numeric segments index arrays.
 *
 * This device's sync connection is the exception: it is not on `AbeleConfig` at all, and its
 * paths are read from the connection (`settingsDevice.ts`). `sync` itself reads as both halves
 * together, what `data.json` shares and what this device keeps, so an agent sees one block.
 *
 * Against `AbeleConfig` rather than against a plain object, because that is where the settings
 * live at runtime: several of them are accessors that do work on assignment — `logsNotesTypes`
 * rebuilds the regexps it is matched with — and a write that went into a copy would be a write
 * that changed nothing until the next restart, or never.
 */
function resolve(path: string): Resolved | null {
  const segments = path.split('.').filter(Boolean)
  if (segments.length === 0) return null
  if (isDevicePath(path)) {
    return { parent: {}, key: segments[segments.length - 1], value: deviceValue(path) }
  }
  if (path === 'sync') {
    const shared = AbeleConfig.getInstance().sync as unknown as Record<string, unknown>
    return { parent: {}, key: 'sync', value: { ...shared, ...deviceView() } }
  }

  let holder: Record<string, unknown> = AbeleConfig.getInstance() as unknown as Record<
    string,
    unknown
  >

  for (const segment of segments.slice(0, -1)) {
    const next = holder[segment]
    if (!next || typeof next !== 'object') return null
    holder = next as Record<string, unknown>
  }

  const key = segments[segments.length - 1]
  return { parent: holder, key, value: holder[key] }
}

/** The type of a value as this tool talks about it, which is what a write has to match. */
function typeOf(value: unknown): string {
  if (value === null || value === undefined) return 'empty'
  if (Array.isArray(value)) return 'array'
  return typeof value
}
>>>>>>> b700e6a9 (feat(sync): the settings tools reach this device's connection, and the write_settings approval shows before, after and where the token goes)

/** One line per setting: what it is, and either its value or how much of it there is. */
function summarise(path: string): string {
  const found = resolve(path)
  if (!found) return `${path}: (not set)`

  const value = found.value
  const type = typeOf(value)

  if (type === 'array') return `${path}: array of ${(value as unknown[]).length}`
  if (type === 'object') {
    return `${path}: object with ${Object.keys(value as object).length} keys`
  }
  if (type === 'empty') return `${path}: (not set)`
  return `${path}: ${JSON.stringify(value)}`
}

/** Past this a value is a document rather than a setting, and is asked for a piece at a time. */
const MAX_VALUE_CHARS = 8000

export function createReadSettingsTool(): AgentTool {
  return {
    name: 'read_settings',
    label: 'Read settings',
    description:
      "Read the Abele plugin's own settings. With no arguments it lists every setting with " +
      'its value, or its size for a list or an object. With `path` it returns that value as ' +
      'JSON: `tasksFolder`, `ai.chatFolder`, `ai.agents.0.name`. An item of a list is named ' +
      'by its place, its id or its name: `ai.agents.Writer`, `headerButtons.<id>.icon`. A list ' +
      'too long to return whole comes back as one line per item. API keys are never returned. ' +
      'Ask `query_docs` for the `settings` section to learn what a setting does.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Dotted path to one setting. Omit for the list of all of them. In a list, a ' +
            "segment is the item's place, id or name: `ai.agents.0.name`, `ai.agents.Writer`.",
        },
      },
    },
    execute: async (_id, params) => {
      const path = typeof params.path === 'string' ? params.path.trim() : ''
      return { content: [{ type: 'text', text: answering(() => read(path)) }] }
    },
  }
}

/** A name that fits several items is said as it is, rather than as a failed call. */
function answering(run: () => string): string {
  try {
    return run()
  } catch (error) {
    if (error instanceof AmbiguousItem) return error.message
    throw error
  }
}

function read(path: string): string {
  if (!path) {
    const lines = [...knownRoots()]
      .filter((root) => !isHidden(root))
      .sort()
      .map(summarise)
    return `Abele settings (${lines.length}). Ask for one by path to see it whole.\n\n${lines.join('\n')}`
  }

  if (isHidden(path)) return `"${path}" holds a secret or a cache and is not readable.`

  if (!knownRoots().has(rootOf(path))) {
    return `No setting "${path}". Call this tool with no arguments for the ones there are.`
  }

  const found = resolve(path)
  if (!found || found.value === undefined) return `"${path}" is not set.`

  const text = JSON.stringify(redact(found.value, found.key), null, 2)
  if (text.length > MAX_VALUE_CHARS) {
    // A list says what is in it, so the one item wanted can be asked for by its id.
    if (Array.isArray(found.value)) {
      const lines = found.value.map(itemLine)
      return `"${path}" is a list of ${lines.length}, too long to return whole (${text.length} characters). Ask for one item as "${path}.<id>" or "${path}.<place>".\n\n${lines.join('\n')}`
    }
    return `"${path}" is ${typeOf(found.value)} and too long to return whole (${text.length} characters). Ask for a piece of it, such as "${path}.0".`
  }
  return `${path} (${typeOf(found.value)}):\n${text}`
}

const OPS = ['set', 'update', 'add', 'remove', 'move'] as const
type Op = (typeof OPS)[number]

export function createWriteSettingsTool(): AgentTool {
  return {
    name: 'write_settings',
    label: 'Write settings',
    description:
      "Change one of the Abele plugin's settings, or one item of a list setting. `path` names " +
      'it; an item of a list is named by its place, its id or its name: ' +
      '`headerButtons.<id>`, `ai.agents.Writer`. `op` says what to do: `set` (default) ' +
      'replaces the value with `value` — one setting per call, which must already exist and ' +
      'keep its type; `update` merges `value`, a JSON object of just the fields to change, ' +
      'into the object at `path` (nested objects merge, `null` removes a field); `add` puts ' +
      '`value` into the list at `path`, at the end or at `index`, filled in with defaults and ' +
      'given an id; `remove` takes out the item at `path`; `move` moves the item at `path` to ' +
      '`index`. For lists prefer these to rewriting the whole list. Each answers with the one ' +
      'item it touched. Read first, and tell the person what changed.',
    parameters: {
      type: 'object',
      properties: {
        op: {
          type: 'string',
          enum: [...OPS],
          description: '`set` (default), `update`, `add`, `remove` or `move`.',
        },
        path: {
          type: 'string',
          description:
            'Dotted path to one setting or one item, as `read_settings` lists it. For `add`, ' +
            'the list itself.',
        },
        value: {
          type: 'string',
          description:
            'For `set` and `add`, the new value or item as JSON. Plain words are taken as a ' +
            'string, so `Tasks` and `"Tasks"` both work; `true`, `12` and `["a","b"]` are read ' +
            'as JSON. For `update`, a JSON object of the fields to change.',
        },
        index: {
          type: 'number',
          description: 'For `add`, where to insert (default: the end). For `move`, where to.',
        },
      },
      required: ['path'],
    },
    execute: async (_id, params) => {
      const path = typeof params.path === 'string' ? params.path.trim() : ''
      const raw =
        params.value === undefined
          ? undefined
          : typeof params.value === 'string'
            ? params.value
            : JSON.stringify(params.value)
      const op = (typeof params.op === 'string' && params.op ? params.op : 'set') as Op
      const index =
        params.index === undefined || params.index === null || params.index === ''
          ? undefined
          : Number(params.index)

      let text: string
      try {
        text = await write(op, path, raw, Number.isFinite(index) ? index : undefined)
      } catch (error) {
        if (!(error instanceof AmbiguousItem)) throw error
        text = error.message
      }
      return { content: [{ type: 'text', text }] }
    },
  }
}

/** JSON when it is JSON, and the plain string when it is not — `Tasks` is a folder name. */
function parseValue(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

async function write(
  op: Op,
  path: string,
  raw: string | undefined,
  index: number | undefined
): Promise<string> {
  if (!OPS.includes(op)) return `No op "${op}". Use one of: ${OPS.join(', ')}.`
  if (!path) return 'No setting named. Give `path`, as `read_settings` lists it.'
  if (isHidden(path)) return `"${path}" holds a secret or a cache and is not writable.`

  const root = rootOf(path)
  if (!knownRoots().has(root)) {
    return `No setting "${path}". Call \`read_settings\` for the ones there are.`
  }

  if (path === 'sync') {
    return 'Change `sync` one field at a time: `sync.serverUrl`, `sync.paused`, `sync.selective.images`, and so on.'
  }

  const found = resolve(path)
  // A path that resolves to nothing is a typo, and a typo that wrote would leave a key the
  // plugin never reads sitting in the settings for good.
  if (!found || found.value === undefined) {
    return `"${path}" is not a setting that exists. Read it first; this tool changes settings rather than inventing them.`
  }

  if ((op === 'set' || op === 'update' || op === 'add') && raw === undefined) {
    return `\`${op}\` needs \`value\`.`
  }

  let result: ItemResult
  if (op === 'set') result = setValue(path, found, parseValue(raw))
  else if (op === 'update') result = updateItem(path, found, parseValue(raw))
  else if (op === 'add') result = addItem(path, root, found, parseValue(raw), index)
  else if (op === 'remove') result = removeItem(path, found)
  else result = moveItem(path, found, index)

<<<<<<< HEAD
  if (!result.changed) return result.text

  // Some top-level settings do work when assigned — `logsNotesTypes` rebuilds the regexps it
  // is matched with — and an item changed in place never passes through that. Assigning the
  // setting to itself does.
  if (!root.startsWith('ai.')) {
    const config = AbeleConfig.getInstance() as unknown as Record<string, unknown>
    const value = config[root]
    config[root] = Array.isArray(value) ? [...value] : value
  }
  await AbeleConfig.getInstance().saveSettings()
  return result.text
}

function setValue(
  path: string,
  found: NonNullable<ReturnType<typeof resolve>>,
  parsed: unknown
): ItemResult {
  const was = typeOf(found.value)
  const now = typeOf(parsed)
  if (was !== 'empty' && was !== now) {
    return {
      text: `"${path}" is ${was}; ${JSON.stringify(parsed)} is ${now}. The type has to match.`,
      changed: false,
    }
  }

  if (found.key === 'interceptorAgentId' && isAgent(found.parent)) {
    const refused = refuseInterceptor(found.parent, parsed)
    if (refused) return { text: refused, changed: false }
  }
  if (found.key === 'interceptorPattern' && isAgent(found.parent)) {
    const refused = refusePattern(parsed)
    if (refused) return { text: refused, changed: false }
  }

  // A value read, changed and written back whole still reads `<hidden>` where a keychain id
  // was; that id stays rather than being replaced by the placeholder.
  const next = restoreHidden(parsed, found.value)
  const before = JSON.stringify(redact(found.value, found.key))
  ;(found.parent as Record<string, unknown>)[found.key] = next

  return { text: `${path}: ${before} → ${JSON.stringify(redact(next, found.key))}`, changed: true }
=======
  const { before, after } = describeSettingsWrite(path, raw)
  if (isDevicePath(path)) {
    const refusal = await writeDevice(path, next)
    if (refusal) return refusal
  } else {
    found.parent[found.key] = next
    await AbeleConfig.getInstance().saveSettings()
  }

  return `${path}: ${before} → ${after}`
}

/** What a write would change, as the approval card shows it and the tool reports it. */
export interface SettingsWriteView {
  path: string
  /** The value now, as JSON with any secret replaced; `(not set)` when the path names nothing. */
  before: string
  /** The value asked for, the same way. */
  after: string
  /** For a field that moves this device's sync token: what it changes, and where it goes. */
  warning: string | null
  /** Whether the setting is this device's own, kept in no file another device reads. */
  deviceOnly: boolean
}

/**
 * The one reading of a `write_settings` call that both the approval card and the tool use, so
 * what was approved is what the result says happened: the setting, its value now and the value
 * asked for, redacted alike, and for this device's sync connection the line the card adds.
 */
export function describeSettingsWrite(path: string, raw: string): SettingsWriteView {
  const trimmed = path.trim()
  const next = parseValue(raw)
  if (isHidden(trimmed)) {
    const hidden = JSON.stringify('<hidden>')
    return { path: trimmed, before: hidden, after: hidden, warning: null, deviceOnly: false }
  }
  const found = trimmed ? resolve(trimmed) : null
  const key = found?.key ?? ''
  const before =
    found && found.value !== undefined ? JSON.stringify(redact(found.value, key)) : '(not set)'
  const device = isDevicePath(trimmed)
  return {
    path: trimmed,
    before,
    after: JSON.stringify(redact(next, key)) ?? '(not set)',
    warning: device ? deviceWarning(trimmed, next) : null,
    deviceOnly: device,
  }
>>>>>>> b700e6a9 (feat(sync): the settings tools reach this device's connection, and the write_settings approval shows before, after and where the token goes)
}
