import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { initializeLocale } from '@/i18n'
import { english } from '@/i18n/catalogs'
import { streamBMeta as russian } from '@/i18n/locales/ru/streamBMeta'
import NodeDelegationCard from '@/components/NodeDelegationCard.vue'
import { nodeDelegationCardFixture } from '@/testing/nodeDelegationFixture'
import { DelegationStorageSchema } from '@/node/delegation'
it('summarizes a worker shell approval and keeps its exact input in details', async () => {
  const { default: AiToolApproval } = await import('@/components/AiToolApproval.vue')
  const prompt = {
    prompt_id: 'sample',
    tool_name: 'Bash',
    title: 'Run command',
    input: { command: 'npm test' },
    state: 'pending',
  }
  const wrapper = mount(AiToolApproval, {
    props: {
      nodePrompt: prompt as never,
      message: { toolName: 'Bash', toolParams: prompt.input } as never,
    },
  })
  try {
    expect(wrapper.text()).toContain('npm test')
    expect(wrapper.find('pre').exists()).toBe(false)
    await wrapper.get('.abele-disclosure__control').trigger('click')
    expect(wrapper.get('pre').text()).toContain('"command"')
  } finally {
    wrapper.unmount()
  }
})
it('shows question text and choices instead of serialized question parameters', async () => {
  const { default: AiToolApproval } = await import('@/components/AiToolApproval.vue')
  const wrapper = mount(AiToolApproval, {
    props: {
      message: {
        toolName: 'questions',
        toolParams: { questions: [{ question: 'Keep the sample?', options: ['Keep', 'Remove'] }] },
      } as never,
    },
  })
  try {
    expect(wrapper.text()).toContain('Keep the sample?')
    expect(wrapper.findAll('li').map((row) => row.text())).toEqual(['Keep', 'Remove'])
    expect(wrapper.text()).not.toContain('"question"')
  } finally {
    wrapper.unmount()
  }
})
it('shows shell quotes and backslashes verbatim outside JSON details', async () => {
  const { default: NodeManagerRunCard } = await import('@/components/NodeManagerRunCard.vue')
  const { nodeManagerFixture } = await import('@/testing/nodeManagerFixture')
  const card = nodeManagerFixture()
  const command = `printf '%s' "a;b" 'c$SAMPLE' "$(echo sample)"; echo $'tab\\there'`
  card.prompts[0].input = {
    method: 'command.v1.run',
    params: { command },
    cwd: '/workspace/sample',
  }
  const wrapper = mount(NodeManagerRunCard, { props: { card } })
  try {
    expect(wrapper.get('[data-manager-approval] .setting-item-description').text()).toBe(command)
    expect(wrapper.get('[data-manager-evidence]').attributes('open')).toBeUndefined()
  } finally {
    wrapper.unmount()
  }
})
it.each([
  '\n',
  '\r',
  '\t',
  '\u202e',
  '\u200b',
  '\u0000',
  '\u001b',
  '\u0085',
  '\ufeff',
  '\u{e0001}',
])('makes command evidence visible for %j', async (hidden) => {
  const { default: NodeManagerRunCard } = await import('@/components/NodeManagerRunCard.vue')
  const { nodeManagerFixture } = await import('@/testing/nodeManagerFixture')
  const card = nodeManagerFixture()
  card.prompts[0].input = {
    method: 'command.v1.run',
    params: {
      argv: ['printf', `sample${hidden}argument`],
      worktree_id: `tree${hidden}id`,
      session_id: `session${hidden}id`,
    },
    cwd: `/workspace/sample${hidden}folder`,
  }
  const wrapper = mount(NodeManagerRunCard, { props: { card } })
  try {
    const summary = wrapper
      .get('[data-manager-approval]')
      .findAll('.setting-item-description')
      .map((row) => row.text())
      .join(' ')
    expect(summary).not.toContain(hidden)
    expect(summary).toContain('sample-session')
    expect(summary).toContain('tree')
    const escaped = [...hidden]
      .flatMap((char) => char.split(''))
      .map((char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
      .join('')
    const marker =
      ({ '\n': '\\n', '\r': '\\r', '\t': '\\t' } as Record<string, string>)[hidden] ?? escaped
    expect(summary).toContain(`sample${marker}argument`)
    expect(summary).toContain(`tree${marker}id`)
    expect(summary).toContain(`session${marker}id`)
    expect(wrapper.get('[data-manager-evidence]').attributes('open')).toBeDefined()
    const evidence = wrapper.get('[data-manager-evidence] code').text()
    if (hidden !== '\n') expect(evidence).not.toContain(hidden)
    expect(JSON.parse(evidence)).toEqual(card.prompts[0].input)
  } finally {
    wrapper.unmount()
  }
})
it('shows shell commands and both integration worktrees without hidden formatting', async () => {
  const { default: NodeManagerRunCard } = await import('@/components/NodeManagerRunCard.vue')
  const { nodeManagerFixture } = await import('@/testing/nodeManagerFixture')
  const card = nodeManagerFixture()
  card.prompts[0].input = {
    method: 'command.v1.run',
    params: { command: 'echo sample\nnext\u202e', project_id: 'sample-project' },
    cwd: '/workspace/sample',
  }
  const wrapper = mount(NodeManagerRunCard, { props: { card } })
  try {
    expect(wrapper.get('[data-manager-approval]').text()).toContain('echo sample\\nnext\\u202e')
    expect(wrapper.get('[data-manager-approval]').text()).toContain('sample-project')
    card.prompts[0].input = {
      method: 'git.v1.integrate',
      params: {
        source_worktree_id: 'sample-source',
        worktree_id: 'sample-target',
        source_branch: 'feature',
        target_branch: 'main',
      },
    }
    await wrapper.setProps({ card: { ...card, prompts: [{ ...card.prompts[0] }] } })
    const summary = wrapper.get('[data-manager-approval]').text()
    expect(summary).toContain('sample-source')
    expect(summary).toContain('sample-target')
    expect(summary).toContain('sample-session')
  } finally {
    wrapper.unmount()
  }
})
it('presents command approvals as command and folder with raw evidence collapsed', async () => {
  const { default: NodeManagerRunCard } = await import('@/components/NodeManagerRunCard.vue')
  const { nodeManagerFixture } = await import('@/testing/nodeManagerFixture')
  const wrapper = mount(NodeManagerRunCard, { props: { card: nodeManagerFixture() } })
  try {
    expect(wrapper.get('[data-manager-approval]').text()).toContain('npm test')
    expect(wrapper.get('[data-manager-approval]').text()).toContain('/workspace/sample-project')
    expect(wrapper.get('[data-manager-evidence]').attributes('open')).toBeUndefined()
  } finally {
    wrapper.unmount()
  }
})
it('replaces obsolete controller approval instructions while preserving the question', () => {
  const card = nodeDelegationCardFixture()
  card.reports = [
    {
      seq: 3,
      kind: 'question',
      text: 'Waiting for owner approval. Open child session sample-session to answer prompt sample-prompt. The controller cannot approve it.',
    },
  ]
  const wrapper = mount(NodeDelegationCard, { props: { card, nodeLabel: 'Sample node' } })
  try {
    expect(wrapper.text()).not.toContain('sample-prompt')
    expect(wrapper.text()).not.toContain('controller cannot approve')
    expect(wrapper.text()).toContain('Answer the pending action')
  } finally {
    wrapper.unmount()
  }
})
it('explains a deadline pause while retaining the owner prompt', () => {
  const wrapper = mount(NodeDelegationCard, {
    props: {
      nodeLabel: 'Sample node',
      card: {
        ...nodeDelegationCardFixture(),
        state: 'stopped',
        reason: 'time_limit',
        pendingHumanPrompts: 1,
      },
    },
  })
  try {
    expect(wrapper.text()).toContain('Time limit reached')
    expect(wrapper.text()).toContain('waiting for your answer')
  } finally {
    wrapper.unmount()
  }
})
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
it('ignores legacy delegation grants without a migration prompt', () => {
  expect(
    DelegationStorageSchema.parse({ grants: { obsolete: { revoked: true } }, tasks: {} })
  ).toEqual({ tasks: {} })
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
