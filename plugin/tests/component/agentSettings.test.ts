/**
 * The agents screen: the list, and the editor's section navigation.
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

/** happy-dom has no ResizeObserver, and the editor measures itself with one. */
let observedWidth = 900
class FakeResizeObserver {
  constructor(private callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [{ target, contentRect: { width: observedWidth } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver
    )
  }
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  observedWidth = 900
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver

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
 * The editor's content lives inside the modal's slot, and a shallow mount would drop it. This
 * stub keeps the modal out of the way while still rendering what it wraps.
 */
const MODAL_STUB = {
  ObsidianModal: { template: '<div class="modal-stub"><slot /></div>' },
  // Setting wraps each control in its default slot; stubbed away, the controls never render.
  Setting: {
    props: ['name', 'desc'],
    template: '<div class="setting-stub"><span>{{ name }}</span><slot /></div>',
  },
}

function mountEditor(agentId: string) {
  return mount(AgentEditorModal, {
    props: { agentId },
    shallow: true,
    global: { stubs: MODAL_STUB },
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

    const view = mount(AgentsSettings, { shallow: true })

    const names = view.findAll('.abele-agent-card__name').map((n) => n.text())
    expect(names).toEqual(['Researcher', 'Titler'])
  })

  it('marks which agent is the default and which are utility', () => {
    seedAgents()

    const view = mount(AgentsSettings, { shallow: true })

    const cards = view.findAll('.abele-agent-card')
    expect(cards[0].findAll('.abele-agent-card__badge').map((b) => b.text())).toEqual(['default'])
    expect(cards[1].findAll('.abele-agent-card__badge').map((b) => b.text())).toEqual(['utility'])
  })

  it('summarises the model, the prompts and the scope', () => {
    seedAgents()

    const view = mount(AgentsSettings, { shallow: true })

    const meta = view.findAll('.abele-agent-card')[0].findAll('.abele-agent-card__meta span')
    expect(meta.map((m) => m.text())).toEqual(['Big', '1 prompt', '1 scope entry'])
  })

  it('says so plainly when an agent has no model yet', () => {
    AgentRegistry.getInstance().create({ name: 'Fresh' })

    const view = mount(AgentsSettings, { shallow: true })

    expect(view.find('.abele-agent-card__meta').text()).toContain('no model')
  })

  it('adds an agent and opens it for editing', async () => {
    seedAgents()
    const view = mount(AgentsSettings, { shallow: true })

    await view.findComponent({ name: 'Button' }).vm.$emit('click')

    expect(AgentRegistry.getInstance().list({ includeUtility: true })).toHaveLength(3)
    expect(view.findComponent(AgentEditorModal).exists()).toBe(true)
  })
})

describe('the agent editor', () => {
  it('offers every section', () => {
    const { main } = seedAgents()

    const view = mountEditor(main.id)

    const tabs = view.findAll('.abele-agent-editor__tab').map((t) => t.text())
    expect(tabs).toEqual(['Basic', 'Prompts', 'Access', 'Skills', 'Delegation'])
  })

  it('shows a section beside the nav when there is room', () => {
    const { main } = seedAgents()

    const view = mountEditor(main.id)

    expect(view.find('.abele-agent-editor__nav').exists()).toBe(true)
    expect(view.find('.abele-agent-editor__body').exists()).toBe(true)
    expect(view.find('.abele-agent-editor_narrow').exists()).toBe(false)
  })

  it('shows only the section list when the editor is narrow', async () => {
    // The width is measured from the element, not from a window: settings can live in their own
    // window, where this component's `window` is the wrong one entirely.
    observedWidth = 360
    const { main } = seedAgents()

    const view = mountEditor(main.id)
    await view.vm.$nextTick()

    expect(view.find('.abele-agent-editor_narrow').exists()).toBe(true)
    expect(view.find('.abele-agent-editor__nav').exists()).toBe(true)
    expect(view.find('.abele-agent-editor__body').exists()).toBe(false)
  })

  it('descends into a section and back out again on a narrow screen', async () => {
    observedWidth = 360
    const { main } = seedAgents()
    const view = mountEditor(main.id)
    await view.vm.$nextTick()

    await view.findAll('.abele-agent-editor__tab')[1].trigger('click')
    expect(view.find('.abele-agent-editor__body').exists()).toBe(true)
    expect(view.find('.abele-agent-editor__nav').exists()).toBe(false)

    await view.find('.abele-agent-editor__back').trigger('click')
    expect(view.find('.abele-agent-editor__nav').exists()).toBe(true)
    expect(view.find('.abele-agent-editor__body').exists()).toBe(false)
  })

  it('writes an edit straight through to the stored agent', async () => {
    const { main } = seedAgents()
    const view = mountEditor(main.id)

    const nameInput = view.findAllComponents(Input)[0]
    await nameInput.vm.$emit('update:modelValue', 'Renamed')

    // Straight through, not into a draft: an open chat on this agent must see it at once.
    expect(AgentRegistry.getInstance().get(main.id)?.name).toBe('Renamed')
    expect(view.emitted('changed')).toBeTruthy()
  })
})
