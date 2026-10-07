/**
 * What of the settings can travel, and what happens when it lands.
 *
 * Both sides work on a plain settings object: the sending side turns it into a list of
 * entries a person can tick, the receiving side says what each one would do — add something,
 * replace something, or change nothing — and then does it. Nothing here touches Obsidian, so
 * the rules about what may be overwritten are testable without one.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { reactive } from 'vue'
import {
  collectEntries,
  buildPayload,
  needsCode,
  planEntries,
  applyEntries,
  removedByReplace,
  SECTIONS,
} from '@/transfer/entries'
import { storeReceivedKeys } from '@/transfer/receivedKeys'
import { SecretStore, setSecrets, type Keychain } from '@/secrets/SecretStore'
import type { AbeleSettings } from '@/services/AbeleConfig'
import { DEFAULT_READER_SETTINGS } from '@/reader/settings'
import type { AiSettings } from '@/ai/types'
import { createAgent } from '@/ai/agents/types'
import { TRANSFER_SECTIONS, isSpecialSection, type TransferEntry } from '@/transfer/types'
import { FIREFLY_TOKEN_KEY_ID } from '@/secrets/legacy'
import { defaultSyncSettings } from '@/sync/settings'

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
    sync: { keySignature: { property: 'secret', value: 'yes' } },
    ...over,
  }) as AbeleSettings

const find = (entries: TransferEntry[], section: string, id: string) =>
  entries.find((e) => e.section === section && e.id === id)

describe('location access travelling with agents', () => {
  it('carries each deliberate mode in the existing agent section, without location data', () => {
    for (const mode of ['off', 'ask', 'auto'] as const) {
      const source = settings()
      source.ai.agents = [
        createAgent({ id: 'sample-agent', toolModes: { current_location: mode } }),
      ]
      const entry = find(collectEntries(source), 'ai-agents', 'sample-agent')!
      const received = applyEntries([entry], settings())
      expect(
        received.ai.agents.find((a) => a.id === 'sample-agent')?.toolModes.current_location
      ).toBe(mode)
      expect(JSON.stringify(entry)).not.toMatch(/latitude|longitude|accuracy|timestamp/)
    }
  })
})

describe('tool discovery travelling with agents', () => {
  it('round-trips both modes in the whole agent definition', () => {
    for (const toolDiscovery of ['all', 'by-group'] as const) {
      const source = settings()
      source.ai.agents = [createAgent({ id: 'sample-discovery-agent', toolDiscovery })]
      const entry = find(collectEntries(source), 'ai-agents', 'sample-discovery-agent')!
      const received = applyEntries([entry], settings())
      expect(received.ai.agents.find((a) => a.id === 'sample-discovery-agent')?.toolDiscovery).toBe(
        toolDiscovery
      )
    }
  })
})

describe('the skills folder travelling', () => {
  it('round-trips with AI general settings', () => {
    const source = settings()
    source.ai.skillsFolder = 'Library/Skills'
    const entry = collectEntries(source).find((e) => e.section === 'ai-general')!
    const received = applyEntries([entry], settings())
    expect(received.ai.skillsFolder).toBe('Library/Skills')
  })
})

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

  /**
   * The Firefly token lives in the keychain now, like every other credential: the finance
   * block carries its keychain id, the token itself only rides along when keys are asked for.
   */
  it('carries the Firefly token as a key, never inside the finance settings', () => {
    const entries = collectEntries(settings({ fireflyBaseUrl: 'https://ff.example' }))
    const finance = find(entries, 'finance', 'finance')

    expect(JSON.stringify(finance?.data)).not.toContain('firefly-secret-token')
    expect(finance?.sensitive).toBeFalsy()
    expect(finance?.secretIds).toEqual([FIREFLY_TOKEN_KEY_ID])

    const withKeys = buildPayload([finance!], (id) =>
      id === FIREFLY_TOKEN_KEY_ID ? 'from-keychain' : ''
    )
    expect(withKeys.secrets).toEqual({ [FIREFLY_TOKEN_KEY_ID]: 'from-keychain' })
    expect(needsCode(buildPayload([finance!], null))).toBe(false)
  })

  /**
   * A guard on the list itself. Every section the screen offers has to be described here, so a
   * new one added to `TRANSFER_SECTIONS` without a section to read it is a failure rather than
   * a group that quietly never appears. File sections are the exception: their entries are
   * built by `files.ts` from the vault, not from the settings — and so is the sync connection,
   * built by `transfer/connection.ts` from the device's own record.
   */
  it('describes every section the screen offers', () => {
    const described = new Set(SECTIONS.map((section) => section.id))
    const missing = TRANSFER_SECTIONS.filter((id) => !isSpecialSection(id) && !described.has(id))

    expect(missing).toEqual([])
  })
})

/**
 * Sync, the half every device on the vault shares.
 *
 * A device's connection — where it syncs, the device it enrolled as, the token behind it, what
 * it takes — is its own and lives in its local storage. A block that carried it made two
 * devices one identity on the server, so the block carries none of it any more.
 */
describe('the sync settings', () => {
  it('carries the key signature and nothing that names a device', () => {
    const entry = find(collectEntries(settings()), 'sync', 'sync')

    expect(entry?.data).toEqual({ sync: { keySignature: { property: 'secret', value: 'yes' } } })
    expect(entry?.secretIds).toEqual([])
    expect(entry?.sensitive).toBeFalsy()
  })

  it('travels in the open', () => {
    const chosen = [find(collectEntries(settings()), 'sync', 'sync')!]

    expect(needsCode(buildPayload(chosen, () => 'absd_token'))).toBe(false)
  })

  it('writes the key signature into the vault it lands in', () => {
    const arriving = collectEntries(settings()).filter((e) => e.section === 'sync')

    const next = applyEntries(arriving, settings({ sync: defaultSyncSettings() }))

    expect(next.sync?.keySignature).toEqual({ property: 'secret', value: 'yes' })
  })

  it('leaves the rest of the settings where they were', () => {
    const arriving = collectEntries(settings()).filter((e) => e.section === 'sync')

    const next = applyEntries(arriving, settings({ tasksFolder: 'Дела' }))

    expect(next.tasksFolder).toBe('Дела')
  })
})

describe('settings that arrived later than the transfer did', () => {
  it('carries the room a chat’s rewind copies may take', () => {
    const base = settings()
    base.ai = { ...base.ai, rewindLimitMb: 250 }
    const entries = collectEntries(base)

    expect(find(entries, 'ai-general', 'ai-general')?.data).toMatchObject({ rewindLimitMb: 250 })
  })

  it('carries the scripts put on the toolbar with the script settings', () => {
    const base = settings()
    base.ai = { ...base.ai, scriptsEnabled: true, toolbarScripts: ['Translate', 'Plain'] }
    const entries = collectEntries(base)

    expect(find(entries, 'scripts', 'scripts')?.data).toMatchObject({
      toolbarScripts: ['Translate', 'Plain'],
    })
  })

  it('carries the switch that holds scripts from other devices with the script settings', () => {
    const base = settings()
    base.ai = { ...base.ai, scriptsEnabled: true, confirmForeignScripts: true }
    const entries = collectEntries(base)

    expect(find(entries, 'scripts', 'scripts')?.data).toMatchObject({
      confirmForeignScripts: true,
    })
  })

  it('carries the startup scripts and their skip switch with the script settings', () => {
    const base = settings()
    const startupScripts = [{ script: 'Inbox', devices: 'mobile' as const }]
    base.ai = { ...base.ai, scriptsEnabled: true, startupScripts, startupScriptsPaused: true }
    const entries = collectEntries(base)

    expect(find(entries, 'scripts', 'scripts')?.data).toMatchObject({
      startupScripts,
      startupScriptsPaused: true,
    })
  })

  it("carries an agent's interceptor script and pattern with the agent", () => {
    const base = settings()
    const agent = createAgent({
      id: 'a1',
      name: 'Guarded',
      interceptorScript: 'Quick tasks',
      interceptorPattern: '^/todo',
    })
    base.ai = { ...base.ai, agents: [agent] }
    const entries = collectEntries(base)

    expect(find(entries, 'ai-agents', 'a1')?.data).toMatchObject({
      interceptorScript: 'Quick tasks',
      interceptorPattern: '^/todo',
    })
  })

  it('round-trips a script interceptor and its reply-only mode together', () => {
    const base = settings()
    const choice = {
      interceptorScript: 'Sample guard',
      interceptorPattern: '^/review',
      interceptorReplyOnly: true,
    }
    base.ai.agents = [createAgent({ id: 'sample-script-agent', ...choice })]
    const entry = find(collectEntries(base), 'ai-agents', 'sample-script-agent')!
    expect(entry.data).toMatchObject(choice)
    const destination = settings()
    destination.ai.agents = []
    expect(applyEntries([entry], destination).ai.agents[0]).toMatchObject(choice)
  })

  it('round-trips an agent interceptor reply-only mode with the agent', () => {
    const base = settings()
    base.ai.agents = [createAgent({ id: 'sample-agent', interceptorReplyOnly: true })]
    const entry = find(collectEntries(base), 'ai-agents', 'sample-agent')!
    expect(entry.data).toMatchObject({ interceptorReplyOnly: true })
    const destination = settings()
    destination.ai.agents = []
    const received = applyEntries([entry], destination)
    expect(received.ai.agents[0].interceptorReplyOnly).toBe(true)
    expect(createAgent().interceptorReplyOnly).toBe(false)
  })

  it('carries both map settings', () => {
    const entries = collectEntries(
      settings({
        mapCoordinatesProperty: 'coordinates',
        mapStyleUrl: 'https://maps.example/style.json',
      })
    )

    expect(find(entries, 'maps', 'maps')?.data).toMatchObject({
      mapCoordinatesProperty: 'coordinates',
      mapStyleUrl: 'https://maps.example/style.json',
    })
  })

  it('carries the sidebar width of a tablet beside the one of a phone', () => {
    const entries = collectEntries(
      settings({ fullWidthSidebars: true, halfWidthSidebarsOnTablet: true })
    )

    expect(find(entries, 'other', 'other')?.data).toMatchObject({
      fullWidthSidebars: true,
      halfWidthSidebarsOnTablet: true,
    })
  })

  it('carries the birth date and the expected age the life in weeks is drawn from', () => {
    const entries = collectEntries(settings({ birthDate: '1990-05-17', lifeExpectancy: 85 }))

    expect(find(entries, 'tasks', 'tasks')?.data).toMatchObject({
      birthDate: '1990-05-17',
      lifeExpectancy: 85,
    })
  })

  it('carries whether mermaid diagrams are drawn by the plugin', () => {
    const entries = collectEntries(settings({ mermaidViewer: false }))

    expect(find(entries, 'other', 'other')?.data).toMatchObject({ mermaidViewer: false })
  })

  it('carries the properties drawn as counters', () => {
    const entries = collectEntries(settings({ counterProperties: ['reps', 'glasses'] }))

    expect(find(entries, 'other', 'other')?.data).toMatchObject({
      counterProperties: ['reps', 'glasses'],
    })
  })

  it('carries the properties drawn as dates, priorities, labels and groups', () => {
    const entries = collectEntries(
      settings({
        dateProperties: ['deadline'],
        priorityProperties: ['importance'],
        labelProperties: ['tags2'],
        groupProperties: ['projects'],
      })
    )

    expect(find(entries, 'other', 'other')?.data).toMatchObject({
      dateProperties: ['deadline'],
      priorityProperties: ['importance'],
      labelProperties: ['tags2'],
      groupProperties: ['projects'],
    })
  })

  it('carries the GitHub settings and the token they point at', () => {
    const github = {
      enabled: true,
      keyId: 'abele-github-token',
      server: 'https://git.example',
      openLinks: false,
      defaultRepo: 'octo-org/octo-repo',
      userDisplay: 'login' as const,
      pageWidth: 'custom' as const,
      pageWidthPx: 1280,
      // Pinned in "Open GitHub repository…", and pinned on the other device too.
      pinnedRepos: [{ url: 'https://git.example/octo-org/octo-repo' }],
    }
    const entries = collectEntries(settings({ github }))
    const entry = find(entries, 'github', 'github')

    expect(entry?.data).toEqual({
      github: {
        enabled: true,
        openLinks: false,
        defaultRepo: 'octo-org/octo-repo',
        userDisplay: 'login',
        pageWidth: 'custom',
        pageWidthPx: 1280,
        pinnedRepos: github.pinnedRepos,
      },
    })
    expect(entry?.secretIds).toEqual([])
    const row = find(entries, 'github-connections', 'github-legacy')!
    expect(row.secretIds).toEqual(['abele-github-token'])
    const applied = applyEntries([entry!, row], settings()).github!
    expect(applied.connections[0]).toMatchObject({ keyId: github.keyId, server: github.server })
    expect(applied.openLinks).toBe(false)
  })

  it('carries the separate notifications token beside the main one', () => {
    const github = {
      enabled: true,
      keyId: 'abele-github-token',
      notifications: { keyId: 'abele-github-notifications-token' },
    }
    const entry = find(collectEntries(settings({ github })), 'github', 'github')
    expect(entry?.secretIds).toEqual(['abele-github-notifications-token'])
    const row = find(collectEntries(settings({ github })), 'github-connections', 'github-legacy')!
    expect(row.secretIds).toEqual(['abele-github-token'])
    expect(applyEntries([entry!, row], settings()).github?.notifications).toMatchObject({
      keyId: github.notifications.keyId,
      boundKeyId: github.notifications.keyId,
      boundServer: '',
    })
  })

  it('carries each MCP server as its own entry, with the token it points at', () => {
    const server = {
      id: 'm1',
      name: 'Context',
      url: 'https://mcp.example/mcp',
      enabled: true,
      keyId: 'abele-mcp-m1',
      headers: { 'X-Team': '${abele_key:team}' },
      tools: [{ name: 'lookup', description: 'Looks up.', inputSchema: { type: 'object' } }],
      fetchedAt: '2026-09-26T10:00:00.000Z',
    }
    const bare = { ...server, id: 'm2', name: 'Open', keyId: '' }
    const base = settings()
    const entries = collectEntries({
      ...base,
      ai: { ...base.ai, mcpServers: [server, bare] },
    } as AbeleSettings)

    const entry = find(entries, 'ai-mcp-servers', 'm1')
    expect(entry?.label).toBe('Context')
    expect(entry?.data).toEqual(server)
    expect(entry?.secretIds).toEqual(['abele-mcp-m1'])
    expect(find(entries, 'ai-mcp-servers', 'm2')?.secretIds).toEqual([])
    expect(applyEntries([entry!], settings()).ai.mcpServers).toEqual([server])
  })

  it('carries the book reader settings', () => {
    const reader = {
      ...DEFAULT_READER_SETTINGS,
      fontSize: 135,
      flow: 'scrolled' as const,
      // Where the places of books are kept travels too: every device reads the same file.
      placesPath: 'Books/places.json',
      // And the scripts chosen for words selected in a book, in their order.
      selectionScripts: [
        { script: 'Word card', name: 'Card', icon: 'star' },
        { script: 'Translate', name: '', icon: '' },
      ],
      // And how thick the pen draws on a PDF.
      pdfInkThickness: 'bold' as const,
      // And on a drawing, chosen apart.
      drawingInkThickness: 'fine' as const,
      // And a font from the vault, with the folder it is kept in.
      font: 'vault:Literata' as const,
      fontsFolder: 'Books/Fonts',
    }
    const entries = collectEntries(settings({ reader }))
    const entry = find(entries, 'reader', 'reader')

    expect(entry?.data).toEqual({ reader })
    expect(applyEntries([entry!], settings()).reader).toEqual(reader)
  })

  it('carries the quick button, the actions of its menu with it', () => {
    const quickButton = {
      enabled: true,
      tablet: false,
      side: 'left' as const,
      lift: 120,
      actions: [
        {
          id: 'a1',
          type: 'command' as const,
          commandId: 'daily-notes',
          scriptName: '',
          name: 'Today',
          icon: 'calendar',
        },
      ],
    }
    const entries = collectEntries(settings({ quickButton }))
    const entry = find(entries, 'quick-button', 'quick-button')

    expect(entry?.label).toBe('Quick button')
    expect(entry?.data).toEqual({ quickButton })
    expect(applyEntries([entry!], settings()).quickButton).toEqual(quickButton)
  })

  it('carries the linter, every rule set up with it', () => {
    const linter = {
      exclude: ['Templates'],
      rules: {
        'no-tags': {
          enabled: true,
          severity: 'warning' as const,
          folders: ['Notes'],
          exclude: [],
          types: ['task'],
          property: '',
          value: '',
          params: { inline: false },
        },
      },
    }
    const entries = collectEntries(settings({ linter }))
    const entry = find(entries, 'linter', 'linter')

    expect(entry?.label).toBe('Linter')
    expect(entry?.data).toEqual({ linter })
    expect(applyEntries([entry!], settings()).linter).toEqual(linter)
  })

  /**
   * The section lists the keys it carries by name, so anything added to the settings after it
   * was written is silently left behind. Voice input was exactly that.
   */
  it('carries what the accounts panel shows', () => {
    const accountsList = {
      sort: 'name' as const,
      groupByType: false,
      types: ['asset' as const],
      hideZero: false,
      showExcluded: false,
      currency: 'USD',
    }
    const finance = find(collectEntries(settings({ accountsList })), 'finance', 'finance')
    expect((finance?.data as Record<string, unknown>)?.accountsList).toEqual(accountsList)
  })

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

  /**
   * The prompts block carries `['prompts']` wholesale, so a new prompt travels for free — but
   * only for as long as nobody rebuilds that object key by key somewhere. This is that guard.
   */
  it('carries a prompt added after the block was written, and writes it where it lands', () => {
    const source = settings({
      ai: {
        ...settings().ai!,
        prompts: { recapPrompt: 'Say what was done to {{messages}}' },
      } as unknown as AiSettings,
    })

    const arriving = collectEntries(source).filter((e) => e.section === 'ai-prompts')
    const next = applyEntries(arriving, settings())

    expect(next.ai?.prompts?.recapPrompt).toBe('Say what was done to {{messages}}')
  })

  /** Memory lives on the agent, so it travels with it and lands with it. */
  it('carries what an agent was asked to remember, and the template that shows it', () => {
    const memory = [{ id: 'm1', text: 'Answer in Russian', created: '2026-09-23' }]
    const source = settings({
      ai: {
        ...settings().ai!,
        agents: [{ id: 'a1', name: 'Writer', description: '', utility: false, memory }],
        prompts: { memoryTemplate: 'Known:\n{{memory}}' },
      } as unknown as AiSettings,
    })

    const arriving = collectEntries(source).filter(
      (e) => e.section === 'ai-agents' || e.section === 'ai-prompts'
    )
    const next = applyEntries(arriving, settings())

    expect((next.ai?.agents[0] as { memory?: unknown }).memory).toEqual(memory)
    expect(next.ai?.prompts?.memoryTemplate).toBe('Known:\n{{memory}}')
  })

  /** The agent's reviewer is part of the agent, so it lands with it. */
  it("carries an agent's interceptor and the context it is shown", () => {
    const source = settings({
      ai: {
        ...settings().ai!,
        agents: [
          { id: 'r1', name: 'Reviewer', description: '', utility: true },
          {
            id: 'a1',
            name: 'Writer',
            description: '',
            utility: false,
            interceptorAgentId: 'r1',
            interceptorContextDepth: 10,
          },
        ],
      } as unknown as AiSettings,
    })

    const arriving = collectEntries(source).filter((e) => e.section === 'ai-agents')
    const next = applyEntries(arriving, settings())
    const writer = next.ai?.agents.find((a) => a.id === 'a1')

    expect(writer?.interceptorAgentId).toBe('r1')
    expect(writer?.interceptorContextDepth).toBe(10)
  })

  /** An agent id is not a key. Adding one must not add a slot to the keychain list. */
  it('asks the keychain for nothing extra on account of them', () => {
    const entries = collectEntries(
      settings({ ai: { ...settings().ai!, commentAgentId: 'u1' } as AiSettings })
    )

    expect(find(entries, 'ai-general', 'ai-general')?.secretIds).toEqual(['abele-brave-search'])
  })
})

describe('header buttons', () => {
  // Placement, the switch and the icon-only look were added to buttons after this list; they
  // are fields of the button rather than settings of their own, and must travel with it.
  it('arrive with where they show, the properties they ask for, whether they are on, and how they look', () => {
    const button = {
      id: 'b1',
      name: 'Tidy',
      icon: 'sparkles',
      noteTypes: ['note'],
      scriptName: 'Tidy note',
      params: { depth: '2' },
      enabled: false,
      iconOnly: true,
      allNotes: false,
      folders: ['Inbox', 'Notes/Daily'],
      conditions: [
        { property: 'status', test: 'not-equals' as const, value: 'done' },
        { property: 'due', test: 'filled' as const, value: '' },
      ],
      conditionMode: 'any' as const,
    }
    const arriving = collectEntries(settings({ headerButtons: [button] })).filter(
      (e) => e.section === 'header-buttons'
    )

    const next = applyEntries(arriving, settings())

    expect(next.headerButtons).toEqual([button])
  })

  it('arrive running the command they ran, with their tags and whether they show beyond notes', () => {
    const button = {
      id: 'c1',
      name: 'Bold',
      icon: 'bold',
      noteTypes: [],
      runs: 'command' as const,
      commandId: 'editor:toggle-bold',
      scriptName: '',
      params: {},
      allNotes: false,
      folders: ['Projects/*/Notes'],
      tags: ['work'],
      otherFiles: true,
    }
    const arriving = collectEntries(settings({ headerButtons: [button] })).filter(
      (e) => e.section === 'header-buttons'
    )

    expect(applyEntries(arriving, settings()).headerButtons).toEqual([
      { ...button, enabled: false },
    ])
  })
})

describe('automations', () => {
  it('each travel as its own entry, whole', () => {
    const rule = {
      id: 'a1',
      name: 'Log completed tasks',
      enabled: true,
      event: 'task.completed' as const,
      noteTypes: [],
      folders: ['Tasks'],
      property: 'area',
      value: 'home',
      scriptName: 'Log',
      params: { line: '{{title}}' },
      throttleSeconds: 10,
      includeExternal: true,
    }
    const arriving = collectEntries(settings({ automations: [rule] })).filter(
      (e) => e.section === 'automations'
    )

    expect(arriving.map((e) => e.label)).toEqual(['Log completed tasks'])
    expect(applyEntries(arriving, settings()).automations).toEqual([{ ...rule, enabled: false }])
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

  it('never carries a sync device token, whatever id an entry names', () => {
    const base = settings()
    const entries = collectEntries({
      ...base,
      ai: { ...base.ai, providers: [provider('p1', 'openwebui', 'abele-sync-device-1234')] },
    } as AbeleSettings)
    const chosen = [find(entries, 'ai-providers', 'p1')!]

    const payload = buildPayload(chosen, () => 'absd_device_token')

    expect(payload.secrets).toEqual({})
    expect(needsCode(payload)).toBe(false)
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

  it('is needed for a block that holds a credential of its own, keys or not', () => {
    const own: TransferEntry = {
      section: 'finance',
      id: 'finance',
      label: 'F',
      data: {},
      sensitive: true,
    }

    expect(needsCode(buildPayload([own], null))).toBe(true)
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

  it('carries the task label property and label colours with the tasks block', () => {
    const arriving = collectEntries(
      settings({
        taskLabelProperty: 'tags',
        taskLabelColors: [{ value: 'work', color: 'red' }],
      })
    ).filter((e) => e.section === 'tasks')

    const next = applyEntries(arriving, settings())

    expect(next.taskLabelProperty).toBe('tags')
    expect(next.taskLabelColors).toEqual([{ value: 'work', color: 'red' }])
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

/**
 * The synced secret store travels by sync, never by transfer. A transfer is a QR code on a
 * screen or a file sent over a chat; the store's passphrase is typed once on each device and
 * never leaves it, and the store itself is useless without it — so there is nothing in it a
 * transfer could usefully carry, and every reason to keep it off screens and out of files.
 */
describe('the synced secret store', () => {
  const store = { format: 'abele-secrets', v: 1, id: 'abcdef123456', entries: { data: 'ZZZ' } }

  it('is not something a transfer can carry', () => {
    const entries = collectEntries(settings({ secretStore: store }))
    expect(JSON.stringify(entries)).not.toContain('abcdef123456')
    expect(JSON.stringify(buildPayload(entries, () => 'value'))).not.toContain('ZZZ')
  })

  it('is left as it was by a transfer arriving, merged or replacing', () => {
    const here = settings({ secretStore: store })
    const arriving = collectEntries(settings())
    expect(applyEntries(arriving, here, 'merge').secretStore).toEqual(store)
    expect(applyEntries(arriving, here, 'replace').secretStore).toEqual(store)
  })
})

/**
 * The keys that arrived go where each one belongs. A provider's key is the user's, and with
 * the synced store open it enters the store like any key set by hand.
 *
 * A transfer made by an older build carries the sender's connection in the sync block, with
 * its device token. The connection is dropped on arrival — it is the sender's identity, and
 * the settings no longer hold one — so the token has nothing to go with and is put nowhere:
 * not the keychain, where it would sit unused, and never the store, which would hand it to
 * every other device.
 */
describe('the keys that arrived', () => {
  afterEach(() => setSecrets(null))

  /** The sync block as an older build sent it: the sender's connection and its token's name. */
  const olderSyncEntry = (secretIds = ['abele-sync-device-1']): TransferEntry => ({
    section: 'sync',
    id: 'sync',
    label: 'Sync',
    data: {
      sync: {
        serverUrl: 'https://sync.example.com',
        vaultId: 'v1',
        deviceTokenId: secretIds[0],
        keySignature: null,
      },
    },
    secretIds,
    sensitive: true,
  })

  async function unlockedStore() {
    const keychain = new Map<string, string>()
    const chain: Keychain = {
      getSecret: (id) => keychain.get(id) ?? null,
      setSecret: (id, value) => void keychain.set(id, value),
      deleteSecret: (id) => keychain.delete(id),
    }
    let file: unknown = null
    const store = new SecretStore({
      keychain: () => chain,
      read: () => file,
      write: async (next) => {
        file = next
      },
      ids: () => [],
      conflictCopies: async () => [],
      now: () => Date.now(),
    })
    await store.enable('passphrase', { iterations: 1000 })
    setSecrets(store)
    return { store, keychain }
  }

  it('puts an older transfer’s sync device token nowhere, and every other key in the store', async () => {
    const { store, keychain } = await unlockedStore()
    const arriving = [
      olderSyncEntry(),
      ...collectEntries(settings()).filter((e) => e.section === 'ai-providers'),
    ]

    const refused = storeReceivedKeys(arriving, {
      'abele-sync-device-1': 'absd_token',
      'key-p1': 'sk-provider',
    })
    await store.flush()

    expect(refused).toBe(0)
    expect(keychain.has('abele-sync-device-1')).toBe(false)
    expect(store.contents()!.map((c) => c.id)).toEqual(['key-p1'])
  })

  it('writes no key at all under the sync block, whatever its name', async () => {
    const { store, keychain } = await unlockedStore()
    keychain.set('abele-brave-search', 'BSA-mine')

    storeReceivedKeys([olderSyncEntry(['abele-brave-search'])], {
      'abele-brave-search': 'absd_foreign',
    })
    await store.flush()

    expect(keychain.get('abele-brave-search')).toBe('BSA-mine')
    expect(store.contents()!.map((c) => c.id)).toEqual([])
  })

  /** A section of no device's own cannot slip a device token into the store either. */
  it('never files a sync device token in the store, under any section', async () => {
    const { store, keychain } = await unlockedStore()
    const [entry] = collectEntries(settings()).filter((e) => e.section === 'ai-providers')

    storeReceivedKeys([{ ...entry!, secretIds: ['abele-sync-device-9'] }], {
      'abele-sync-device-9': 'absd_token',
    })
    await store.flush()

    expect(store.contents()!.map((c) => c.id)).toEqual([])
    expect(keychain.has('abele-sync-device-9')).toBe(false)
  })

  it('keeps the sync device token out of a store locked here, once it is unlocked', async () => {
    // Another device made the store; this one has not been given the passphrase yet. A key
    // set now waits in memory for the unlock, so a token sent down the store's road would
    // only show up there.
    let file: unknown = null
    const host = (chain: Keychain) => ({
      keychain: () => chain,
      read: () => file,
      write: async (next: unknown) => {
        file = next
      },
      ids: () => [],
      conflictCopies: async () => [],
      now: () => Date.now(),
    })
    const mapChain = (keychain: Map<string, string>): Keychain => ({
      getSecret: (id) => keychain.get(id) ?? null,
      setSecret: (id, value) => void keychain.set(id, value),
      deleteSecret: (id) => keychain.delete(id),
    })
    await new SecretStore(host(mapChain(new Map()))).enable('passphrase', { iterations: 1000 })
    const keychain = new Map<string, string>()
    const store = new SecretStore(host(mapChain(keychain)))
    await store.load()
    expect(store.status.value).toBe('locked')
    setSecrets(store)
    const arriving = [
      olderSyncEntry(),
      ...collectEntries(settings()).filter((e) => e.section === 'ai-providers'),
    ]

    storeReceivedKeys(arriving, { 'abele-sync-device-1': 'absd_token', 'key-p1': 'sk-provider' })
    expect(await store.unlock('passphrase')).toBe(true)
    await store.flush()

    expect(store.contents()!.map((c) => c.id)).toEqual(['key-p1'])
    expect(keychain.has('abele-sync-device-1')).toBe(false)
  })

  it('leaves alone a key that did not travel, and counts one the keychain refuses', () => {
    const keychain = new Map<string, string>([['key-p1', 'sk-kept']])
    setSecrets(
      new SecretStore({
        keychain: () => ({
          getSecret: (id) => keychain.get(id) ?? null,
          // Obsidian's rule for a key's name: lowercase letters, digits and dashes.
          setSecret: (id, value) => {
            if (!/^[a-z0-9-]+$/.test(id)) throw new Error('invalid id')
            keychain.set(id, value)
          },
        }),
        read: () => null,
        write: async () => {},
        ids: () => [],
        conflictCopies: async () => [],
        now: () => Date.now(),
      })
    )
    const arriving = collectEntries(
      settings({
        ai: { providers: [provider('p1', 'kept'), provider('p2', 'refused', 'BAD ID')] },
      } as unknown as Partial<AbeleSettings>)
    ).filter((e) => e.section === 'ai-providers')

    expect(storeReceivedKeys(arriving, { 'BAD ID': 'x' })).toBe(1)
    expect(keychain.get('key-p1')).toBe('sk-kept')
  })
})
