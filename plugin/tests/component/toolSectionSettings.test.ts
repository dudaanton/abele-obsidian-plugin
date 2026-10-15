/**
 * An agent's tools, offered by section: the node's tools as three actions with one choice each,
 * every section saying when it is open and what it is for, in words the owner can change.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import ToolModesEditor from '@/components/ToolModesEditor.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ToolMode } from '@/ai/types'
import { getToolRegistry } from '@/ai/tools'
import { nodeAction, type SectionOpening } from '@/ai/toolSections'
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

function mountHost(bySection = true) {
  const modes = ref<Record<string, ToolMode>>({})
  const opening = ref<Record<string, SectionOpening>>({})
  const words = ref<Record<string, string>>({})
  const Host = defineComponent({
    setup: () => () =>
      h(ToolModesEditor, {
        toolModes: modes.value,
        hideShowAll: true,
        bySection,
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
  it('shows three actions, not a row per tool, and one choice sets every tool of its action', async () => {
    const { view, modes } = mountHost()
    const text = view.text()
    expect(text).toContain('Read files and search')
    expect(text).toContain('Edit files')
    expect(text).toContain('Worktrees')
    expect(text).not.toContain('node_git_log')
    const edits = nodeTools().filter((t) => nodeAction(t.name) === 'edit')
    expect(edits.length).toBeGreaterThan(2)
    const row = view.findAll('.abele-tool-modes__row').find((r) => r.text().includes('Edit files'))!
    await row.find('select').setValue('auto')
    for (const t of edits) expect(modes.value[t.permissionKey ?? t.name]).toBe('auto')
    expect(modes.value.node_read).toBeUndefined()
  })

  it('opens an action to show its own tools, each with its own choice', async () => {
    const { view } = mountHost()
    const row = view.findAll('.abele-tool-modes__row').find((r) => r.text().includes('Worktrees'))!
    await row.find('.abele-tool-modes__members-toggle').trigger('click')
    expect(view.text()).toContain('node_worktree_switch')
  })
})

describe('a section’s head, offered by section', () => {
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
