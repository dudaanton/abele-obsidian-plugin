/**
 * The MCP tab of the AI settings: the servers as cards, the dialog behind one, and the switch in
 * an agent's tools that gives it a whole server at once.
 *
 * happy-dom computes no layout, so these assert what reaches the DOM and what is saved — never
 * how it looks; that is the settings layout probe's job in the running app.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import McpSettings from '@/components/settings/ai/McpSettings.vue'
import ToolModesEditor from '@/components/ToolModesEditor.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { McpService } from '@/ai/mcp/McpService'
import { createMcpServer, type McpToolSnapshot } from '@/ai/mcp/types'
import { secrets } from '@/secrets/SecretStore'
import { useVault } from '../helpers/testEnv'

const TOOLS: McpToolSnapshot[] = [
  { name: 'lookup', title: 'Look up', description: 'Finds a thing.', inputSchema: {} },
  { name: 'fetch_page', description: 'Reads a page.', inputSchema: {} },
]

beforeEach(() => {
  useVault([])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, agents: [], mcpServers: [] }
  AbeleConfig.getInstance().saveSettings = vi.fn(async () => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
})

const STUBS = {
  ObsidianModal: { template: '<div class="modal-stub"><slot /></div>' },
  ConfirmModal: {
    props: ['title', 'message'],
    emits: ['confirm', 'close'],
    template: '<div class="confirm-stub" @click="$emit(\'confirm\')" />',
  },
}

const mountTab = () => mount(McpSettings, { global: { stubs: STUBS } })

const buttonNamed = (view: ReturnType<typeof mountTab>, text: string) => {
  const button = view.findAll('button').find((b) => b.text() === text)
  if (!button) throw new Error(`no button ${text}`)
  return button
}

const field = (view: ReturnType<typeof mountTab>, setting: string) => {
  const row = view
    .findAll('.setting-item')
    .find((r) => r.find('.setting-item-name').text() === setting)
  if (!row) throw new Error(`no setting ${setting}`)
  return row
}

const servers = () => AbeleConfig.getInstance().ai.mcpServers ?? []

describe('the list of servers', () => {
  it('says there are none yet', () => {
    const view = mountTab()

    expect(view.find('.abele-empty-state').exists()).toBe(true)
  })

  it('shows each server with its address, how many tools it has and whether it is on', () => {
    AbeleConfig.getInstance().ai.mcpServers = [
      createMcpServer({
        id: 'a',
        name: 'Context',
        url: 'https://mcp.example/mcp',
        tools: TOOLS,
        fetchedAt: '2026-09-26T10:00:00.000Z',
      }),
      createMcpServer({ id: 'b', name: 'Idle', url: 'http://127.0.0.1:9/mcp', enabled: false }),
    ]

    const view = mountTab()

    const cards = view.findAll('.abele-card')
    expect(cards.map((c) => c.find('.abele-card__name').text())).toEqual(['Context', 'Idle'])
    expect(cards[0].find('.abele-card__subtitle').text()).toBe('https://mcp.example/mcp')
    expect(cards[0].find('.abele-card__meta').text()).toContain('2 tools')
    expect(cards[1].findAll('.abele-badge').map((b) => b.text())).toEqual(
      expect.arrayContaining(['off', 'not fetched'])
    )
  })

  it('removes a server once the removal is confirmed', async () => {
    AbeleConfig.getInstance().ai.mcpServers = [
      createMcpServer({ id: 'a', name: 'Context', url: 'x' }),
    ]
    const view = mountTab()

    await view.find('.abele-card__actions .abele-obsidian-icon').trigger('click')
    await view.find('.confirm-stub').trigger('click')

    expect(servers()).toEqual([])
  })
})

describe('adding one', () => {
  it('fetches its tools, shows them, and saves the server with them and its token', async () => {
    const fetchTools = vi.spyOn(McpService.getInstance(), 'fetchTools').mockResolvedValue(TOOLS)
    const view = mountTab()

    await buttonNamed(view, 'Add server').trigger('click')
    await field(view, 'Name').find('input').setValue('Context')
    await field(view, 'URL').find('input').setValue('https://mcp.example/mcp')
    await field(view, 'Token').find('input').setValue('tok-1')
    await field(view, 'Headers').find('textarea').setValue('X-Team: blue')
    await buttonNamed(view, 'Fetch tools').trigger('click')
    await flushPromises()

    expect(fetchTools).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://mcp.example/mcp', headers: { 'X-Team': 'blue' } }),
      { token: 'tok-1' }
    )
    expect(view.text()).toContain('Look up')
    expect(view.text()).toContain('Reads a page.')

    await buttonNamed(view, 'Save').trigger('click')

    const [saved] = servers()
    expect(saved).toMatchObject({
      name: 'Context',
      url: 'https://mcp.example/mcp',
      enabled: true,
      headers: { 'X-Team': 'blue' },
      tools: TOOLS,
    })
    expect(saved.fetchedAt).toBeTruthy()
    expect(saved.keyId).toBe(`abele-mcp-${saved.id}`)
    expect(secrets().get(saved.keyId)).toBe('tok-1')
  })

  it('stores a token the moment its tick is pressed, and shows it masked', async () => {
    const view = mountTab()

    await buttonNamed(view, 'Add server').trigger('click')
    await field(view, 'Token').find('input').setValue('tok-abcdefgh-1234')
    await field(view, 'Token')
      .find('.abele-secret-field__row .abele-obsidian-icon')
      .trigger('click')

    const stored = field(view, 'Token').find('.abele-secret-field__value')
    expect(stored.text()).toBe('tok-••••1234')
    await field(view, 'Name').find('input').setValue('Context')
    await field(view, 'URL').find('input').setValue('https://mcp.example/mcp')
    await buttonNamed(view, 'Save').trigger('click')

    const [saved] = servers()
    expect(saved.keyId).toBe(`abele-mcp-${saved.id}`)
    expect(secrets().get(saved.keyId)).toBe('tok-abcdefgh-1234')
  })

  it('says why fetching failed', async () => {
    vi.spyOn(McpService.getInstance(), 'fetchTools').mockRejectedValue(
      new Error('The server answered HTTP 401: unauthorized')
    )
    const view = mountTab()

    await buttonNamed(view, 'Add server').trigger('click')
    await field(view, 'Name').find('input').setValue('Context')
    await field(view, 'URL').find('input').setValue('https://mcp.example/mcp')
    await buttonNamed(view, 'Fetch tools').trigger('click')
    await flushPromises()

    expect(view.text()).toContain('HTTP 401')
  })

  it('will not save a name another server already gives its tools', async () => {
    AbeleConfig.getInstance().ai.mcpServers = [
      createMcpServer({ id: 'a', name: 'Context', url: 'x' }),
    ]
    const view = mountTab()

    await buttonNamed(view, 'Add server').trigger('click')
    await field(view, 'Name').find('input').setValue('context')
    await field(view, 'URL').find('input').setValue('https://other.example/mcp')

    expect(buttonNamed(view, 'Save').attributes('disabled')).toBeDefined()
  })
})

describe('renaming one', () => {
  it('takes the agents’ choices about its tools along', async () => {
    const registry = AgentRegistry.getInstance()
    const agent = registry.create({ name: 'Writer', toolModes: { mcp_context_lookup: 'ask' } })
    AbeleConfig.getInstance().ai.mcpServers = [
      createMcpServer({ id: 'a', name: 'Context', url: 'https://mcp.example/mcp', tools: TOOLS }),
    ]
    const view = mountTab()

    await view.find('.abele-card').trigger('click')
    await field(view, 'Name').find('input').setValue('Docs')
    await buttonNamed(view, 'Save').trigger('click')

    expect(registry.get(agent.id)?.toolModes).toMatchObject({ mcp_docs_lookup: 'ask' })
    expect(registry.get(agent.id)?.toolModes.mcp_context_lookup).toBeUndefined()
  })
})

describe('giving an agent a server', () => {
  beforeEach(() => {
    AbeleConfig.getInstance().ai.mcpServers = [
      createMcpServer({ id: 'a', name: 'Context', url: 'https://mcp.example/mcp', tools: TOOLS }),
    ]
  })

  const mountModes = (toolModes: Record<string, 'off' | 'ask' | 'auto'>) =>
    mount(ToolModesEditor, {
      props: { toolModes, hideShowAll: true },
      global: {
        stubs: {
          Dropdown: { props: ['modelValue', 'options'], template: '<div class="dropdown-stub" />' },
        },
      },
    })

  it('is one switch per server, putting all its tools at Ask', async () => {
    const view = mountModes({})
    const row = view
      .findAll('.setting-item')
      .find((r) => r.find('.setting-item-name').text() === 'Use this server')!

    expect(row.find('.checkbox-container').classes()).not.toContain('is-enabled')
    await row.find('.checkbox-container').trigger('click')

    expect(view.emitted('update')?.sort()).toEqual([
      ['mcp_context_fetch_page', 'ask'],
      ['mcp_context_lookup', 'ask'],
    ])
  })

  it('takes them all away again', async () => {
    const view = mountModes({ mcp_context_lookup: 'auto', mcp_context_fetch_page: 'off' })
    const row = view
      .findAll('.setting-item')
      .find((r) => r.find('.setting-item-name').text() === 'Use this server')!

    expect(row.find('.checkbox-container').classes()).toContain('is-enabled')
    await row.find('.checkbox-container').trigger('click')

    expect(view.emitted('update')?.sort()).toEqual([
      ['mcp_context_fetch_page', 'off'],
      ['mcp_context_lookup', 'off'],
    ])
  })

  it('shows the server as a group of its own', () => {
    const view = mountModes({})

    expect(view.findAll('h4').map((h) => h.text())).toContain('MCP · Context')
  })
})
