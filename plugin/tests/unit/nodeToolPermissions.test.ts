import { expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import NodeToolPermissions from '@/components/NodeToolPermissions.vue'
import { openNodeAgentSettings } from '@/node/openNodeAgentSettings'
vi.mock('@/node/openNodeAgentSettings', () => ({ openNodeAgentSettings: vi.fn() }))

it('retains the policy refusal when the terminal reason is unrelated to permissions', () => {
  const view = mount(NodeToolPermissions, {
    props: {
      nodeLabel: 'Sample node',
      provider: 'codex',
      reason: 'time_limit',
      policy: {
        permission_mode: 'manual',
        per_action_approval: false,
        status: 'unsupported',
        reason: 'interactive_approval_unsupported',
      },
    },
  })
  try {
    expect(view.text()).toContain('cannot ask before each action')
  } finally {
    view.unmount()
  }
})
import { agentChoices, nodeProviders } from '@/node/providers'
import {
  ownerPermissionPatch,
  readToolPermissions,
  configureOwnerPermissionMode,
  delegatedPermissionMode,
} from '@/node/toolPermissions'
import {
  DelegationSchema,
  MethodSchemas,
  SessionSchema,
  LiveSessionStateSchema,
} from '@abele/node-protocol'
it('inherits the parent effective mode and preserves an explicit stricter delegate mode', () => {
  expect(delegatedPermissionMode(undefined, 'allow-all')).toBe('allow-all')
  expect(delegatedPermissionMode('confirm-all', 'allow-all')).toBe('confirm-all')
  expect(delegatedPermissionMode('allow-all', 'confirm-all')).toBe('confirm-all')
})
it('configures sessions from owner settings only when the node supports the contract', async () => {
  const client = { describe: vi.fn(), configureSession: vi.fn() }
  client.describe.mockResolvedValue({})
  await configureOwnerPermissionMode(client as never, 'sample-session', 'allow-all')
  expect(client.configureSession).not.toHaveBeenCalled()
  client.describe.mockResolvedValue({
    capabilities: { 'tool.permissions.v1': { status: 'supported' } },
  })
  await configureOwnerPermissionMode(client as never, 'sample-session', 'confirm-all')
  expect(client.configureSession).toHaveBeenLastCalledWith('sample-session', {
    permission_mode: 'manual',
  })
  await configureOwnerPermissionMode(client as never, 'sample-session', 'allow-all')
  expect(client.configureSession).toHaveBeenLastCalledWith('sample-session', {
    permission_mode: 'bypassPermissions',
  })
})

it('shows a refusal with an exact owner settings action without changing mode', async () => {
  const wrapper = mount(NodeToolPermissions, {
    props: {
      policy: {
        permission_mode: 'manual',
        per_action_approval: false,
        status: 'unsupported',
        reason: 'interactive_approval_unsupported',
      },
      nodeId: 'sample-node',
      nodeLabel: 'Sample node',
      provider: 'codex',
    },
  })
  expect(wrapper.text()).toContain('Without asking')
  expect(openNodeAgentSettings).not.toHaveBeenCalled()
  await wrapper.get('button').trigger('click')
  expect(openNodeAgentSettings).toHaveBeenCalledWith(
    'sample-node',
    'Sample node',
    'codex',
    undefined
  )
  await wrapper.setProps({
    policy: {
      permission_mode: 'bypassPermissions',
      per_action_approval: false,
      status: 'supported',
    },
  })
  expect(wrapper.find('[aria-label="Without asking"]').exists()).toBe(true)
  expect(wrapper.find('button').exists()).toBe(false)
  await wrapper.setProps({ policy: undefined })
  expect(wrapper.text()).toBe('')
  await wrapper.setProps({
    policy: {
      permission_mode: 'bypassPermissions',
      per_action_approval: false,
      status: 'unsupported',
      reason: 'bypass_not_allowed',
    },
  })
  expect(wrapper.text()).toContain('On the node, allow running without asking:')
  await wrapper.get('.abele-disclosure__control').trigger('click')
  expect((wrapper.get('textarea').element as HTMLTextAreaElement).readOnly).toBe(true)
  expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe(
    'abele-node service flags set --allow-bypass on'
  )
  wrapper.unmount()
})

it('accepts additive owner mode and snapshots through the shipped SDK', () => {
  const tool_permissions = {
    permission_mode: 'manual',
    per_action_approval: false,
    status: 'unsupported',
    reason: 'interactive_approval_unsupported',
  }
  expect(
    readToolPermissions(
      SessionSchema.parse({
        session_id: 'sample-session',
        title: 'Sample session',
        provider: 'codex',
        created_at: '2028-01-01T00:00:00Z',
        tool_permissions,
      })
    )
  ).toEqual(tool_permissions)
  expect(
    readToolPermissions(
      LiveSessionStateSchema.parse({
        session_id: 'sample-session',
        live: false,
        process: 'none',
        run_id: null,
        turn: null,
        background_tasks: [],
        context: null,
        compacting: false,
        settings: {
          model: 'sample-model',
          effort: 'high',
          account: 'default',
          permission_mode: 'manual',
          continue_after_compaction: false,
          continuation_text: '',
          messaging: false,
        },
        process_settings: null,
        restart_pending: false,
        watchers: 0,
        idle_since: null,
        tool_permissions,
      })
    )
  ).toEqual(tool_permissions)
  expect(
    MethodSchemas['delegation.create'].safeParse({
      parent_id: 'sample-parent',
      delegation_key: 'sample-key',
      title: 'Sample',
      provider: 'codex',
      text: 'Review example',
      permission_mode: 'bypassPermissions',
    }).success
  ).toBe(true)
  expect(
    DelegationSchema.safeParse({
      node_id: 'sample-node',
      session_id: 'sample-session',
      delegation_id: 'sample-delegation',
      delegation_key: 'sample-key',
      grant_id: 'sample-grant',
      parent_id: 'sample-parent',
      mailbox_stream_id: 'sample-mailbox',
      workspace_id: null,
      job_id: null,
      state: 'running',
      created_at: '2028-01-01T00:00:00Z',
      tool_permissions: {
        permission_mode: 'bypassPermissions',
        per_action_approval: false,
        status: 'supported',
      },
    }).success
  ).toBe(true)
})

it('sends only the explicit owner bypass choice on capable nodes', () => {
  const node = { capabilities: { 'tool.permissions.v1': { status: 'supported' } } }
  expect(ownerPermissionPatch(node, 'allow-all')).toEqual({ permission_mode: 'bypassPermissions' })
  expect(ownerPermissionPatch(node, 'allow-edit')).toEqual({ permission_mode: 'manual' })
  expect(ownerPermissionPatch(node, undefined)).toEqual({ permission_mode: 'manual' })
  expect(ownerPermissionPatch({}, 'allow-all')).toEqual({})
})
it('keeps absent snapshots unknown and preserves unsupported reasons', () => {
  expect(readToolPermissions({})).toBeUndefined()
  for (const reason of ['interactive_approval_unsupported', 'bypass_not_allowed']) {
    const tool_permissions = {
      permission_mode: 'manual',
      per_action_approval: false,
      status: 'unsupported',
      reason,
    }
    expect(readToolPermissions({ tool_permissions })).toEqual(tool_permissions)
  }
  expect(
    readToolPermissions({
      tool_permissions: {
        permission_mode: 'bypassPermissions',
        per_action_approval: false,
        status: 'supported',
      },
    })?.status
  ).toBe('supported')
})
it('retains the provider per-action approval capability', () => {
  expect(
    nodeProviders({
      providers: [
        {
          provider: 'codex',
          available: true,
          configuration: {
            per_action_approval: false,
            permission_modes: ['manual', 'bypassPermissions'],
          },
        },
      ],
    })[0].configuration?.per_action_approval
  ).toBe(false)
})

it('explains Codex requirements even when an older node omits approval metadata', () => {
  const choice = agentChoices(
    nodeProviders({ providers: [{ provider: 'codex', available: true }] })
  ).find((choice) => choice.provider === 'codex')
  expect(choice?.permissionNote).toContain('cannot ask before each action')
})

it('keeps unknown policy quiet and gives refusals a visible settings button', () => {
  const wrapper = mount(NodeToolPermissions, {
    props: { nodeLabel: 'Sample node', provider: 'codex', nodeId: 'sample-node' },
  })
  expect(wrapper.text()).toBe('')
  wrapper.unmount()
  const refused = mount(NodeToolPermissions, {
    props: {
      nodeLabel: 'Sample node',
      provider: 'codex',
      nodeId: 'sample-node',
      reason: 'interactive_approval_unsupported',
    },
  })
  expect(refused.get('button').classes()).not.toContain('clickable-icon')
  expect(refused.find('.abele-status-dot_red').exists()).toBe(true)
  refused.unmount()
})
