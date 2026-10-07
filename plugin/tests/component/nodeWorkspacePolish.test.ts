import { mount, flushPromises } from '@vue/test-utils'
import { expect, it } from 'vitest'
import NodeWorkspaceDialog from '@/components/NodeWorkspaceDialog.vue'
import { nodeWorkspaceFixture } from '@/testing/nodeWorkspaceFixture'
import { useVault } from '../helpers/testEnv'
it('shows human job progress, middle-shortened paths and separates destructive actions', async () => {
  useVault([])
  const props = nodeWorkspaceFixture()
  const wrapper = mount(NodeWorkspaceDialog, {
    props,
    global: { stubs: { Modal: { template: '<div><slot /></div>' } } },
  })
  try {
    await flushPromises()
    expect(wrapper.text()).toContain('Workspace created')
    expect(wrapper.get('[aria-label="Workspace jobs"]').text()).not.toContain('workspace.create')
    expect(wrapper.get('[aria-label="Workspace jobs"]').text()).not.toContain('worktree_created')
    const projectOption = wrapper.get('select[aria-label="Project"] option[value="sample-project"]')
    expect(projectOption.text()).toContain('…')
    expect(wrapper.get('select[aria-label="Project"]').attributes('title')).toBe(
      props.model.projects.value[0].root_path
    )
    expect(wrapper.find('.abele-node-workspaces__actions').text()).toContain('Create workspace')
    expect(wrapper.find('.abele-node-workspaces__actions').text()).toContain('Refresh')
    expect(wrapper.find('.abele-node-workspaces__actions').text()).not.toContain(
      'Unregister project'
    )
    expect(wrapper.get('.abele-node-workspaces__danger').attributes('open')).toBeUndefined()
  } finally {
    wrapper.unmount()
  }
})
