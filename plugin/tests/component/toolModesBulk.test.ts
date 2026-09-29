/**
 * Setting many tools at once in the tool modes editor: one row for every tool and one per
 * section, each with Off, Ask and Auto. They are only shortcuts — every tool keeps its own
 * dropdown, and changing one after a bulk set changes that one alone.
 *
 * The editor is mounted inside a host that holds the modes and applies what it emits, the way
 * the agent editor and the chat's setup do, so what is asserted is the state that results.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import ToolModesEditor from '@/components/ToolModesEditor.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, CORE_TOOLS, type ToolMode } from '@/ai/types'
import { getToolRegistry } from '@/ai/tools'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import AgentEditorModal from '@/components/settings/ai/AgentEditorModal.vue'
import { vi } from 'vitest'
import { useVault } from '../helpers/testEnv'

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, mcpServers: [] }
})

const DropdownStub = defineComponent({
  props: { modelValue: String, options: Array },
  emits: ['update:modelValue'],
  setup:
    (props, { emit }) =>
    () =>
      h(
        'select',
        {
          class: 'dropdown-stub',
          value: props.modelValue,
          onChange: (e: Event) => emit('update:modelValue', (e.target as HTMLSelectElement).value),
        },
        ['off', 'ask', 'auto'].map((v) => h('option', { value: v }, v))
      ),
})

function mountHost(initial: Record<string, ToolMode> = {}, hideShowAll = true) {
  const modes = ref<Record<string, ToolMode>>({ ...initial })
  const Host = defineComponent({
    setup: () => () =>
      h(ToolModesEditor, {
        toolModes: modes.value,
        hideShowAll,
        onUpdate: (name: string, mode: ToolMode) => {
          modes.value = { ...modes.value, [name]: mode }
        },
        onUpdateMany: (changes: Record<string, ToolMode>) => {
          modes.value = { ...modes.value, ...changes }
        },
      }),
  })
  const view = mount(Host, { global: { stubs: { Dropdown: DropdownStub } } })
  return { view, modes }
}

const optional = () => getToolRegistry().filter((t) => !CORE_TOOLS.has(t.name))
const inCategory = (category: string) => optional().filter((t) => t.category === category)

type View = ReturnType<typeof mountHost>['view']

const rowNamed = (view: View, name: string, nth = 0) => {
  const rows = view
    .findAll('.setting-item')
    .filter((r) => r.find('.setting-item-name').text() === name)
  if (!rows[nth]) throw new Error(`no row ${name} #${nth}`)
  return rows[nth]
}

const press = async (row: ReturnType<typeof rowNamed>, text: string) => {
  const button = row.findAll('button').find((b) => b.text() === text)
  if (!button) throw new Error(`no button ${text}`)
  await button.trigger('click')
}

/** The row that sets all of one section, found by the section's name. */
const sectionRow = (view: View, category: string) => {
  const row = view.find(`.abele-tool-modes__bulk--section[data-section="${category}"]`)
  if (!row.exists()) throw new Error(`no section row ${category}`)
  return row
}

describe('every tool at once', () => {
  it('turns every optional tool to Auto, then all off again', async () => {
    const { view, modes } = mountHost()

    await press(rowNamed(view, 'All tools'), 'Auto')
    for (const tool of optional()) expect(modes.value[tool.name], tool.name).toBe('auto')

    await press(rowNamed(view, 'All tools'), 'Off')
    for (const tool of optional()) expect(modes.value[tool.name], tool.name).toBe('off')
  })

  it('never touches a core tool, even with core tools shown', async () => {
    const { view, modes } = mountHost({}, false)
    await view.find('.abele-tool-modes__toggle .checkbox-container').trigger('click')

    await press(rowNamed(view, 'All tools'), 'Off')
    for (const name of CORE_TOOLS) expect(modes.value[name]).toBeUndefined()
  })

  it('leaves each tool its own dropdown, which still changes that tool alone', async () => {
    const { view, modes } = mountHost()
    await press(rowNamed(view, 'All tools'), 'Ask')

    const target = optional()[0]
    const row = view
      .findAll('.abele-tool-modes__row')
      .find((r) => r.find('.setting-item-name').text() === target.label)!
    await row.find('select').setValue('off')

    expect(modes.value[target.name]).toBe('off')
    for (const tool of optional().slice(1)) expect(modes.value[tool.name], tool.name).toBe('ask')
  })

  it('marks the mode every tool shares, and none when they differ', async () => {
    const { view } = mountHost()
    const accented = () =>
      rowNamed(view, 'All tools')
        .findAll('button.mod-cta')
        .map((b) => b.text())

    expect(accented()).toEqual(['Off'])
    await press(rowNamed(view, 'All tools'), 'Ask')
    expect(accented()).toEqual(['Ask'])

    const row = view.findAll('.abele-tool-modes__row')[0]
    await row.find('select').setValue('auto')
    expect(accented()).toEqual([])
  })
})

describe('one section at once', () => {
  it('sets that section and nothing outside it', async () => {
    const { view, modes } = mountHost()

    await press(sectionRow(view, 'Network'), 'Auto')

    for (const tool of inCategory('Network')) expect(modes.value[tool.name], tool.name).toBe('auto')
    for (const tool of optional().filter((t) => t.category !== 'Network'))
      expect(modes.value[tool.name] ?? 'off', tool.name).toBe('off')
  })

  it('turns a section off while the rest stays as it was', async () => {
    const { view, modes } = mountHost()
    await press(rowNamed(view, 'All tools'), 'Ask')

    await press(sectionRow(view, 'Books'), 'Off')

    for (const tool of inCategory('Books')) expect(modes.value[tool.name], tool.name).toBe('off')
    for (const tool of inCategory('Network')) expect(modes.value[tool.name], tool.name).toBe('ask')
  })

  it('still lets one tool of the section be changed after', async () => {
    const { view, modes } = mountHost()
    await press(sectionRow(view, 'Books'), 'Auto')

    const [first, ...rest] = inCategory('Books')
    const row = view
      .findAll('.abele-tool-modes__row')
      .find((r) => r.find('.setting-item-name').text() === first.label)!
    await row.find('select').setValue('ask')

    expect(modes.value[first.name]).toBe('ask')
    for (const tool of rest) expect(modes.value[tool.name], tool.name).toBe('auto')
  })

  it('is not offered where only descriptions are edited', () => {
    const view = mount(ToolModesEditor, {
      props: { toolModes: {}, descriptionsOnly: true, showDescriptions: true },
      global: { stubs: { Dropdown: true } },
    })

    expect(view.find('.abele-tool-modes__bulk').exists()).toBe(false)
  })
})

describe("in an agent's editor", () => {
  it('saves a section set at once to the agent, and one tool changed after on its own', async () => {
    AgentRegistry.destroy()
    AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, agents: [], mcpServers: [] }
    const save = vi.fn(async () => {})
    AbeleConfig.getInstance().saveSettings = save
    const registry = AgentRegistry.getInstance()
    const agent = registry.create({ name: 'Sample agent' })
    const view = mount(AgentEditorModal, {
      props: { agentId: agent.id },
      global: {
        stubs: {
          Dropdown: DropdownStub,
          Search: true,
          AiScopeEditor: true,
          ObsidianModal: { template: '<div class="modal-stub"><slot /></div>' },
        },
      },
    })
    const tab = view.findAll('.abele-tabs__tab').find((t) => t.text() === 'Access')!
    await tab.trigger('click')

    save.mockClear()
    await press(sectionRow(view, 'Network'), 'Auto')
    expect(save).toHaveBeenCalledTimes(1)
    for (const tool of inCategory('Network'))
      expect(registry.get(agent.id)?.toolModes[tool.name], tool.name).toBe('auto')

    const [first, ...rest] = inCategory('Network')
    const row = view
      .findAll('.abele-tool-modes__row')
      .find((r) => r.find('.setting-item-name').text() === first.label)!
    await row.find('select').setValue('off')

    expect(registry.get(agent.id)?.toolModes[first.name]).toBe('off')
    for (const tool of rest)
      expect(registry.get(agent.id)?.toolModes[tool.name], tool.name).toBe('auto')
  })
})
