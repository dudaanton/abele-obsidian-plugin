/**
 * The list of keys the plugin knows on this device, as the person reads it: each key under the
 * name of what it belongs to, where it is used, whether it is set, and how it stands with the
 * synced store.
 *
 * Built from the same place the store's own list of secrets comes from — each transfer
 * section's `secretsOf` — so a key a new setting declares is listed the day it exists.
 *
 * Only the settings screen uses this. Nothing an agent runs may import it (a test holds that
 * line): the list is a map of every key there is, and a value is one tap away from it.
 */
import type { AbeleSettings } from '@/services/AbeleConfig'
import type { AiSettings } from '@/ai/types'
import { DEFAULT_TRANSCRIPTION } from '@/ai/transcription'
import { collectEntries, sectionLabel } from '@/transfer/entries'
import type { SectionId } from '@/transfer/types'
import type { StoreContent, StoreStatus } from './SecretStore'

/**
 * - `device` — the store is off; the key is in this device's keychain.
 * - `synced` — in the store, and the keychain here holds the same value.
 * - `differs` — in the store, and the keychain here holds another value (changed outside the
 *   plugin, through Obsidian's own keychain screen). The store's value is the one used.
 * - `store-only` — in the store, missing from the keychain here.
 * - `not-synced` — set on this device, not in the store.
 * - `locked` — set here; the store cannot be read on this device, so how it stands is unknown.
 * - `unset` — no value anywhere this device can see.
 */
export type KeyState =
  | 'device'
  | 'synced'
  | 'differs'
  | 'store-only'
  | 'not-synced'
  | 'locked'
  | 'unset'

export interface SecretRow {
  /** The keychain id. */
  id: string
  /** What the key belongs to: the provider, the integration, the stored key's own name. */
  name: string
  /** Each place it is used, as `kind · name`, or the kind alone where the two are one. */
  uses: string[]
  set: boolean
  state: KeyState
  /** When the store last had it set, in milliseconds; `null` when nobody knows. */
  at: number | null
  /** In the store, and used by no setting on this device. */
  unused: boolean
}

/** What the list needs of the store, so the list can be worked out without one. */
export interface StoreView {
  status: StoreStatus
  contents: StoreContent[] | null
  has(id: string): boolean
}

/** What a use of a key is called, by the section that declares it. */
const KINDS: Partial<Record<SectionId, string>> = {
  'ai-providers': 'AI provider',
  'ai-image-providers': 'Image provider',
  'ai-secrets': 'Stored key',
  'ai-general': 'Web search',
  'ai-voice': 'Voice input',
  'ai-mcp-servers': 'MCP server',
  finance: 'Finance',
  github: 'GitHub',
}

/**
 * A block section holds one key and is named for its section ("AI general"), which says
 * nothing about the key: these name the service instead.
 */
const BLOCK_NAMES: Partial<Record<SectionId, string>> = {
  'ai-general': 'Brave Search',
  'ai-voice': 'Voice input',
  finance: 'Firefly III',
  github: 'GitHub',
}

interface Use {
  kind: string
  name: string
}

/** Every keychain id the settings point at, with each place that points at it, in order. */
function usesOf(settings: AbeleSettings): Map<string, Use[]> {
  const uses = new Map<string, Use[]>()
  const add = (id: string, use: Use) => {
    const list = uses.get(id) ?? []
    if (!list.some((u) => u.kind === use.kind && u.name === use.name)) list.push(use)
    uses.set(id, list)
  }

  for (const entry of collectEntries(settings)) {
    for (const id of entry.secretIds ?? []) {
      const block = entry.id === entry.section
      add(id, {
        kind: KINDS[entry.section] ?? sectionLabel(entry.section),
        name: (block && BLOCK_NAMES[entry.section]) || entry.label,
      })
    }
  }

  // Voice input reads its key under a default name even when its settings were never
  // touched, and untouched settings are no entry at all — the same as the store's own list.
  const ai = (settings.ai ?? {}) as Partial<AiSettings>
  add(ai.voice?.apiKeyId || DEFAULT_TRANSCRIPTION.apiKeyId, {
    kind: 'Voice input',
    name: 'Voice input',
  })

  // The agents that talk through a provider use its key too: named, so a key is recognised
  // by the agent a person knows it from.
  const providers = new Map((ai.providers ?? []).map((p) => [p.id, p]))
  for (const agent of ai.agents ?? []) {
    const through = [agent.providerId, agent.fallbackProviderId, agent.auxiliaryProviderId]
    for (const providerId of new Set(through)) {
      const keyId = providerId ? providers.get(providerId)?.apiKeyId : undefined
      if (keyId) add(keyId, { kind: 'Agent', name: agent.name || agent.id })
    }
  }

  return uses
}

function stateOf(id: string, view: StoreView, content: StoreContent | undefined): KeyState {
  const set = view.has(id)
  if (!set) return 'unset'
  if (view.status === 'off') return 'device'
  if (view.status !== 'unlocked') return 'locked'
  if (!content || content.removed) return 'not-synced'
  if (content.inKeychain === 'same') return 'synced'
  return content.inKeychain === 'different' ? 'differs' : 'store-only'
}

export function secretCatalog(settings: AbeleSettings, view: StoreView): SecretRow[] {
  const uses = usesOf(settings)
  const contents = new Map((view.contents ?? []).map((c) => [c.id, c]))

  const row = (id: string, list: Use[]): SecretRow => {
    const content = contents.get(id)
    return {
      id,
      name: list[0]?.name ?? id,
      // "Voice input · Voice input" says it twice: a use named for its kind is its kind.
      uses: list.map((u) => (u.kind === u.name ? u.kind : `${u.kind} · ${u.name}`)),
      set: view.has(id),
      state: stateOf(id, view, content),
      at: content && content.at > 0 && !content.removed ? content.at : null,
      unused: list.length === 0,
    }
  }

  const rows = [...uses].map(([id, list]) => row(id, list))
  // What the store holds that no setting here points at: another device's key for something
  // this one does not have, or one left behind. Removals are not keys.
  for (const content of contents.values()) {
    if (!uses.has(content.id) && !content.removed) rows.push(row(content.id, []))
  }
  return rows
}

/** Every set key as `name (id) = value`, one to a line, for "Copy all". */
export function copyAllText(rows: SecretRow[], get: (id: string) => string): string {
  return rows
    .map((r) => ({ r, value: r.set ? get(r.id) : '' }))
    .filter(({ value }) => value)
    .map(({ r, value }) => (r.unused ? `${r.id} = ${value}` : `${r.name} (${r.id}) = ${value}`))
    .join('\n')
}
