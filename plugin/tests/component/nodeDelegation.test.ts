import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { initializeLocale } from '@/i18n'
import { english } from '@/i18n/catalogs'
import { streamBMeta as russian } from '@/i18n/locales/ru/streamBMeta'
import NodeDelegationGrantsDialog from '@/components/NodeDelegationGrantsDialog.vue'
import NodeDelegationCard from '@/components/NodeDelegationCard.vue'
import {
  nodeDelegationGrantsFixture,
  nodeDelegationCardFixture,
} from '@/testing/nodeDelegationFixture'
const shell = { Modal: { template: '<div><slot /></div>' } }
it('keeps generated branch identifiers out of the developer card label', () => {
  const wrapper = mount(NodeDelegationCard, {
    props: {
      card: {
        ...nodeDelegationCardFixture(),
        branch: 'abele/11111111-1111-4111-8111-111111111111',
      },
      nodeLabel: 'Sample node',
    },
  })
  try {
    expect(wrapper.text()).toContain('Review a sample parser')
    expect(wrapper.text()).not.toContain('11111111-1111-4111-8111-111111111111')
  } finally {
    wrapper.unmount()
  }
})
it('localizes a cancelled developer state', () => {
  initializeLocale('ru', { ...english, ...russian })
  const wrapper = mount(NodeDelegationCard, {
    props: {
      card: { ...nodeDelegationCardFixture(), state: 'cancelled', pendingHumanPrompts: 0 },
      nodeLabel: 'Sample node',
    },
  })
  try {
    expect(wrapper.text()).toContain('отменено')
  } finally {
    wrapper.unmount()
    initializeLocale('en')
  }
})
it('keeps a long activity message compact while retaining its latest text', () => {
  const message = 'Earlier sample progress. '.repeat(100) + 'Latest sample action'
  const wrapper = mount(NodeDelegationCard, {
    props: {
      card: { ...nodeDelegationCardFixture(), activity: { message, files: [] } },
      nodeLabel: 'Sample node',
    },
  })
  try {
    expect(wrapper.text()).toContain('Latest sample action')
    expect(wrapper.text()).not.toContain(message)
    expect(wrapper.get('button').text()).toContain('Open child chat')
  } finally {
    wrapper.unmount()
  }
})
it('collapses finished reports and keeps pending prompts one press away', async () => {
  const card = {
    ...nodeDelegationCardFixture(),
    pendingHumanPrompts: 0,
    branch: 'work/sample-parser',
    activity: { message: 'Checking boundary cases', tool: 'Test', files: ['src/parser.ts'] },
  }
  const wrapper = mount(NodeDelegationCard, { props: { card, nodeLabel: 'Sample node' } })
  try {
    expect(wrapper.get('details.abele-node-delegation__details').attributes('open')).toBeUndefined()
    expect(wrapper.text()).toContain('work/sample-parser')
    await wrapper.setProps({ card: { ...card, state: 'running', pendingHumanPrompts: 2 } })
    expect(wrapper.get('details.abele-node-delegation__details').attributes('open')).toBeDefined()
    expect(wrapper.text()).toContain('Checking boundary cases')
    expect(wrapper.text()).toContain('src/parser.ts')
    await wrapper.get('[data-pending-prompts]').trigger('click')
    expect(wrapper.emitted('open')).toHaveLength(1)
  } finally {
    wrapper.unmount()
  }
})
it('requires explicit action/fake confirmation, resets it when the selected authority changes, and revokes only through owner UI', async () => {
  const props = nodeDelegationGrantsFixture()
  const approve = vi.spyOn(props.controller, 'approve')
  const revoke = vi.spyOn(props.controller, 'revoke')
  const wrapper = mount(NodeDelegationGrantsDialog, { props, global: { stubs: shell } })
  try {
    await flushPromises()
    await wrapper.get('[aria-label="Delegation project"]').setValue('sample-project')
    expect(wrapper.find('.abele-node-path code').text()).toBe(
      '/workspace/sample-project-with-a-long-name'
    )
    await wrapper.get('[aria-label="Delegation provider"]').setValue('pi')
    const button = () => wrapper.findAll('button').find((b) => b.text() === 'Approve grant')!
    expect(button().attributes('disabled')).toBeDefined()
    await wrapper.get('[aria-label="Approve delegation actions"]').trigger('click')
    expect(button().attributes('disabled')).toBeUndefined()
    await wrapper.get('[aria-label="Delegation provider"]').setValue('fake')
    expect(
      wrapper.get('[aria-label="Approve delegation actions"]').attributes('aria-checked')
    ).toBe('false')
    expect(button().attributes('disabled')).toBeDefined()
    await wrapper.get('[aria-label="Allow fake delegation"]').trigger('click')
    await wrapper.get('[aria-label="Approve delegation actions"]').trigger('click')
    await button().trigger('click')
    await flushPromises()
    expect(approve).toHaveBeenCalledWith({
      parent_id: 'sample-parent',
      project_ids: ['sample-project'],
      providers: ['fake'],
      allow_fake: true,
    })
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Revoke grant')!
      .trigger('click')
    await flushPromises()
    expect(revoke).toHaveBeenCalledWith('sample-grant')
    expect(wrapper.text()).toContain('Revoked')
  } finally {
    wrapper.unmount()
  }
})
it('renders one durable result and informational question without vault markup execution; child opens separately', async () => {
  const card = nodeDelegationCardFixture()
  card.reports[1].text = '[[sample-note]] <script>unexpected()</script>'
  const wrapper = mount(NodeDelegationCard, { props: { card, nodeLabel: 'Sample node' } })
  try {
    expect(wrapper.findAll('[data-mailbox-seq="2"]')).toHaveLength(1)
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.find('a.internal-link').exists()).toBe(false)
    expect(wrapper.text()).toContain('Worker question (informational)')
    expect(wrapper.text()).toContain('human prompt(s)')
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('open')).toHaveLength(1)
    await wrapper.setProps({ card: structuredClone(card) })
    expect(wrapper.findAll('[data-mailbox-seq="2"]')).toHaveLength(1)
  } finally {
    wrapper.unmount()
  }
})

it('shows a deadline as resumable and retains a report beside an extension warning', () => {
  const wrapper = mount(NodeDelegationCard, {
    props: {
      nodeLabel: 'Sample node',
      card: {
        ...nodeDelegationCardFixture(),
        state: 'stopped',
        reason: 'time_limit',
        warnings: ['sample extension: shutdown warning'],
        pendingHumanPrompts: 0,
      },
    },
  })
  try {
    expect(wrapper.text()).toContain('Paused; can continue')
    expect(wrapper.text()).toContain('sample extension: shutdown warning')
    expect(wrapper.text()).toContain('Implemented the sample parser change')
  } finally {
    wrapper.unmount()
  }
})

it('answers a developer prompt through AiToolApproval in the parent card', async () => {
  const { useVault } = await import('../helpers/testEnv')
  useVault([])
  const prompt = {
    kind: 'permission' as const,
    prompt_id: 'sample-prompt',
    session_id: 'sample-child',
    run_id: 'sample-run',
    revision: 1 as const,
    action_digest: 'a'.repeat(64),
    expires_at: Number.MAX_SAFE_INTEGER,
    state: 'pending' as const,
    choice: null,
    installation_id: null,
    delivered: false,
    title: 'Run sample checks',
    tool_name: 'Bash',
    input: { command: 'npm test' },
  }
  const wrapper = mount(NodeDelegationCard, {
    props: {
      card: { ...nodeDelegationCardFixture(), state: 'running', prompts: [prompt] },
      nodeLabel: 'Sample node',
    },
  })
  try {
    expect(wrapper.find('.abele-tool-approval').text()).toContain('npm test')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Allow')!
      .trigger('click')
    expect(wrapper.emitted('answer')?.[0]).toEqual([prompt, 'allow', undefined])
    await wrapper.setProps({
      card: {
        ...nodeDelegationCardFixture(),
        state: 'running',
        prompts: [prompt],
        answers: { [prompt.prompt_id]: { choice: 'allow', state: 'pending' } },
      },
    })
    expect(wrapper.find('.abele-tool-approval__actions').exists()).toBe(false)
    expect(wrapper.find('.abele-tool-approval [role="status"]').text()).toContain('Allow')
    const stop = wrapper.findAll('button').find((button) => button.text() === 'Stop')
    expect(stop).toBeDefined()
    await stop!.trigger('click')
    expect(wrapper.emitted('stop')?.[0]).toEqual([prompt])
  } finally {
    wrapper.unmount()
  }
})

it('never reads a same-named vault file to preview a node write prompt', async () => {
  const { useVault } = await import('../helpers/testEnv')
  const app = useVault([{ path: 'sample.txt', content: 'Private local content' }])
  const read = vi.spyOn(app.vault, 'read')
  const prompt = {
    kind: 'permission' as const,
    prompt_id: 'sample-write',
    session_id: 'sample-child',
    run_id: 'sample-run',
    revision: 1 as const,
    action_digest: 'a'.repeat(64),
    expires_at: Number.MAX_SAFE_INTEGER,
    state: 'pending' as const,
    choice: null,
    installation_id: null,
    delivered: false,
    tool_name: 'write',
    input: { path: 'sample.txt', content: 'Remote content' },
  }
  const wrapper = mount(NodeDelegationCard, {
    props: {
      nodeLabel: 'Sample node',
      card: { ...nodeDelegationCardFixture(), state: 'running', prompts: [prompt] },
    },
  })
  try {
    await flushPromises()
    expect(read).not.toHaveBeenCalled()
    expect(wrapper.find('.abele-tool-approval').text()).toContain('Remote content')
    expect(wrapper.text()).not.toContain('Private local content')
  } finally {
    wrapper.unmount()
    read.mockRestore()
  }
})

it('offers one Stop control for a manager command while its owner approval is visible', async () => {
  const { useVault } = await import('../helpers/testEnv')
  const { default: NodeManagerRunCard } = await import('@/components/NodeManagerRunCard.vue')
  const { nodeManagerFixture } = await import('@/testing/nodeManagerFixture')
  useVault([])
  const wrapper = mount(NodeManagerRunCard, {
    props: { card: nodeManagerFixture('pending_approval') },
  })
  try {
    const stops = () => wrapper.findAll('button').filter((button) => button.text() === 'Stop')
    expect(stops()).toHaveLength(1)
    await stops()[0].trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    await wrapper.setProps({ card: nodeManagerFixture('running') })
    expect(stops()).toHaveLength(1)
  } finally {
    wrapper.unmount()
  }
})
