/**
 * What of the settings can travel, and what happens when it lands.
 *
 * Both sides work on a plain settings object: the sending side turns it into a list of
 * entries a person can tick, the receiving side says what each one would do — add something,
 * replace something, or change nothing — and then does it. Nothing here touches Obsidian, so
 * the rules about what may be overwritten are testable without one.
 */
import { describe, it, expect } from 'vitest'
import { reactive } from 'vue'
import {
  collectEntries,
  buildPayload,
  needsCode,
  planEntries,
  applyEntries,
  removedByReplace,
} from '@/transfer/entries'
import type { AbeleSettings } from '@/services/AbeleConfig'
import type { AiSettings } from '@/ai/types'
import type { TransferEntry } from '@/transfer/types'

const provider = (id: string, name: string, apiKeyId = `key-${id}`) => ({
  id,
  name,
  baseUrl: `https://${name}.example`,
  apiKeyId,
  models: [{ id: 'm1', name: 'Model one' }],
})

const settings = (over: Partial<AbeleSettings> = {}): AbeleSettings =>
  ({
    refreshDelay: 500,
    tasksFolder: 'Tasks',
    ai: {
      enabled: true,
      providers: [provider('p1', 'openwebui')],
      agents: [{ id: 'a1', name: 'Writer', description: '', utility: false }],
      secrets: [{ name: 'brave', keyId: 'abele-brave-search' }],
      chatHistory: [{ path: 'Chats/one.abchat', title: 'One', created: '2026-01-01' }],
      activeProviderId: 'p1',
      activeModelId: 'm1',
      chatFolder: 'Chats/{{name}}',
      braveSearchApiKey: 'abele-brave-search',
      interceptors: [],
      imageProviders: [],
      prompts: {},
    } as unknown as AiSettings,
    links: [{ id: 'l1', name: 'Open', type: 'script', scriptName: 'open', commandId: '' }],
    fireflyToken: 'firefly-secret-token',
    ...over,
  }) as AbeleSettings

const find = (entries: TransferEntry[], section: string, id: string) =>
  entries.find((e) => e.section === section && e.id === id)

describe('what the sending side offers', () => {
  it('makes an entry of every provider, named the way the settings name it', () => {
    const entries = collectEntries(settings())

    expect(find(entries, 'ai-providers', 'p1')?.label).toBe('openwebui')
  })

  it('remembers which key belongs to which provider', () => {
    const entries = collectEntries(settings())

    expect(find(entries, 'ai-providers', 'p1')?.secretIds).toEqual(['key-p1'])
  })

  /** A chat's path means nothing in another vault, and the list is the longest thing there. */
  it('never offers the chat history', () => {
    const entries = collectEntries(settings())

    expect(JSON.stringify(entries)).not.toContain('one.abchat')
  })

  it('leaves out a list that has nothing in it', () => {
    const entries = collectEntries(settings())

    expect(entries.some((e) => e.section === 'ai-interceptors')).toBe(false)
  })

  it('marks the block holding a token as one that cannot travel in the open', () => {
    const entries = collectEntries(settings())

    expect(find(entries, 'finance', 'finance')?.sensitive).toBe(true)
  })
})

describe('settings that arrived later than the transfer did', () => {
  /**
   * The section lists the keys it carries by name, so anything added to the settings after it
   * was written is silently left behind. Voice input was exactly that.
   */
  it('carries the voice settings', () => {
    const entries = collectEntries(
      settings({
        ai: {
          ...settings().ai!,
          voice: {
            modelId: 'google/gemini-3.5-flash-lite',
            endpoint: '',
            apiKeyId: '',
            language: 'Russian',
          },
        } as AiSettings,
      })
    )

    const voice = find(entries, 'ai-voice', 'ai-voice')
    expect(voice).toBeTruthy()
    expect(JSON.stringify(voice?.data)).toContain('Russian')
  })

  it('takes the OpenRouter key along with them', () => {
    const entries = collectEntries(
      settings({
        ai: {
          ...settings().ai!,
          voice: { modelId: 'm', endpoint: '', apiKeyId: '', language: '' },
        } as AiSettings,
      })
    )

    expect(find(entries, 'ai-voice', 'ai-voice')?.secretIds).toEqual(['abele-openrouter'])
  })

  it('takes the key of a voice setup pointed somewhere else', () => {
    const entries = collectEntries(
      settings({
        ai: {
          ...settings().ai!,
          voice: {
            modelId: 'm',
            endpoint: 'https://elsewhere',
            apiKeyId: 'abele-elsewhere',
            language: '',
          },
        } as AiSettings,
      })
    )

    expect(find(entries, 'ai-voice', 'ai-voice')?.secretIds).toEqual(['abele-elsewhere'])
  })

  /** The same gap, one section over: the name of the Brave key travelled, the key did not. */
  it('takes the Brave search key with the settings that name it', () => {
    const entries = collectEntries(settings())

    expect(find(entries, 'ai-general', 'ai-general')?.secretIds).toEqual(['abele-brave-search'])
  })

  it('offers no voice entry at all when voice was never set up', () => {
    const entries = collectEntries(settings())

    expect(entries.some((e) => e.section === 'ai-voice')).toBe(false)
  })

  it('writes the voice settings into the vault they land in', () => {
    const arriving = collectEntries(
      settings({
        ai: {
          ...settings().ai!,
          voice: {
            modelId: 'mistralai/voxtral-small-24b-2507',
            endpoint: '',
            apiKeyId: '',
            language: '',
          },
        } as AiSettings,
      })
    ).filter((e) => e.section === 'ai-voice')

    const next = applyEntries(arriving, settings())

    expect(next.ai?.voice?.modelId).toBe('mistralai/voxtral-small-24b-2507')
  })

  /** The same gap again, one feature later: comment chats were added after this list. */
  it('carries the comment agent and the folder comments live in', () => {
    const entries = collectEntries(
      settings({
        ai: {
          ...settings().ai!,
          commentAgentId: 'u1',
          commentFolder: 'AI/Comments',
        } as AiSettings,
      })
    )

    expect(find(entries, 'ai-general', 'ai-general')?.data).toMatchObject({
      commentAgentId: 'u1',
      commentFolder: 'AI/Comments',
    })
  })

  it('writes both into the vault they land in', () => {
    const arriving = collectEntries(
      settings({
        ai: {
          ...settings().ai!,
          commentAgentId: 'u1',
          commentFolder: 'Notes/Comments',
        } as AiSettings,
      })
    ).filter((e) => e.section === 'ai-general')

    const next = applyEntries(arriving, settings())

    expect(next.ai?.commentAgentId).toBe('u1')
    expect(next.ai?.commentFolder).toBe('Notes/Comments')
  })

  /** An agent id is not a key. Adding one must not add a slot to the keychain list. */
  it('asks the keychain for nothing extra on account of them', () => {
    const entries = collectEntries(
      settings({ ai: { ...settings().ai!, commentAgentId: 'u1' } as AiSettings })
    )

    expect(find(entries, 'ai-general', 'ai-general')?.secretIds).toEqual(['abele-brave-search'])
  })
})

describe('packing what was ticked', () => {
  const keys: Record<string, string> = { 'key-p1': 'sk-provider', 'abele-brave-search': 'sk-brave' }
  const read = (id: string) => keys[id] ?? ''

  it('carries the keys of the entries that were ticked, and no others', () => {
    const entries = collectEntries(settings())
    const chosen = [find(entries, 'ai-providers', 'p1')!]

    const payload = buildPayload(chosen, read)

    expect(payload.secrets).toEqual({ 'key-p1': 'sk-provider' })
  })

  it('sends the provider without its key when keys are not being sent', () => {
    const entries = collectEntries(settings())
    const chosen = [find(entries, 'ai-providers', 'p1')!]

    const payload = buildPayload(chosen, null)

    expect(payload.secrets).toEqual({})
    expect(payload.entries).toHaveLength(1)
  })

  it('leaves out a key the keychain does not actually hold', () => {
    const entries = collectEntries(settings())
    const chosen = [find(entries, 'ai-providers', 'p1')!]

    const payload = buildPayload(chosen, () => '')

    expect(payload.secrets).toEqual({})
  })
})

describe('deciding whether a code is needed', () => {
  it('is needed once a key is actually going along', () => {
    const entries = collectEntries(settings())
    const chosen = [find(entries, 'ai-providers', 'p1')!]

    expect(needsCode(buildPayload(chosen, () => 'sk-provider'))).toBe(true)
  })

  it('is not needed for the same entries without their keys', () => {
    const entries = collectEntries(settings())
    const chosen = [find(entries, 'ai-providers', 'p1')!]

    expect(needsCode(buildPayload(chosen, null))).toBe(false)
  })

  it('is needed for a block that holds a token of its own, keys or not', () => {
    const entries = collectEntries(settings())
    const chosen = [find(entries, 'finance', 'finance')!]

    expect(needsCode(buildPayload(chosen, null))).toBe(true)
  })
})

describe('what the receiving side is told will happen', () => {
  it('calls an unknown provider new', () => {
    const arriving = collectEntries(
      settings({ ai: { ...settings().ai!, providers: [provider('p2', 'groq')] } })
    )
    const planned = planEntries(arriving, settings())

    expect(planned.find((p) => p.entry.id === 'p2')?.status).toBe('new')
  })

  it('calls a provider it already has, changed, a replacement', () => {
    const changed = { ...settings().ai!, providers: [provider('p1', 'renamed')] }
    const planned = planEntries(collectEntries(settings({ ai: changed })), settings())

    expect(planned.find((p) => p.entry.id === 'p1')?.status).toBe('replace')
  })

  it('says an identical provider would change nothing', () => {
    const planned = planEntries(collectEntries(settings()), settings())

    expect(planned.find((p) => p.entry.id === 'p1')?.status).toBe('same')
  })
})

describe('replacing rather than merging', () => {
  const arriving = () =>
    collectEntries(
      settings({ ai: { ...settings().ai!, providers: [provider('p2', 'groq')] } })
    ).filter((e) => e.section === 'ai-providers')

  it('leaves the vault with exactly what arrived, and nothing it had before', () => {
    const next = applyEntries(arriving(), settings(), 'replace')

    expect(next.ai?.providers.map((p) => p.id)).toEqual(['p2'])
  })

  it('is not what merging does, which keeps both', () => {
    const next = applyEntries(arriving(), settings(), 'merge')

    expect(next.ai?.providers.map((p) => p.id)).toEqual(['p1', 'p2'])
  })

  /** Replacing what was sent must not empty what was not: an untouched list stays untouched. */
  it('touches only the sections the transfer actually carried', () => {
    const next = applyEntries(arriving(), settings(), 'replace')

    expect(next.ai?.agents).toHaveLength(1)
    expect(next.links).toEqual(settings().links)
  })

  it('says beforehand what replacing would take away', () => {
    const going = removedByReplace(arriving(), settings())

    expect(going.map((item) => item.label)).toEqual(['openwebui'])
  })

  it('has nothing to take away when the transfer holds everything already here', () => {
    const same = collectEntries(settings()).filter((e) => e.section === 'ai-providers')

    expect(removedByReplace(same, settings())).toEqual([])
  })

  /**
   * Scripts, skills and prompts are files in the vault. Dropping a provider from the settings
   * is one thing; deleting somebody's notes because they were not in the transfer is another,
   * so replacing never reaches them.
   */
  it('never proposes removing a file', () => {
    const withFiles = [
      ...arriving(),
      {
        section: 'script-files' as const,
        id: 'Scripts/other.js',
        label: 'other.js',
        data: { path: 'other.js', content: '', base: 'Scripts' },
      },
    ]

    expect(removedByReplace(withFiles, settings()).every((i) => i.section === 'ai-providers')).toBe(
      true
    )
  })
})

describe('applying what was accepted', () => {
  it('adds a provider the vault did not have', () => {
    const arriving = collectEntries(
      settings({ ai: { ...settings().ai!, providers: [provider('p2', 'groq')] } })
    ).filter((e) => e.section === 'ai-providers')

    const next = applyEntries(arriving, settings())

    expect(next.ai?.providers.map((p) => p.id)).toEqual(['p1', 'p2'])
  })

  it('replaces the one it already had rather than doubling it', () => {
    const arriving = collectEntries(
      settings({ ai: { ...settings().ai!, providers: [provider('p1', 'renamed')] } })
    ).filter((e) => e.section === 'ai-providers')

    const next = applyEntries(arriving, settings())

    expect(next.ai?.providers).toHaveLength(1)
    expect(next.ai?.providers[0].name).toBe('renamed')
  })

  it('leaves the settings it was not given alone', () => {
    const arriving = collectEntries(
      settings({ ai: { ...settings().ai!, providers: [provider('p2', 'groq')] } })
    ).filter((e) => e.section === 'ai-providers')

    const next = applyEntries(arriving, settings())

    expect(next.links).toEqual(settings().links)
    expect(next.ai?.chatHistory).toEqual(settings().ai?.chatHistory)
  })

  it('writes a block over its own keys and nothing else', () => {
    const arriving = collectEntries(settings({ tasksFolder: 'Дела', refreshDelay: 999 })).filter(
      (e) => e.section === 'tasks'
    )

    const next = applyEntries(arriving, settings())

    expect(next.tasksFolder).toBe('Дела')
    expect(next.refreshDelay).toBe(500)
  })

  /**
   * The settings the app actually holds are watched by Vue, which means their arrays are
   * proxies — and `structuredClone` refuses a proxy outright. Applying a transfer threw
   * `DataCloneError` in the running plugin while every test here passed on plain objects.
   */
  it('applies to the settings the running app holds, proxies and all', () => {
    const observed = reactive(settings())
    const arriving = collectEntries(
      settings({ ai: { ...settings().ai!, providers: [provider('p2', 'groq')] } })
    ).filter((e) => e.section === 'ai-providers')

    const next = applyEntries(arriving, observed)

    expect(next.ai?.providers.map((p) => p.id)).toEqual(['p1', 'p2'])
  })

  it('does not change the settings object it was given', () => {
    const before = settings()
    const arriving = collectEntries(
      settings({ ai: { ...settings().ai!, providers: [provider('p2', 'groq')] } })
    ).filter((e) => e.section === 'ai-providers')

    applyEntries(arriving, before)

    expect(before.ai?.providers).toHaveLength(1)
  })
})
