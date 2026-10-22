import { afterEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import NodeErrorLine from '@/components/nodeWork/NodeErrorLine.vue'
import { NodeService } from '@/node/NodeService'
import { recoverNodeError } from '@/node/errorRecovery'
vi.mock('@/node/errorRecovery', () => ({ recoverNodeError: vi.fn(async () => {}) }))
afterEach(() => vi.restoreAllMocks())

it('refreshes an unknown outcome, preserves the code in Original action, and never retries it', async () => {
  const refresh = vi.fn(),
    retry = vi.fn()
  const view = mount(NodeErrorLine, {
    props: { error: 'outcome_unknown', original: true, refresh, retry },
  })
  expect(view.text()).not.toContain('outcome_unknown')
  expect(view.get('button').text()).toBe('Refresh')
  await view.get('button').trigger('click')
  expect(refresh).toHaveBeenCalledOnce()
  expect(retry).not.toHaveBeenCalled()
  await view.get('.abele-fold-heading').trigger('click')
  expect(view.get('.is-code').text()).toBe('outcome_unknown')
  view.unmount()
})

it('offers folder trust only for an advertised owner mutation and hides logs on old nodes', async () => {
  const methods: string[] = []
  const connection = {
    state: ref('connected'),
    client: { channel: { channel: { welcome: { methods } } } },
  }
  vi.spyOn(NodeService, 'peekConnection').mockReturnValue(connection as never)
  const target = {
    nodeId: 'sample-node',
    registrationId: 'sample-registration',
    projectId: 'sample-project',
    kind: 'worktree' as const,
    id: 'sample-tree',
  }
  const view = mount(NodeErrorLine, {
    props: { error: 'project_untrusted', target, registrationId: target.registrationId },
  })
  expect(view.find('button').exists()).toBe(false)
  methods.push('project.trust', 'node.log.v1.tail')
  connection.state.value = 'offline'
  await view.setProps({ error: 'trust_required' })
  expect(view.get('button').text()).toBe('Trust this folder…')
  await view.get('button').trigger('click')
  expect(recoverNodeError).toHaveBeenCalledWith('trust', target.registrationId, target)
  await view.get('.abele-fold-heading').trigger('click')
  expect(view.findAll('a').map((link) => link.text())).toEqual(['Node log', 'Copy details'])
  view.unmount()
})
