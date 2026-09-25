import type { AgentTool } from '../client'
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
  removeItem,
  updateItem,
  type ItemResult,
} from './settingsItems'

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

  // A value read, changed and written back whole still reads `<hidden>` where a keychain id
  // was; that id stays rather than being replaced by the placeholder.
  const next = restoreHidden(parsed, found.value)
  const before = JSON.stringify(redact(found.value, found.key))
  ;(found.parent as Record<string, unknown>)[found.key] = next

  return { text: `${path}: ${before} → ${JSON.stringify(redact(next, found.key))}`, changed: true }
}
