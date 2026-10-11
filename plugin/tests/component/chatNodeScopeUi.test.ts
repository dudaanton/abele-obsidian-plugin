import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import type { ChatSession } from '@/ai/ChatSession'
import AiNodeScopeEditor from '@/components/AiNodeScopeEditor.vue'
import AiNodeScopeChips from '@/components/AiNodeScopeChips.vue'
import Dropdown from '@/components/obsidian/Dropdown.vue'
import Button from '@/components/obsidian/Button.vue'
import Icon from '@/components/obsidian/Icon.vue'

const mocks = vi.hoisted(() => ({ set: vi.fn(), remove: vi.fn(), host: vi.fn() }))
vi.mock('@/ai/tools/node/owner', () => ({
  setObsidianChatNodeScope: mocks.set,
  removeObsidianChatNodeAccess: mocks.remove,
  nodeAgentHost: mocks.host,
}))
function setup() {
  const session = {
    overrides: ref({ nodeScope: [{ kind: 'node', node_id: 'sample-node', access: 'edit' }] }),
  } as unknown as ChatSession
  mocks.host.mockResolvedValue({
    nodes: () => [{ id: 'sample-node', label: 'Sample node' }],
    connection: () => ({ client: { connected: true, listProjects: async () => [] } }),
  })
  return session
}
describe('node scope beside vault scope and in the header', () => {
  it('explains whole-node future access, keeps it separate from vault access, and approves loaded settings locally', async () => {
    const session = setup()
    const view = mount(AiNodeScopeEditor, { props: { session } })
    await flushPromises()
    expect(view.text()).toContain('future registered folders')
    expect(view.text()).toContain('vault access')
    const approve = view
      .findAllComponents(Button)
      .find((button) => button.props('text') === 'Approve on this device')!
    approve.vm.$emit('click')
    await flushPromises()
    expect(mocks.set).toHaveBeenCalledWith(session, session.overrides.value.nodeScope)
    view.unmount()
  })
  it('offers node/folder/worktree levels with a read/edit choice', async () => {
    const view = mount(AiNodeScopeEditor, { props: { session: setup() } })
    await flushPromises()
    const nodes = view.findAllComponents(Dropdown)[0]
    expect(nodes.props('options')).toContainEqual({ value: 'sample-node', display: 'Sample node' })
    nodes.vm.$emit('update:model-value', 'sample-node')
    await flushPromises()
    expect(view.text()).toContain('Whole node')
    expect(
      view
        .findAllComponents(Dropdown)
        .some((dropdown) =>
          dropdown.props('options').some((option: { value: string }) => option.value === 'edit')
        )
    ).toBe(true)
    view.unmount()
  })
  it('keeps malformed synced scope visible as an error rather than crashing the chat', async () => {
    const session = setup()
    session.overrides.value.nodeScope = [{ kind: 'invalid', node_id: 'sample-node' }] as never
    const view = mount(AiNodeScopeEditor, { props: { session } })
    await flushPromises()
    expect(view.text()).toContain('Invalid node scope')
    expect(
      view.findAllComponents(Button).some((button) => button.props('text') === 'Clear node access')
    ).toBe(true)
    view.unmount()
  })
  it('renders removable header access without silently approving it', async () => {
    const session = setup()
    const view = mount(AiNodeScopeChips, { props: { session } })
    await flushPromises()
    expect(view.text()).toContain('Sample node')
    const remove = view.findAllComponents(Icon).find((icon) => icon.props('icon') === 'x')!
    remove.vm.$emit('click')
    await flushPromises()
    expect(mocks.remove).toHaveBeenCalledWith(session, session.overrides.value.nodeScope![0])
    view.unmount()
  })
})
