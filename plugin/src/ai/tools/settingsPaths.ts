import { AbeleConfig, DEFAULT_SETTINGS } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '../types'

/**
 * How `read_settings` and `write_settings` find a setting: dotted paths into the live config,
 * the settings that are out of reach, and what is hidden in anything returned.
 */

/**
 * What may be read and written at all: the keys the settings actually have.
 *
 * Built from the defaults rather than written out here, so a setting added to `AbeleSettings`
 * or `AiSettings` is reachable the day it exists — the same reason `transfer/entries.ts` is
 * the one place that lists them by name, and the same trap if this drifted.
 */
export function knownRoots(): Set<string> {
  const roots = new Set<string>(Object.keys(DEFAULT_SETTINGS))
  for (const key of Object.keys(DEFAULT_AI_SETTINGS)) roots.add(`ai.${key}`)
  return roots
}

/** The setting a path starts in: `ai.agents` for `ai.agents.a1.name`, `tasksFolder` for itself. */
export function rootOf(path: string): string {
  return path
    .split('.')
    .slice(0, path.startsWith('ai.') ? 2 : 1)
    .join('.')
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
export const SECRET_KEYS = /^(apiKeyId|keyId|apiKey|token|secret|password|secretStore)$/i

/** What a secret reads as in anything returned, and what an echo of it is recognised by. */
export const HIDDEN_VALUE = '<hidden>'

export function isHidden(path: string): boolean {
  const lower = path.toLowerCase()
  // A hidden setting hides everything under it too: `secretStore.entries` is as much the
  // store as `secretStore` is.
  if (HIDDEN.some((hidden) => lower === hidden.toLowerCase())) return true
  if (HIDDEN.some((hidden) => lower.startsWith(`${hidden.toLowerCase()}.`))) return true
  return path.split('.').some((segment) => SECRET_KEYS.test(segment))
}

/** Everything a secret key holds, replaced — the shape stays, the value does not. */
export function redact(value: unknown, key = ''): unknown {
  if (SECRET_KEYS.test(key)) return value ? HIDDEN_VALUE : ''
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

/**
 * The other half of `redact`: a value written back with a secret still reading `<hidden>` —
 * a list read, changed and written whole — keeps the secret it had rather than storing the
 * placeholder. Items of a list are matched by `id` where they have one, by place otherwise.
 */
export function restoreHidden(next: unknown, prev: unknown): unknown {
  if (Array.isArray(next)) {
    const before = Array.isArray(prev) ? prev : []
    return next.map((item, index) => {
      const id = isRecord(item) ? item.id : undefined
      const match =
        id !== undefined ? before.find((old) => isRecord(old) && old.id === id) : before[index]
      return restoreHidden(item, match)
    })
  }
  if (isRecord(next)) {
    const old = isRecord(prev) ? prev : {}
    for (const [name, inner] of Object.entries(next)) {
      if (SECRET_KEYS.test(name) && inner === HIDDEN_VALUE) {
        if (name in old) next[name] = old[name]
        else delete next[name]
      } else {
        next[name] = restoreHidden(inner, old[name])
      }
    }
  }
  return next
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** The type of a value as these tools talk about it, which is what a write has to match. */
export function typeOf(value: unknown): string {
  if (value === null || value === undefined) return 'empty'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

export interface Resolved {
  /** What the last segment lives on — an object, or the list an item is in. */
  parent: Record<string, unknown> | unknown[]
  /** The key on `parent`; for an item of a list, its index as a string. */
  key: string
  value: unknown
  /** The path of `parent` as it was written: `headerButtons` for `headerButtons.b2`. */
  parentPath: string
}

/** A name that fits more than one item, which is a question for the caller rather than a guess. */
export class AmbiguousItem extends Error {}

/**
 * Walks a dotted path from the live config: `tasksFolder`, `ai.chatFolder`, `ai.agents.0.name`.
 * In a list a segment is the item's place, or its `id`, its `name` or its `value`, or — in a
 * list of words — the word itself: `ai.agents.Writer.prompts`, `headerButtons.b2`,
 * `logsNotesTypes.log`. A name with a dot in it is found too, from the segments it spans.
 *
 * Against `AbeleConfig` rather than against a plain object, because that is where the settings
 * live at runtime: several of them are accessors that do work on assignment — `logsNotesTypes`
 * rebuilds the regexps it is matched with — and a write that went into a copy would be a write
 * that changed nothing until the next restart, or never.
 */
export function resolve(path: string): Resolved | null {
  const segments = path.split('.').filter(Boolean)
  if (segments.length === 0) return null

  let parent: Resolved['parent'] | null = null
  let key = ''
  let parentPath = ''
  let value: unknown = AbeleConfig.getInstance()

  for (let i = 0; i < segments.length; ) {
    if (!value || typeof value !== 'object') return null
    parentPath = segments.slice(0, i).join('.')
    if (Array.isArray(value)) {
      const found = findItem(value, segments, i)
      if (!found) return null
      parent = value
      key = String(found.index)
      value = value[found.index]
      i += found.used
    } else {
      parent = value as Record<string, unknown>
      key = segments[i]
      value = parent[key]
      i++
    }
  }

  return parent ? { parent, key, value, parentPath } : null
}

/** Where in a list the segments starting at `start` point, and how many of them it took. */
function findItem(
  list: unknown[],
  segments: string[],
  start: number
): { index: number; used: number } | null {
  if (/^\d+$/.test(segments[start])) return { index: Number(segments[start]), used: 1 }

  for (let used = 1; start + used <= segments.length; used++) {
    const wanted = segments.slice(start, start + used).join('.')
    const index = matchItem(list, wanted)
    if (index !== -1) return { index, used }
  }
  return null
}

function matchItem(list: unknown[], wanted: string): number {
  const byId = list.findIndex((item) => isRecord(item) && item.id === wanted)
  if (byId !== -1) return byId

  for (const field of ['name', 'value']) {
    const exact = indexesWhere(list, (item) => isRecord(item) && item[field] === wanted)
    if (exact.length > 1) {
      throw new AmbiguousItem(
        `${exact.length} items have ${field} "${wanted}". Name the one you mean by its id or its place.`
      )
    }
    if (exact.length === 1) return exact[0]
  }

  const word = list.indexOf(wanted)
  if (word !== -1) return word

  const lower = wanted.toLowerCase()
  const loose = indexesWhere(
    list,
    (item) => isRecord(item) && typeof item.name === 'string' && item.name.toLowerCase() === lower
  )
  return loose.length === 1 ? loose[0] : -1
}

function indexesWhere(list: unknown[], test: (item: unknown) => boolean): number[] {
  const out: number[] = []
  list.forEach((item, index) => {
    if (test(item)) out.push(index)
  })
  return out
}

/** One line for an item of a list: its place, and its id and name where it has them. */
export function itemLine(item: unknown, index: number): string {
  if (!isRecord(item)) return `${index}: ${JSON.stringify(redact(item))}`
  const parts = [String(index)]
  if (typeof item.id === 'string') parts.push(`id ${item.id}`)
  for (const field of ['name', 'value', 'scriptName']) {
    if (typeof item[field] === 'string' && item[field]) {
      parts.push(`${field} ${JSON.stringify(item[field])}`)
      break
    }
  }
  return parts.join(' · ')
}
