import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import NodeWorkspaceDialog from '@/components/NodeWorkspaceDialog.vue'
import { nodeWorkspaceFixture } from '@/testing/nodeWorkspaceFixture'
import { useVault } from '../helpers/testEnv'

it('uses the shared modal and node seam, displays durable provisioning state and starts the selected provider', async () => {
  useVault([])
  const props = nodeWorkspaceFixture()
  const client = props.model.client
  const session = {
    session_id: 'new-session',
    title: 'Sample task',
    provider: 'claude' as const,
    workspace_id: 'sample-workspace',
    created_at: '2025-01-01T00:00:00.000Z',
  }
  client.createSession = vi.fn(async () => session)
  client.createWorkspace = vi.fn(async () => ({
    workspace_id: 'sample-workspace',
    job_id: 'sample-job',
  }))
  const wrapper = mount(NodeWorkspaceDialog, {
    props,
    global: { stubs: { Modal: { template: '<div><slot /></div>' } } },
  })
  try {
    await flushPromises()
    expect(wrapper.text()).toContain('succeeded')
    expect(wrapper.text()).toContain('worktree_created')
    await wrapper.get('input[aria-label="Node session title"]').setValue('Sample task')
    await wrapper.get('select[aria-label="Node provider"]').setValue('claude')
    const start = wrapper.findAll('button').find((b) => b.text() === 'Start session in workspace')!
    await start.trigger('click')
    await flushPromises()
    expect(client.createSession).toHaveBeenCalledWith('Sample task', 'sample-workspace', 'claude')
    expect(wrapper.emitted('session')).toEqual([[session]])
    props.model.workspaces.value = props.model.workspaces.value.map((w) => ({
      ...w,
      state: 'provisioning',
    }))
    await flushPromises()
    expect(start.attributes('disabled')).toBeDefined()
  } finally {
    wrapper.unmount()
  }
})
