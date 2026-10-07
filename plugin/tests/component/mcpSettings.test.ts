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
import { mcpKeyId } from '@/ai/mcp/settings'
import { mcpPermissionKey } from '@/ai/mcp/permissions'
import { secrets } from '@/secrets/SecretStore'
import { useVault } from '../helpers/testEnv'
import { setRequestGuard } from '@/helpers/http'
import { checkRequestDestinations, initializeDestinations, keyFor } from '@/secrets/destinations'

const { requestUrl } = vi.hoisted(() => ({ requestUrl: vi.fn() }))
vi.mock('obsidian', async (original) => ({
  ...(await original<typeof import('obsidian')>()),
  requestUrl,
}))

const TOOLS: McpToolSnapshot[] = [
  { name: 'lookup', title: 'Look up', description: 'Finds a thing.', inputSchema: {} },
  { name: 'fetch_page', description: 'Reads a page.', inputSchema: {} },
]

beforeEach(() => {
  useVault([])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, agents: [], mcpServers: [] }
  AbeleConfig.getInstance().saveSettings = vi.fn(async () => {})
  McpService.getInstance().reset()
  setRequestGuard((request) => checkRequestDestinations(request, AbeleConfig.getInstance()))
  requestUrl.mockImplementation(async ({ body }: { body: string }) => {
    const message = JSON.parse(body)
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      text: JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        result: message.method === 'tools/list' ? { tools: TOOLS } : {},
      }),
    }
  })
})

afterEach(() => {
  setRequestGuard(undefined)
  McpService.getInstance().reset()
  vi.restoreAllMocks()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
})

const STUBS = {
  ObsidianModal: { template: '<div class="modal-stub"><slot /><slot name="footer" /></div>' },
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
    expect(saved.keyId).toBe(mcpKeyId(saved.id))
    expect(saved.keyId).toMatch(/^[a-z0-9-]+$/)
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
    expect(saved.keyId).toBe(mcpKeyId(saved.id))
    expect(saved.keyId).toMatch(/^[a-z0-9-]+$/)
    expect(secrets().get(saved.keyId)).toBe('tok-abcdefgh-1234')
  })

  it.each([true, false])(
    'fetches before saving the server when its token tick is pressed (address entered first: %s)',
    async (addressFirst) => {
      const view = mountTab()
      await buttonNamed(view, 'Add server').trigger('click')
      await field(view, 'Name').find('input').setValue('Sample')
      if (addressFirst) await field(view, 'URL').find('input').setValue('https://draft.example/mcp')
      await field(view, 'Token').find('input').setValue('fake-draft-token')
      await field(view, 'Token')
        .find('.abele-secret-field__row .abele-obsidian-icon')
        .trigger('click')
      if (!addressFirst)
        await field(view, 'URL').find('input').setValue('https://draft.example/mcp')
      expect(field(view, 'Token').find('input').element.value).toBe('')

      await buttonNamed(view, 'Fetch tools').trigger('click')
      await flushPromises()

      expect(view.find('.abele-mcp-server__error').exists()).toBe(false)
      expect(view.text()).toContain('Look up')
      expect(requestUrl).toHaveBeenCalledTimes(2)
      for (const [request] of requestUrl.mock.calls)
        expect(request).toMatchObject({
          url: 'https://draft.example/mcp',
          headers: { Authorization: 'Bearer fake-draft-token' },
        })
      expect(servers()).toEqual([])
      expect(AbeleConfig.getInstance().saveSettings).not.toHaveBeenCalled()

      await buttonNamed(view, 'Save').trigger('click')
      const [saved] = servers()
      expect(saved.tools).toEqual(TOOLS)
      expect(keyFor(saved.keyId, saved.url, AbeleConfig.getInstance())).toBe('fake-draft-token')
      expect(() =>
        keyFor(saved.keyId, 'https://other.example/mcp', AbeleConfig.getInstance())
      ).toThrow(/configured/)
      view.unmount()
    }
  )

  it('does not fetch with a saved token at an unsaved replacement address', async () => {
    const saved = createMcpServer({
      id: 'sample',
      name: 'Sample',
      url: 'https://saved.example/mcp',
      keyId: 'abele-mcp-sample',
    })
    servers().push(saved)
    secrets().set(saved.keyId, 'fake-saved-token')
    initializeDestinations(AbeleConfig.getInstance())
    const view = mountTab()
    await view.find('.abele-card').trigger('click')
    await field(view, 'URL').find('input').setValue('https://other.example/mcp')
    await buttonNamed(view, 'Fetch tools').trigger('click')
    await flushPromises()

    expect(view.find('.abele-mcp-server__error').text()).toMatch(/configured/)
    expect(requestUrl).not.toHaveBeenCalled()
    expect(servers()[0].url).toBe(saved.url)

    // Re-entering the same stored value must not bypass the request-level binding either.
    await field(view, 'Token').find('input').setValue('fake-saved-token')
    await field(view, 'Token')
      .find('.abele-secret-field__row .abele-obsidian-icon')
      .trigger('click')
    await buttonNamed(view, 'Fetch tools').trigger('click')
    await flushPromises()
    expect(view.find('.abele-mcp-server__error').text()).toMatch(/configured/)
    expect(requestUrl).not.toHaveBeenCalled()
    view.unmount()
  })

  it('forgets a ticked draft token for fetching and saving', async () => {
    const view = mountTab()
    await buttonNamed(view, 'Add server').trigger('click')
    await field(view, 'Name').find('input').setValue('Sample')
    await field(view, 'URL').find('input').setValue('https://draft.example/mcp')
    await field(view, 'Token').find('input').setValue('fake-forgotten-token')
    await field(view, 'Token')
      .find('.abele-secret-field__row .abele-obsidian-icon')
      .trigger('click')
    await field(view, 'Token')
      .find('.abele-secret-field__row .abele-obsidian-icon')
      .trigger('click')
    await buttonNamed(view, 'Fetch tools').trigger('click')
    await flushPromises()
    expect(view.text()).toContain('Look up')
    for (const [request] of requestUrl.mock.calls)
      expect(request.headers.Authorization).toBeUndefined()
    await buttonNamed(view, 'Save').trigger('click')
    expect(servers()[0].keyId).toBe('')
    view.unmount()
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

    expect(registry.get(agent.id)?.toolModes).toMatchObject({
      [mcpPermissionKey('a', 'lookup')]: 'ask',
    })
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
      [mcpPermissionKey('a', 'fetch_page'), 'ask'],
      [mcpPermissionKey('a', 'lookup'), 'ask'],
    ])
  })

  it('takes them all away again', async () => {
    const view = mountModes({
      [mcpPermissionKey('a', 'lookup')]: 'auto',
      [mcpPermissionKey('a', 'fetch_page')]: 'off',
    })
    const row = view
      .findAll('.setting-item')
      .find((r) => r.find('.setting-item-name').text() === 'Use this server')!

    expect(row.find('.checkbox-container').classes()).toContain('is-enabled')
    await row.find('.checkbox-container').trigger('click')

    expect(view.emitted('update')?.sort()).toEqual([
      [mcpPermissionKey('a', 'fetch_page'), 'off'],
      [mcpPermissionKey('a', 'lookup'), 'off'],
    ])
  })

  it('shows the server as a group of its own', () => {
    const view = mountModes({})

    expect(view.findAll('h4').map((h) => h.text())).toContain('MCP · Context')
  })
})
