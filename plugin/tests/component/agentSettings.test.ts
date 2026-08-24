/**
 * The agents screen: the list of agents and the editor behind a card.
 *
 * happy-dom computes no layout, so these assert what reaches the DOM and what the components do
 * with it — never how it looks. Whether anything overflows is settled in the running app, by
 * measuring rectangles against their container.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import AgentsSettings from '@/components/settings/ai/AgentsSettings.vue'
import AgentEditorModal from '@/components/settings/ai/AgentEditorModal.vue'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiProvider } from '@/ai/types'
import Input from '@/components/obsidian/Input.vue'
import { useVault } from '../helpers/testEnv'

const provider: AiProvider = {
  id: 'p1',
  name: 'Provider',
  baseUrl: 'http://localhost/v1',
  apiKeyId: 'k',
  models: [{ id: 'big', name: 'Big', contextWindow: 100, maxTokens: 10, supportsReasoning: false }],
}

beforeEach(() => {
  useVault([])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    providers: [provider],
    agents: [],
    defaultAgentId: '',
  }
  AbeleConfig.getInstance().saveSettings = vi.fn(async () => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * The kit renders for real here — a card, a badge and a tab strip are exactly what these
 * screens are made of, so stubbing them would leave nothing worth asserting. Only the pieces
 * that reach into Obsidian's own widget classes are stood in for.
 */
const OBSIDIAN_WIDGETS = {
  Dropdown: { props: ['modelValue', 'options'], template: '<div class="dropdown-stub" />' },
  Search: { props: ['modelValue'], template: '<div class="search-stub" />' },
  AiScopeEditor: true,
  ToolModesEditor: true,
}

function mountList() {
  return mount(AgentsSettings, {
    global: { stubs: { ...OBSIDIAN_WIDGETS, AgentEditorModal: true } },
  })
}

function mountEditor(agentId: string) {
  return mount(AgentEditorModal, {
    props: { agentId },
    global: {
      stubs: {
        ...OBSIDIAN_WIDGETS,
        // The editor's content lives in the modal's slot; a stub that drops it would leave
        // the whole form unrendered.
        ObsidianModal: { template: '<div class="modal-stub"><slot /></div>' },
      },
    },
  })
}

function seedAgents() {
  const registry = AgentRegistry.getInstance()
  const main = registry.create({
    name: 'Researcher',
    description: 'Reads sources',
    providerId: 'p1',
    modelId: 'big',
    prompts: [{ type: 'text', value: 'Research well.' }],
    scope: [{ type: 'folder', path: 'Sources' }],
  })
  registry.setDefault(main.id)
  const helper = registry.create({ name: 'Titler', utility: true })
  return { main, helper }
}

describe('the agents list', () => {
  it('shows every agent, utility ones included', () => {
    seedAgents()

    const view = mountList()

    expect(view.findAll('.abele-card__name').map((n) => n.text())).toEqual(['Researcher', 'Titler'])
  })

  it('marks which agent is the default and which are utility', () => {
    seedAgents()

    const view = mountList()

    const cards = view.findAll('.abele-card')
    expect(cards[0].findAll('.abele-badge').map((b) => b.text())).toEqual(['default'])
    expect(cards[1].findAll('.abele-badge').map((b) => b.text())).toEqual(['utility'])
  })

  it('summarises the model, the prompts and the scope', () => {
    seedAgents()

    const view = mountList()

    const meta = view.findAll('.abele-card')[0].findAll('.abele-card__meta span')
    expect(meta.map((m) => m.text())).toEqual(['Big', '1 prompt', '1 scope entry'])
  })

  it('says so plainly when an agent has no model yet', () => {
    AgentRegistry.getInstance().create({ name: 'Fresh' })

    const view = mountList()

    expect(view.find('.abele-card__meta').text()).toContain('no model')
  })

  it('opens the editor when a card is pressed', async () => {
    const { main } = seedAgents()
    const view = mountList()

    await view.findAll('.abele-card')[0].trigger('click')

    expect(view.findComponent(AgentEditorModal).props('agentId')).toBe(main.id)
  })

  it('adds an agent and opens it for editing', async () => {
    seedAgents()
    const view = mountList()

    await view.findComponent({ name: 'Button' }).vm.$emit('click')

    expect(AgentRegistry.getInstance().list({ includeUtility: true })).toHaveLength(3)
    expect(view.findComponent(AgentEditorModal).exists()).toBe(true)
  })

  it('refuses to remove the last agent, and says so by disabling the action', () => {
    AgentRegistry.getInstance().create({ name: 'Only one' })

    const view = mountList()

    const trash = view.findAll('.abele-card__actions .abele-obsidian-icon')[2]
    expect(trash.classes()).toContain('abele-obsidian-icon_disabled')
  })

  it('offers no way to make the default agent default again', () => {
    seedAgents()

    const view = mountList()

    const star = view.findAll('.abele-card')[0].findAll('.abele-obsidian-icon')[0]
    expect(star.classes()).toContain('abele-obsidian-icon_disabled')
  })
})

describe('the agent editor', () => {
  it('offers every section', () => {
    const { main } = seedAgents()

    const view = mountEditor(main.id)

    expect(view.findAll('.abele-tabs__tab').map((t) => t.text())).toEqual([
      'Basic',
      'Prompts',
      'Access',
      'Skills',
      'Delegation',
    ])
  })

  it('opens on the first section', () => {
    const { main } = seedAgents()

    const view = mountEditor(main.id)

    expect(view.find('.abele-tabs__tab_active').text()).toBe('Basic')
    expect(view.find('.setting-item-name').text()).toBe('Name')
  })

  it('moves to another section when its tab is pressed', async () => {
    const { main } = seedAgents()
    const view = mountEditor(main.id)

    await view.findAll('.abele-tabs__tab')[1].trigger('click')

    expect(view.find('.abele-tabs__tab_active').text()).toBe('Prompts')
    expect(view.findAll('.abele-card__name').map((c) => c.text())).toEqual(['Block 1'])
  })

  it('says when an agent has no instructions of its own', async () => {
    const bare = AgentRegistry.getInstance().create({ name: 'Bare' })
    const view = mountEditor(bare.id)

    await view.findAll('.abele-tabs__tab')[1].trigger('click')

    expect(view.find('.abele-empty-state').text()).toContain('no instructions of its own')
  })

  it('writes an edit straight through to the stored agent', async () => {
    const { main } = seedAgents()
    const view = mountEditor(main.id)

    await view.findAllComponents(Input)[0].vm.$emit('update:model-value', 'Renamed')

    // Straight through, not into a draft: an open chat on this agent must see it at once.
    expect(AgentRegistry.getInstance().get(main.id)?.name).toBe('Renamed')
    expect(view.emitted('changed')).toBeTruthy()
  })

  it('reorders prompt blocks', async () => {
    const registry = AgentRegistry.getInstance()
    const agent = registry.create({
      name: 'Two blocks',
      prompts: [
        { type: 'text', value: 'first' },
        { type: 'text', value: 'second' },
      ],
    })
    const view = mountEditor(agent.id)
    await view.findAll('.abele-tabs__tab')[1].trigger('click')

    const secondCardActions = view.findAll('.abele-card__actions')[1]
    await secondCardActions.findAll('.abele-obsidian-icon')[0].trigger('click')

    expect(registry.get(agent.id)?.prompts.map((p) => p.value)).toEqual(['second', 'first'])
  })
})
