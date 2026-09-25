import { nanoid } from 'nanoid'
import { toRaw } from 'vue'
import { AbeleConfig, normalizeHeaderButton, normalizeLink } from '@/services/AbeleConfig'
import { normalizeRule } from '@/automations/types'
import { createAgent } from '../agents/types'
import { Journal, type JournalDTO } from '@/entities/Journal'
import {
  HIDDEN_VALUE,
  SECRET_KEYS,
  isHidden,
  isRecord,
  itemLine,
  redact,
  typeOf,
  type Resolved,
} from './settingsPaths'

/**
 * The item-level changes `write_settings` makes to a list setting: patch one item, add one,
 * remove one, move one. Each answers with the item it touched and never with the list, so
 * changing one button out of forty costs one button either way.
 */

/**
 * The lists whose items the plugin fills in on load, filled in the same way when one is added —
 * so an agent that gives a button a name and a script gets a whole button, not a half one the
 * header then trips over.
 */
const MAKE_WHOLE: Record<string, (raw: Record<string, unknown>) => unknown> = {
  'ai.agents': (raw) => createAgent(raw),
  headerButtons: (raw) => normalizeHeaderButton(raw),
  links: (raw) => normalizeLink(raw),
  automations: (raw) => normalizeRule(raw),
  journals: (raw) => new Journal(raw as unknown as JournalDTO),
}

/**
 * An agent's interceptor has to be another agent that exists. The type check alone would let
 * any string through, and an agent named as its own reviewer is exactly the loop the rest of
 * the plugin refuses — better said here than silently dropped at the next load.
 */
export function refuseInterceptor(self: unknown, next: unknown): string | null {
  if (next === '' || next === undefined) return null
  const agents = AbeleConfig.getInstance().ai.agents || []
  if (typeof next !== 'string' || !agents.some((a) => a.id === next)) {
    return `${JSON.stringify(next)} is not an agent id. Read \`ai.agents\` for the ids there are, or write "" for no interceptor.`
  }
  if (isRecord(self) && self.id === next) return 'An agent cannot be its own interceptor.'
  return null
}

/** Whether an object is one of the configured agents, reactive wrapper or not. */
export function isAgent(value: unknown): boolean {
  const agents = AbeleConfig.getInstance().ai.agents || []
  const raw = toRaw(value)
  return agents.some((agent) => toRaw(agent) === raw)
}

/** How an item is named in an answer: by its id where it has one, which is what stays put. */
function itemPath(listPath: string, item: unknown, index: number): string {
  return isRecord(item) && typeof item.id === 'string' && item.id
    ? `${listPath}.${item.id}`
    : `${listPath}.${index}`
}

function shown(value: unknown): string {
  return JSON.stringify(redact(value))
}

/**
 * What a patch would do wrong, before any of it is done: a secret written, a key hidden, a type
 * changed. `<hidden>`, the placeholder a secret reads as, is an echo and is skipped rather than
 * refused.
 */
function checkPatch(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
  at: string
): string | null {
  for (const [key, next] of Object.entries(patch)) {
    const path = `${at}.${key}`
    if (SECRET_KEYS.test(key) && next === HIDDEN_VALUE) continue
    if (isHidden(path)) return `"${path}" holds a secret or a cache and is not writable.`
    if (next === null) continue
    const old = target[key]
    if (isRecord(next) && isRecord(old)) {
      const inner = checkPatch(old, next, path)
      if (inner) return inner
      continue
    }
    const was = typeOf(old)
    const now = typeOf(next)
    if (was !== 'empty' && was !== now) {
      return `"${path}" is ${was}; ${JSON.stringify(next)} is ${now}. The type has to match.`
    }
  }
  return null
}

/** A JSON merge patch: named fields replaced, objects merged into, `null` taking a field out. */
function applyPatch(target: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const [key, next] of Object.entries(patch)) {
    if (SECRET_KEYS.test(key) && next === HIDDEN_VALUE) continue
    if (next === null) {
      delete target[key]
    } else if (isRecord(next) && isRecord(target[key])) {
      applyPatch(target[key], next)
    } else {
      target[key] = next
    }
  }
}

export interface ItemResult {
  /** The answer for the model, or the refusal. */
  text: string
  /** Whether anything changed, and so whether the settings are saved. */
  changed: boolean
}

const refused = (text: string): ItemResult => ({ text, changed: false })

export function updateItem(path: string, found: Resolved, patch: unknown): ItemResult {
  if (!isRecord(found.value)) {
    return refused(
      `"${path}" is ${typeOf(found.value)}; \`update\` patches an object, such as one item of a list. Use \`set\` for anything else.`
    )
  }
  if (!isRecord(patch)) {
    return refused('`update` takes a JSON object of the fields to change, such as {"name":"New"}.')
  }

  const problem = checkPatch(found.value, patch, path)
  if (problem) return refused(problem)
  if (isAgent(found.value) && 'interceptorAgentId' in patch) {
    const bad = refuseInterceptor(found.value, patch.interceptorAgentId)
    if (bad) return refused(bad)
  }

  applyPatch(found.value, patch)
  return { text: `${path} updated: ${shown(found.value)}`, changed: true }
}

export function addItem(
  path: string,
  root: string,
  found: Resolved,
  raw: unknown,
  index?: number
): ItemResult {
  const list = found.value
  if (!Array.isArray(list)) {
    return refused(`"${path}" is ${typeOf(list)}, not a list. \`add\` puts an item into a list.`)
  }

  const kind = list.length > 0 ? typeOf(list[0]) : 'empty'
  if (kind !== 'empty' && kind !== typeOf(raw)) {
    return refused(
      `The items of "${path}" are ${kind}; ${JSON.stringify(raw)} is ${typeOf(raw)}. The type has to match.`
    )
  }

  let item: unknown = raw
  if (isRecord(raw)) {
    for (const key of Object.keys(raw)) {
      if (SECRET_KEYS.test(key) && raw[key] === HIDDEN_VALUE) delete raw[key]
    }
    const makeWhole = path === root ? MAKE_WHOLE[root] : undefined
    if (makeWhole) item = makeWhole(raw)
    // A list whose items carry ids gets one more that does too, so it can be named later.
    else if (!('id' in raw) && list.some((old) => isRecord(old) && 'id' in old)) {
      item = { id: nanoid(), ...raw }
    }
    if (path === 'ai.agents') {
      const bad = refuseInterceptor(item, (item as Record<string, unknown>).interceptorAgentId)
      if (bad) return refused(bad)
    }
  }

  const at = index === undefined ? list.length : clamp(index, 0, list.length)
  list.splice(at, 0, item)
  return {
    text: `Added to ${path} at ${at} of ${list.length}: ${itemPath(path, item, at)} = ${shown(item)}`,
    changed: true,
  }
}

export function removeItem(path: string, found: Resolved): ItemResult {
  const list = found.parent
  if (!Array.isArray(list)) {
    return refused(
      `"${path}" is a setting, not an item of a list. \`remove\` takes one item, such as \`headerButtons.<id>\`.`
    )
  }
  const index = Number(found.key)
  const [gone] = list.splice(index, 1)
  return {
    text: `Removed from ${found.parentPath} (${list.length} left): ${shown(gone)}`,
    changed: true,
  }
}

export function moveItem(path: string, found: Resolved, to: number | undefined): ItemResult {
  const list = found.parent
  if (!Array.isArray(list)) {
    return refused(`"${path}" is a setting, not an item of a list. \`move\` takes one item.`)
  }
  if (to === undefined) return refused('`move` needs `index`, the place to move the item to.')

  const from = Number(found.key)
  const target = clamp(to, 0, list.length - 1)
  const [item] = list.splice(from, 1)
  list.splice(target, 0, item)
  return {
    text: `Moved ${itemLine(item, target)} in ${found.parentPath} from ${from} to ${target}.`,
    changed: true,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(value), min), max)
}
