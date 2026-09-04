import type { AgentTool } from '../client'
import { AbeleConfig, DEFAULT_SETTINGS } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '../types'

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
 */

/**
 * What may be read and written at all: the keys the settings actually have.
 *
 * Built from the defaults rather than written out here, so a setting added to `AbeleSettings`
 * or `AiSettings` is reachable the day it exists — the same reason `transfer/entries.ts` is
 * the one place that lists them by name, and the same trap if this drifted.
 */
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
  'ai.secrets',
  'ai.chatHistory',
  'ai.braveSearchApiKey',
  'fireflyToken',
  'ai.transferKey',
]

/** Key names that hold a secret wherever they turn up, however deep. */
const SECRET_KEYS = /^(apiKeyId|keyId|apiKey|token|secret|password)$/i

function isHidden(path: string): boolean {
  const lower = path.toLowerCase()
  if (HIDDEN.some((hidden) => lower === hidden.toLowerCase())) return true
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
 * Against `AbeleConfig` rather than against a plain object, because that is where the settings
 * live at runtime: several of them are accessors that do work on assignment — `logsNotesTypes`
 * rebuilds the regexps it is matched with — and a write that went into a copy would be a write
 * that changed nothing until the next restart, or never.
 */
function resolve(path: string): Resolved | null {
  const segments = path.split('.').filter(Boolean)
  if (segments.length === 0) return null

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
      'JSON: `tasksFolder`, `ai.chatFolder`, `ai.agents.0.name`. API keys are never ' +
      'returned. Ask `query_docs` for the `settings` section to learn what a setting does.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Dotted path to one setting. Omit for the list of all of them. Numeric segments ' +
            'index a list: `ai.agents.0.name`.',
        },
      },
    },
    execute: async (_id, params) => {
      const path = typeof params.path === 'string' ? params.path.trim() : ''
      return { content: [{ type: 'text', text: read(path) }] }
    },
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

  const root = path
    .split('.')
    .slice(0, path.startsWith('ai.') ? 2 : 1)
    .join('.')
  if (!knownRoots().has(root)) {
    return `No setting "${path}". Call this tool with no arguments for the ones there are.`
  }

  const found = resolve(path)
  if (!found || found.value === undefined) return `"${path}" is not set.`

  const text = JSON.stringify(redact(found.value, found.key), null, 2)
  if (text.length > MAX_VALUE_CHARS) {
    return `"${path}" is ${typeOf(found.value)} and too long to return whole (${text.length} characters). Ask for a piece of it, such as "${path}.0".`
  }
  return `${path} (${typeOf(found.value)}):\n${text}`
}

export function createWriteSettingsTool(): AgentTool {
  return {
    name: 'write_settings',
    label: 'Write settings',
    description:
      "Change one of the Abele plugin's settings. `path` names it and `value` is the new " +
      'value as JSON — `"Tasks"`, `true`, `0.7`, `["journal","log"]`. One setting per call. ' +
      'The setting must already exist and the new value must be of the same type as the old ' +
      'one. Read it first, and tell the person what changed.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Dotted path to one setting, as `read_settings` lists it.',
        },
        value: {
          type: 'string',
          description:
            'The new value, as JSON. Plain words are taken as a string, so `Tasks` and ' +
            '`"Tasks"` both work; `true`, `12` and `["a","b"]` are read as JSON.',
        },
      },
      required: ['path', 'value'],
    },
    execute: async (_id, params) => {
      const path = typeof params.path === 'string' ? params.path.trim() : ''
      const raw = typeof params.value === 'string' ? params.value : JSON.stringify(params.value)

      const text = await write(path, raw)
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

async function write(path: string, raw: string): Promise<string> {
  if (!path) return 'No setting named. Give `path`, as `read_settings` lists it.'
  if (isHidden(path)) return `"${path}" holds a secret or a cache and is not writable.`

  const root = path
    .split('.')
    .slice(0, path.startsWith('ai.') ? 2 : 1)
    .join('.')
  if (!knownRoots().has(root)) {
    return `No setting "${path}". Call \`read_settings\` for the ones there are.`
  }

  const found = resolve(path)
  // A path that resolves to nothing is a typo, and a typo that wrote would leave a key the
  // plugin never reads sitting in the settings for good.
  if (!found || found.value === undefined) {
    return `"${path}" is not a setting that exists. Read it first; this tool changes settings rather than inventing them.`
  }

  const next = parseValue(raw)
  const was = typeOf(found.value)
  const now = typeOf(next)
  if (was !== 'empty' && was !== now) {
    return `"${path}" is ${was}; ${JSON.stringify(next)} is ${now}. The type has to match.`
  }

  const before = JSON.stringify(redact(found.value, found.key))
  found.parent[found.key] = next
  await AbeleConfig.getInstance().saveSettings()

  return `${path}: ${before} → ${JSON.stringify(redact(next, found.key))}`
}
