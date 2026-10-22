/**
 * The agents screen: the list of agents and the editor behind a card.
 *
 * happy-dom computes no layout, so these assert what reaches the DOM and what the components do
 * with it — never how it looks. Whether anything overflows is settled in the running app, by
 * measuring rectangles against their container.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { Menu } from 'obsidian'
import { newEntry } from '@/ai/interceptor/entries'
import AgentsSettings from '@/components/settings/ai/AgentsSettings.vue'
import AgentEditorModal from '@/components/settings/ai/AgentEditorModal.vue'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { ScriptService } from '@/scripting/ScriptService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiProvider } from '@/ai/types'
import Input from '@/components/obsidian/Input.vue'
import Dropdown from '@/components/obsidian/Dropdown.vue'
import ConfirmModal from '@/components/obsidian/ConfirmModal.vue'
import { useVault } from '../helpers/testEnv'
import { githubSettingsFrom } from '@/github/settings'

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
    global: {
      stubs: {
        ...OBSIDIAN_WIDGETS,
        AgentEditorModal: true,
        // The dialog's own behaviour is covered in the kit's tests; here what matters is
        // whether the screen asks at all, and what it does with the answer.
        ConfirmModal: { props: ['title', 'message'], template: '<div class="confirm-stub" />' },
      },
    },
  })
}

const trashOf = (view: ReturnType<typeof mountList>, idx: number) =>
  view.findAll('.abele-card')[idx].findAll('.abele-obsidian-icon')[2]

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

it.each(['forgejo', 'gitea'])('offers %s connection permissions starting Off', async (provider) => {
  const { main } = seedAgents()
  AbeleConfig.getInstance().github = githubSettingsFrom({
    connections: [
      {
        id: 'sample-native',
        provider,
        name: 'Sample native connection',
        server: 'https://git.example.test/team',
        keyId: '',
        owners: [],
        isDefault: true,
      },
    ],
  })
  const view = mountEditor(main.id)
  try {
    await view
      .findAll('.abele-tabs__tab')
      .find((tab) => tab.text() === 'Access')!
      .trigger('click')
    const row = view
      .findAll('.setting-item')
      .find((row) => row.text().includes('Sample native connection'))!
    const control = row.findComponent(Dropdown)
    expect(control.exists()).toBe(true)
    expect(control.props('modelValue')).toBe('off')
    control.vm.$emit('update:modelValue', 'ask')
    expect(main.githubConnections?.['sample-native']).toBe('ask')
  } finally {
    view.unmount()
  }
})

it('shows unsupported provider access as unavailable without an enable selector', async () => {
  const { main } = seedAgents()
  const row = {
    id: 'sample-github',
    name: 'Sample GitHub',
    server: '',
    keyId: '',
    owners: [],
    isDefault: true,
  }
  AbeleConfig.getInstance().github = githubSettingsFrom({
    connections: [
      row,
      {
        ...row,
        id: 'sample-forgejo',
        provider: 'gitlab',
        name: 'Sample Forgejo',
        server: 'https://git.example.test/team',
      },
    ],
  })
  const view = mountEditor(main.id)
  await view
    .findAll('.abele-tabs__tab')
    .find((tab) => tab.text() === 'Access')!
    .trigger('click')
  const other = view.findAll('.setting-item').find((row) => row.text().includes('Sample Forgejo'))!
  expect(other.text()).toMatch(/available in a later version/i)
  expect(other.findComponent(Dropdown).exists()).toBe(false)
  expect(
    view
      .findAll('.setting-item')
      .find((row) => row.text().includes('Sample GitHub'))!
      .findComponent(Dropdown)
      .exists()
  ).toBe(true)
  view.unmount()
})

it('offers tool discovery on the agent Access tab and saves the selection', async () => {
  const { main } = seedAgents()
  const view = mountEditor(main.id)
  const access = view.findAll('.abele-tabs__tab').find((tab) => tab.text() === 'Access')!
  await access.trigger('click')
  const discovery = view
    .findAllComponents(Dropdown)
    .find((d) => d.props('options').some((o: { value: string }) => o.value === 'all-at-once'))!
  // Sections are the default; an agent saved with the old default reads as sections too.
  expect(discovery.props('modelValue')).toBe('sections')
  await discovery.vm.$emit('update:modelValue', 'all-at-once')
  expect(AgentRegistry.getInstance().get(main.id)?.toolDiscovery).toBe('all-at-once')
  await discovery.vm.$emit('update:modelValue', 'sections')
  expect(AgentRegistry.getInstance().get(main.id)?.toolDiscovery).toBe('sections')
  view.unmount()
})

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

    const meta = view.findAll('.abele-card')[0].findAll('.abele-card__meta .abele-meta-line__value')
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

    expect(trashOf(view, 0).classes()).toContain('abele-obsidian-icon_disabled')
  })

  it('asks before deleting an agent, rather than deleting on the first click', async () => {
    seedAgents()
    const view = mountList()

    await trashOf(view, 0).trigger('click')

    expect(AgentRegistry.getInstance().list({ includeUtility: true })).toHaveLength(2)
    expect(view.findComponent(ConfirmModal).props('message')).toContain('Researcher')
  })

  it('deletes once the question is answered', async () => {
    const { main } = seedAgents()
    const view = mountList()
    await trashOf(view, 0).trigger('click')

    await view.findComponent(ConfirmModal).vm.$emit('confirm')

    expect(AgentRegistry.getInstance().get(main.id)).toBeNull()
  })

  it('keeps the agent when the question is dismissed', async () => {
    const { main } = seedAgents()
    const view = mountList()
    await trashOf(view, 0).trigger('click')

    await view.findComponent(ConfirmModal).vm.$emit('close')

    expect(AgentRegistry.getInstance().get(main.id)?.name).toBe('Researcher')
    expect(view.findComponent(ConfirmModal).exists()).toBe(false)
  })

  it('offers no way to make the default agent default again', () => {
    seedAgents()

    const view = mountList()

    const star = view.findAll('.abele-card')[0].findAll('.abele-obsidian-icon')[0]
    expect(star.classes()).toContain('abele-obsidian-icon_disabled')
  })
})

describe('the agent editor', () => {
  it('stores Off/Ask/On by connection ID without changing tool permissions or sharing a duplicate map', async () => {
    const { main } = seedAgents()
    const config = AbeleConfig.getInstance()
    config.github = {
      ...config.github,
      connections: [
        {
          id: 'sample',
          name: 'Sample connection',
          server: '',
          keyId: '',
          owners: [],
          isDefault: true,
        },
      ],
    }
    const before = { ...main.toolModes }
    const view = mountEditor(main.id)
    await view
      .findAll('.abele-tabs__tab')
      .find((t) => t.text() === 'Access')!
      .trigger('click')
    const setting = view
      .findAll('.setting-item')
      .find((s) => s.text().includes('Sample connection'))!
    const dropdown = setting.findComponent(Dropdown)
    expect(dropdown.props('modelValue')).toBe('off')
    dropdown.vm.$emit('update:model-value', 'ask')
    expect(main.githubConnections).toEqual({ sample: 'ask' })
    expect(main.toolModes).toEqual(before)
    const copy = AgentRegistry.getInstance().duplicate(main.id)!
    copy.githubConnections!.sample = 'auto'
    expect(main.githubConnections!.sample).toBe('ask')
    view.unmount()
  })

  it('offers every section', () => {
    const { main } = seedAgents()

    const view = mountEditor(main.id)

    expect(view.findAll('.abele-tabs__tab').map((t) => t.text())).toEqual([
      'Basic',
      'Prompts',
      'Memory',
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

/**
 * The agent's own reviewer, chosen beside its background model. Any agent may review — utility
 * ones are what most reviewers are — except the agent itself.
 */
describe("the agent's interceptors", () => {
  type Options = { value: string; display: string }[]
  type View = ReturnType<typeof mountEditor>
  /** The settings of the entry that is open, under its row. */
  const opened = (view: View) => view.find('.abele-interceptors__settings')
  const interceptorPicker = (view: View) =>
    opened(view).exists() ? opened(view).findAllComponents(Dropdown)[0] : undefined
  const contextPicker = (view: View) =>
    view
      .findAllComponents(Dropdown)
      .find((d) => (d.props('options') as Options).some((o) => o.display === 'Draft only'))
  /** Opens the first entry's settings, adding one when the list is empty. */
  async function openFirst(view: View) {
    const name = view.find('.abele-interceptors__name')
    if (name.exists()) await name.trigger('click')
    else
      await view
        .findAll('button')
        .find((b) => b.text().includes('Add interceptor'))!
        .trigger('click')
  }

  it('offers every other agent, utility ones included, and not the agent itself', async () => {
    const { main, helper } = seedAgents()
    const view = mountEditor(main.id)
    await openFirst(view)
    const options = interceptorPicker(view)!.props('options') as Options

    expect(options.map((o) => o.value)).toEqual([helper.id])
  })

  it('stores the choice on the agent, and only then asks how much it sees', async () => {
    const { main, helper } = seedAgents()
    const view = mountEditor(main.id)
    expect(contextPicker(view)).toBeUndefined()

    await openFirst(view)
    await interceptorPicker(view)!.vm.$emit('update:model-value', helper.id)
    await contextPicker(view)!.vm.$emit('update:model-value', '-1')

    const stored = AgentRegistry.getInstance().get(main.id)
    expect(stored?.interceptors).toMatchObject([{ agentId: helper.id, contextDepth: -1 }])
    expect(stored?.interceptorAgentId).toBe(helper.id)
    expect(stored?.interceptorContextDepth).toBe(-1)
  })

  it('offers the scripts marked @interceptor, and a script chosen asks nothing about context', async () => {
    const { main, helper } = seedAgents()
    ScriptService.getInstance().scriptList.value = [
      {
        path: 'Scripts/guard.js',
        meta: { name: 'Guard', description: '', params: [], interceptor: 30 },
        code: '',
        commandId: 'abele:script-guard',
      },
      {
        path: 'Scripts/plain.js',
        meta: { name: 'Plain', description: '', params: [] },
        code: '',
        commandId: 'abele:script-plain',
      },
    ]
    AgentRegistry.getInstance().update(main.id, { interceptorAgentId: helper.id })
    const view = mountEditor(main.id)
    await openFirst(view)
    const options = interceptorPicker(view)!.props('options') as Options
    expect(options.map((o) => o.display)).toContain('Script: Guard')
    expect(options.map((o) => o.display)).not.toContain('Script: Plain')

    await interceptorPicker(view)!.vm.$emit('update:model-value', 'script:Guard')

    const stored = AgentRegistry.getInstance().get(main.id)
    expect(stored?.interceptorScript).toBe('Guard')
    expect(stored?.interceptorAgentId).toBe('')
    expect(contextPicker(view)).toBeUndefined()
    ScriptService.getInstance().scriptList.value = []
  })

  it('keeps a pattern that compiles and says why it does not keep one that does not', async () => {
    const { main, helper } = seedAgents()
    AgentRegistry.getInstance().update(main.id, { interceptorAgentId: helper.id })
    const view = mountEditor(main.id)
    await openFirst(view)
    const field = () =>
      view.findAllComponents(Input).find((i) => i.props('placeholder') === '^/todo')!

    await field().vm.$emit('update:model-value', '^/check')
    expect(AgentRegistry.getInstance().get(main.id)?.interceptorPattern).toBe('^/check')

    await field().vm.$emit('update:model-value', '([a-')
    expect(AgentRegistry.getInstance().get(main.id)?.interceptorPattern).toBe('^/check')
    expect(view.find('.mod-warning').text()).toMatch(/Not saved/)
  })

  it('offers reply-only mode for agents and scripts, and not once the entry is removed', async () => {
    const shown: Menu[] = []
    vi.spyOn(Menu.prototype, 'showAtMouseEvent').mockImplementation(function (this: Menu) {
      shown.push(this)
      return this
    })
    const { main, helper } = seedAgents()
    const registry = AgentRegistry.getInstance()
    registry.update(main.id, { interceptorAgentId: helper.id })
    const view = mountEditor(main.id)
    await openFirst(view)
    const row = () =>
      view
        .findAll('.setting-item')
        .find((s) => s.find('.setting-item-name').text() === 'Reply only')
    expect(row()?.find('.checkbox-container').classes()).not.toContain('is-enabled')
    await row()!.find('.checkbox-container').trigger('click')
    expect(registry.get(main.id)?.interceptorReplyOnly).toBe(true)
    expect(row()?.find('.checkbox-container').classes()).toContain('is-enabled')
    await interceptorPicker(view)!.vm.$emit('update:model-value', 'script:Sample guard')
    expect(row()?.find('.checkbox-container').classes()).toContain('is-enabled')
    await row()!.find('.checkbox-container').trigger('click')
    expect(registry.get(main.id)?.interceptorReplyOnly).toBe(false)
    await view.find('[aria-label="Move or remove"]').trigger('click')
    const remove = (shown[0].items as unknown as { title: string; handler: () => void }[]).find(
      (i) => i.title === 'Remove'
    )!
    remove.handler()
    await view.vm.$nextTick()
    expect(row()).toBeUndefined()
    expect(registry.get(main.id)?.interceptors).toEqual([])
    view.unmount()
  })

  it('chooses what the interceptor checks, and hides Reply only for answers alone', async () => {
    const { main, helper } = seedAgents()
    const registry = AgentRegistry.getInstance()
    registry.update(main.id, { interceptorAgentId: helper.id })
    const view = mountEditor(main.id)
    await openFirst(view)
    const row = (name: string) =>
      view.findAll('.setting-item').find((s) => s.find('.setting-item-name').text() === name)
    const checks = () => row('Checks')!.findComponent(Dropdown)
    expect(checks().props('modelValue')).toBe('message')
    await checks().vm.$emit('update:model-value', 'answer')
    expect(registry.get(main.id)?.interceptorChecks).toBe('answer')
    expect(row('Reply only')).toBeUndefined()
    await checks().vm.$emit('update:model-value', 'both')
    expect(registry.get(main.id)?.interceptorChecks).toBe('both')
    expect(row('Reply only')).toBeDefined()
    view.unmount()
  })

  it('turns review off again, keeping the entry in its place', async () => {
    const { main, helper } = seedAgents()
    AgentRegistry.getInstance().update(main.id, { interceptorAgentId: helper.id })
    const view = mountEditor(main.id)

    await view.find('.abele-interceptors__entry .checkbox-container').trigger('click')

    const stored = AgentRegistry.getInstance().get(main.id)
    expect(stored?.interceptorAgentId).toBe('')
    expect(stored?.interceptors).toMatchObject([{ agentId: helper.id, enabled: false }])
    expect(view.find('.abele-interceptors__entry').text()).toContain('Off')
  })

  it('runs them in the order the list shows, numbered', async () => {
    const { main, helper } = seedAgents()
    const other = AgentRegistry.getInstance().create({ name: 'Second reader', utility: true })
    AgentRegistry.getInstance().update(main.id, {
      interceptors: [
        newEntry({ id: 'ic-1', agentId: helper.id }),
        newEntry({ id: 'ic-2', agentId: other.id, checks: 'answer' }),
      ],
    })
    const view = mountEditor(main.id)
    const rows = view.findAll('.abele-interceptors__entry')
    expect(rows.map((r) => r.find('.abele-interceptors__number').text())).toEqual(['1', '2'])
    expect(rows.map((r) => r.find('.abele-interceptors__name').text())).toEqual([
      'Titler',
      'Second reader',
    ])
  })
})

describe('the memory tab', () => {
  const openMemory = async (agentId: string) => {
    const view = mountEditor(agentId)
    const tab = view.findAll('.abele-tabs__tab').find((t) => t.text() === 'Memory')!
    await tab.trigger('click')
    return view
  }

  const seeded = () =>
    AgentRegistry.getInstance().create({
      name: 'Writer',
      memory: [
        { id: 'm1', text: 'Answer in Russian', created: '2026-09-20' },
        { id: 'm2', text: 'The cat is Bruno', created: '2026-09-21' },
      ],
    })

  it('shows what this agent remembers, and not what another does', async () => {
    const agent = seeded()
    AgentRegistry.getInstance().create({
      name: 'Other',
      memory: [{ id: 'x', text: 'Not mine', created: '2026-09-21' }],
    })

    const view = await openMemory(agent.id)

    const values = view
      .findAll('.abele-card input')
      .map((i) => (i.element as HTMLInputElement).value)
    expect(values).toEqual(['Answer in Russian', 'The cat is Bruno'])
    expect(view.findAll('.abele-card__name').map((n) => n.text())).toEqual([
      'Added 2026-09-20',
      'Added 2026-09-21',
    ])
  })

  it('says so when there is nothing remembered', async () => {
    const bare = AgentRegistry.getInstance().create({ name: 'Bare' })

    const view = await openMemory(bare.id)

    expect(view.find('.abele-empty-state').text()).toContain('Nothing remembered yet')
  })

  it('forgets an item and saves', async () => {
    const agent = seeded()
    const view = await openMemory(agent.id)

    await view.findAll('.abele-card__actions .abele-obsidian-icon')[0].trigger('click')

    expect(
      AgentRegistry.getInstance()
        .get(agent.id)
        ?.memory?.map((m) => m.text)
    ).toEqual(['The cat is Bruno'])
    expect(AbeleConfig.getInstance().saveSettings).toHaveBeenCalled()
  })

  it('edits an item in place', async () => {
    const agent = seeded()
    const view = await openMemory(agent.id)

    const field = view.findAllComponents(Input)[0]
    await field.vm.$emit('update:model-value', 'Answer in English')

    expect(AgentRegistry.getInstance().get(agent.id)?.memory?.[0]).toMatchObject({
      id: 'm1',
      text: 'Answer in English',
    })
  })

  it('adds an item typed by hand', async () => {
    const bare = AgentRegistry.getInstance().create({ name: 'Bare' })
    const view = await openMemory(bare.id)

    const inputs = view.findAllComponents(Input)
    await inputs[inputs.length - 1].vm.$emit('update:model-value', 'Weeks start on Monday')
    await view
      .findAll('button')
      .find((b) => b.text() === 'Add')!
      .trigger('click')

    expect(
      AgentRegistry.getInstance()
        .get(bare.id)
        ?.memory?.map((m) => m.text)
    ).toEqual(['Weeks start on Monday'])
  })
})

it('describes the selected Codex mode in its permission row', async () => {
  const registry = AgentRegistry.getInstance()
  const agent = registry.create({
    name: 'Sample coder',
    permissionMode: 'confirm-all',
    node: {
      id: 'sample-node',
      name: 'Sample node',
      provider: 'codex',
      permissionModeConfigured: true,
    },
  })
  const view = mountEditor(agent.id)
  try {
    await view
      .findAll('.abele-tabs__tab')
      .find((tab) => tab.text() === 'Access')!
      .trigger('click')
    const row = view.findAll('.setting-item').find((row) => row.text().includes('Permission mode'))!
    expect(row.text()).toContain('Asks before each action.')
    expect(view.get('.abele-node-permission-warning').text()).toBe(
      "Codex can't ask before each action, so it won't start here. Choose Without asking."
    )
    expect(row.text()).not.toContain('Without asking: edits')
    await row.findComponent(Dropdown).vm.$emit('update:modelValue', 'allow-all')
    await view.vm.$nextTick()
    expect(row.text()).toContain('Edits files in its folder without asking and stays inside it.')
    expect(view.find('.abele-node-permission-warning').exists()).toBe(false)
    await row.findComponent(Dropdown).vm.$emit('update:modelValue', 'inherit')
    await view.vm.$nextTick()
    expect(row.text()).toContain('Takes the mode of the chat that delegates.')
    expect(row.text()).not.toContain('Ask now')
    expect(view.get('.abele-node-permission-warning').text()).toBe(
      "The delegating chat is in Ask now, so Codex won't start. Choose Without asking."
    )
  } finally {
    view.unmount()
  }
})
