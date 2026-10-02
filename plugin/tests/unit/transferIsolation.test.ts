import { describe, expect, it } from 'vitest'
import { applyEntries, arrivingSecretIds, collectEntries } from '@/transfer/entries'
import type { AbeleSettings } from '@/services/AbeleConfig'
import type { TransferEntry } from '@/transfer/types'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'

const settings = (): AbeleSettings =>
  ({
    refreshDelay: 300,
    mapStyleUrl: 'https://maps.example/old.json',
    secretStore: { sample: 'unchanged' },
    ai: { ...DEFAULT_AI_SETTINGS, agents: [] },
  }) as AbeleSettings

const entry = (section: TransferEntry['section'], data: unknown): TransferEntry => ({
  section,
  id: section,
  label: section,
  data,
})

describe('references owned by arriving settings', () => {
  it('ignores sender metadata and unrelated fields in blocks', () => {
    expect(
      arrivingSecretIds([
        { ...entry('maps', { braveSearchApiKey: 'unrelated-key' }), secretIds: ['unrelated-key'] },
        entry('ai-general', { braveSearchApiKey: 'sample-search-key' }),
        entry('ai-providers', { id: 'sample', apiKeyId: 'sample-provider-key' }),
        entry('ai-providers', { id: 'other', apiKeyId: 'abele-store-key-sample' }),
      ])
    ).toEqual(['sample-search-key', 'sample-provider-key'])
  })

  it('does not grant fixed key slots to empty blocks or fields owned by another section', () => {
    expect(
      arrivingSecretIds([
        entry('ai-voice', {}),
        entry('finance', { braveSearchApiKey: 'unrelated-key' }),
      ])
    ).toEqual([])
  })

  it('keeps voice defaults and references introduced by newer sections', () => {
    expect(
      arrivingSecretIds([
        entry('ai-voice', { voice: { apiKeyId: '' } }),
        entry('ai-mcp-servers', { id: 'sample', keyId: 'sample-mcp-key' }),
        entry('calendars', { calendars: { feeds: [{ keyId: 'sample-calendar-key' }] } }),
      ])
    ).toEqual(['abele-openrouter', 'sample-mcp-key', 'sample-calendar-key'])
  })
})

describe('section ownership at the write boundary', () => {
  it('a maps block cannot replace AI, automation or encrypted store settings', () => {
    const before = settings()
    const next = applyEntries(
      [
        entry('maps', {
          mapStyleUrl: 'https://maps.example/new.json',
          ai: { permissionMode: 'allow-all' },
          automations: [{ id: 'sample-rule', enabled: true }],
          secretStore: { sample: 'replaced' },
          refreshDelay: 1,
        }),
      ],
      before
    )
    expect(next.mapStyleUrl).toBe('https://maps.example/new.json')
    expect(next.ai).toEqual(before.ai)
    expect(next.automations).toBeUndefined()
    expect(next.secretStore).toEqual(before.secretStore)
    expect(next.refreshDelay).toBe(300)
  })

  it('an AI block cannot replace agents, providers, history or sibling blocks', () => {
    const before = settings()
    const next = applyEntries(
      [
        entry('scripts', {
          scriptsFolder: 'Sample scripts',
          providers: [],
          agents: [{ id: 'sample' }],
          chatHistory: ['sample.abchat'],
          permissionMode: 'allow-all',
        }),
      ],
      before
    )
    expect(next.ai.scriptsFolder).toBe('Sample scripts')
    expect(next.ai.agents).toEqual(before.ai.agents)
    expect(next.ai.providers).toEqual(before.ai.providers)
    expect(next.ai.chatHistory).toEqual(before.ai.chatHistory)
    expect(next.ai.permissionMode).toBe(before.ai.permissionMode)
  })

  it('ignores inherited and prototype keys', () => {
    const data = Object.assign(
      Object.create({ mapStyleUrl: 'inherited' }),
      JSON.parse('{"__proto__":{"sample":true},"refreshDelay":1}')
    )
    const before = settings()
    expect(applyEntries([entry('maps', data)], before)).toEqual(before)
  })

  it('identifies multiple named keys by their keychain slot', () => {
    const source = settings()
    source.ai.secrets = [
      { name: 'Sample one', keyId: 'sample-one' },
      { name: 'Sample two', keyId: 'sample-two' },
    ]
    const arriving = collectEntries(source).filter((e) => e.section === 'ai-secrets')
    expect(arriving.map((e) => e.id)).toEqual(['sample-one', 'sample-two'])
    expect(applyEntries(arriving, settings()).ai.secrets).toEqual(source.ai.secrets)
  })
})
