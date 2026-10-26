/**
 * Optional tools offered by section; node folder levels own node permissions.
 * Prompt descriptions remain editable independently of permission controls.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import ToolModesEditor from '@/components/ToolModesEditor.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ToolMode } from '@/ai/types'
import { codeToolDescriptions, getToolRegistry } from '@/ai/tools'
import { LEGACY_NODE_TOOLS, type SectionOpening } from '@/ai/toolSections'
import { useVault } from '../helpers/testEnv'

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, mcpServers: [] }
})

const DropdownStub = defineComponent({
  props: { modelValue: String, options: Array, ariaLabel: String },
  emits: ['update:modelValue'],
  setup:
    (props, { emit }) =>
    () =>
      h(
        'select',
        {
          class: 'dropdown-stub',
          'aria-label': props.ariaLabel,
          value: props.modelValue,
          onChange: (e: Event) => emit('update:modelValue', (e.target as HTMLSelectElement).value),
        },
        (props.options as { value: string }[]).map((o) => h('option', { value: o.value }, o.value))
      ),
})

function mountHost(bySection = true, descriptionsOnly = false) {
  const modes = ref<Record<string, ToolMode>>({})
  const opening = ref<Record<string, SectionOpening>>({})
  const words = ref<Record<string, string>>({})
  const Host = defineComponent({
    setup: () => () =>
      h(ToolModesEditor, {
        toolModes: modes.value,
        hideShowAll: true,
        bySection,
        descriptionsOnly,
        sectionOpening: opening.value,
        sectionDescriptions: words.value,
        onUpdate: (name: string, mode: ToolMode) =>
          (modes.value = { ...modes.value, [name]: mode }),
        onUpdateMany: (changes: Record<string, ToolMode>) =>
          (modes.value = { ...modes.value, ...changes }),
        onUpdateOpening: (id: string, value: SectionOpening) =>
          (opening.value = { ...opening.value, [id]: value }),
        onUpdateSectionDescription: (id: string, text: string) =>
          (words.value = { ...words.value, [id]: text }),
      }),
  })
  const view = mount(Host, { global: { stubs: { Dropdown: DropdownStub } } })
  return { view, modes, opening, words }
}

const nodeTools = () => getToolRegistry().filter((t) => t.category === 'Nodes')

describe('the node section in an agent’s tools', () => {
  it('omits the replaced node actions and their per-tool switches', () => {
    const { view, modes } = mountHost()
    expect(nodeTools().length).toBeGreaterThan(2)
    for (const label of ['Read files and search', 'Edit files', 'Worktrees'])
      expect(view.text()).not.toContain(label)
    expect(view.find('.abele-tool-modes__action').exists()).toBe(false)
    expect(view.text()).not.toContain('node_git_log')
    expect(modes.value).toEqual({})
  })

  it('has no worktree permission control in either discovery mode', () => {
    for (const bySection of [true, false]) {
      const { view } = mountHost(bySection)
      expect(view.text()).not.toContain('node_worktree_switch')
      expect(view.find('.abele-tool-modes__members-toggle').exists()).toBe(false)
      view.unmount()
    }
  })
})

describe('the node section’s actions and the old names', () => {
  it('leaves saved delegation and command modes unchanged when optional tools change', async () => {
    const { view, modes } = mountHost()
    modes.value = { node_delegate: 'ask', node_command_run: 'off', node_git_integrate: 'auto' }
    await nextTick()
    const bulk = view.find('.abele-tool-modes__bulk--all')
    await bulk
      .findAll('button')
      .find((button) => button.text() === 'Auto')!
      .trigger('click')
    expect(modes.value).toMatchObject({
      node_delegate: 'ask',
      node_command_run: 'off',
      node_git_integrate: 'auto',
    })
    expect(view.text()).not.toContain('Hand work to a node agent')
  })

  it('offers neither delegation nor debugger permissions outside node folder access', async () => {
    const { view, modes } = mountHost()
    expect(view.text()).not.toContain('Hand work to a node agent')
    expect(view.text()).not.toContain('Debugger runs')
    const bulk = view.find('.abele-tool-modes__bulk--all')
    await bulk
      .findAll('button')
      .find((button) => button.text() === 'Auto')!
      .trigger('click')
    for (const name of ['node_read', 'node_delegate', 'trace_runs'])
      expect(modes.value[name], name).toBeUndefined()
  })

  it('never lists or changes legacy node aliases through optional-tool controls', async () => {
    const { view, modes } = mountHost()
    for (const name of LEGACY_NODE_TOOLS) expect(view.text()).not.toContain(name)
    const bulk = view.find('.abele-tool-modes__bulk--all')
    await bulk
      .findAll('button')
      .find((button) => button.text() === 'Ask')!
      .trigger('click')
    for (const name of LEGACY_NODE_TOOLS) expect(modes.value[name], name).toBeUndefined()
  })
})

describe('the node section as a person reads it', () => {
  it('keeps node tool instructions editable in descriptions only', async () => {
    const view = mount(ToolModesEditor, {
      props: { toolModes: {}, descriptionsOnly: true, showDescriptions: true },
      global: { stubs: { Dropdown: DropdownStub } },
    })
    const head = view.findAll('.abele-tool-modes__head').find((h) => h.text().includes('Node'))!
    expect(head.find('h4').text()).toBe('Node')
    const tool = nodeTools().find((tool) => tool.name === 'node_read')!
    const row = view
      .findAll('.abele-tool-modes__row')
      .find((row) => row.find('.setting-item-name').text() === tool.label)!
    await row.find('.abele-tool-modes__desc-btn').trigger('click')
    const area = row.find('textarea')
    expect((area.element as HTMLTextAreaElement).value).toBe(codeToolDescriptions().node_read)
    await area.setValue('Sample node instructions.')
    expect(view.emitted('updateDescription')?.at(-1)).toEqual([
      'node_read',
      'Sample node instructions.',
    ])
    expect(row.find('select').exists()).toBe(false)
  })

  it('does not recreate mixed node action controls from legacy saved modes', async () => {
    const { view, modes } = mountHost()
    modes.value = { node_read: 'auto', node_search: 'ask' }
    await nextTick()
    expect(view.text()).not.toContain('Read files and search')
    expect(view.find('select[aria-label*="node_read"]').exists()).toBe(false)
    expect(modes.value).toEqual({ node_read: 'auto', node_search: 'ask' })
  })
})

describe('a section’s head, offered by section', () => {
  it('says Files and Basics are always open, as words, not a choice', () => {
    const { view } = mountHost()
    const heads = view.findAll('.abele-tool-modes__head')
    const files = heads.find((h) => h.find('h4').text() === 'Files')!
    expect(files.find('select').exists()).toBe(false)
    expect(files.find('.abele-tool-modes__opening-fixed').text()).toBe('Always open')
  })

  it('says when the section is open, by default on request, and keeps the change by section id', async () => {
    const { view, opening } = mountHost()
    const select = view.find('select[aria-label="When Maps is open"]')
    expect((select.element as HTMLSelectElement).value).toBe('on-request')
    await select.setValue('always')
    expect(opening.value).toEqual({ maps: 'always' })
    expect(view.find('select[aria-label="When Files is open"]').exists()).toBe(false)
  })

  it('has no opening choice when every tool is offered at once', () => {
    const { view } = mountHost(false)
    expect(view.find('select[aria-label="When Maps is open"]').exists()).toBe(false)
  })

  it('shows what the section is for and lets the owner put it in their own words', async () => {
    const { view, words } = mountHost()
    const about = view
      .findAll('.abele-tool-modes__about')
      .find((a) => a.text().includes('Places and routes'))!
    await about.find('button.clickable-icon').trigger('click')
    await nextTick()
    const area = view.find('.abele-tool-modes__about textarea')
    await area.setValue('Sample own words.')
    expect(words.value).toEqual({ maps: 'Sample own words.' })
  })
})
