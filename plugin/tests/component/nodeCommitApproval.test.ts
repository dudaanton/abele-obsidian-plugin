import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import AiToolApproval from '@/components/AiToolApproval.vue'
import { ChatService } from '@/ai/ChatService'
import { nodeCommitPreview } from '@/node/nodeCommitPreview'
import type { ChatMessage } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import { chooseApproval } from '../helpers/approvalCard'
import { initializeLocale, t } from '@/i18n'
import { catalogs } from '@/i18n/catalogs'

vi.mock('@/node/nodeCommitPreview', () => ({ nodeCommitPreview: vi.fn() }))
afterEach(() => {
  vi.restoreAllMocks()
  initializeLocale('en', catalogs.en)
})

it('renders preview refusals in the current interface language on refresh', async () => {
  useVault([])
  vi.spyOn(ChatService.getInstance(), 'activeSession', 'get').mockReturnValue({
    value: { permissionMode: ref('confirm-all'), getToolMode: () => 'ask' },
  } as never)
  vi.mocked(nodeCommitPreview).mockRejectedValue(new Error('stale_resource'))
  const wrapper = mount(AiToolApproval, {
    props: {
      message: {
        id: 'sample-refusal',
        role: 'tool-call',
        toolName: 'node_git_commit',
        toolStatus: 'pending',
        toolParams: {},
        content: '',
        timestamp: 1,
      } as ChatMessage,
    },
  })
  try {
    await flushPromises()
    expect(wrapper.text()).toContain(t('node.error.staleResource'))
    expect(wrapper.text()).not.toContain('(stale_resource)')
    expect(wrapper.get('button.mod-cta').attributes('disabled')).toBeDefined()
    const refresh = wrapper.findAll('button').find((button) => button.text() === 'Refresh')!
    expect(refresh).toBeDefined()
    expect(refresh.classes()).not.toContain('clickable-icon')
    const calls = vi.mocked(nodeCommitPreview).mock.calls.length
    await refresh.trigger('click')
    await flushPromises()
    expect(vi.mocked(nodeCommitPreview).mock.calls.length).toBe(calls + 1)
    expect(wrapper.get('button.mod-cta').attributes('disabled')).toBeDefined()
    initializeLocale('ru', catalogs.ru)
    await wrapper.setProps({ disabled: true })
    await flushPromises()
    expect(wrapper.text()).toContain(t('node.error.staleResource'))
    expect(wrapper.text()).not.toContain('The folder or worktree has changed')
  } finally {
    wrapper.unmount()
  }
})

it('reads fresh staged evidence for a refreshed or replaced request at the same head', async () => {
  useVault([])
  vi.spyOn(ChatService.getInstance(), 'activeSession', 'get').mockReturnValue({
    value: { permissionMode: ref('confirm-all'), getToolMode: () => 'ask' },
  } as never)
  vi.mocked(nodeCommitPreview)
    .mockResolvedValueOnce({ files: [] })
    .mockResolvedValue({ files: [{ path: 'src/sample.ts', patch: 'sample patch' }] })
  const message = {
    id: 'sample-first',
    toolCallId: 'sample-first',
    role: 'tool-call',
    toolName: 'node_git_commit',
    toolStatus: 'pending',
    toolParams: { workspace: 'sample-worktree', expected_head: 'a'.repeat(40) },
    content: '',
    timestamp: 1,
  } as ChatMessage
  const wrapper = mount(AiToolApproval, { props: { message } })
  try {
    await flushPromises()
    expect(wrapper.text()).not.toContain('src/sample.ts')
    const refreshed = { ...message, toolParams: { ...message.toolParams } }
    await wrapper.setProps({ message: refreshed })
    await flushPromises()
    expect(wrapper.text()).toContain('src/sample.ts')
    const calls = vi.mocked(nodeCommitPreview).mock.calls.length
    await wrapper.setProps({
      message: { ...refreshed, id: 'sample-second', toolCallId: 'sample-second' },
    })
    await flushPromises()
    expect(vi.mocked(nodeCommitPreview).mock.calls.length).toBe(calls + 1)
  } finally {
    wrapper.unmount()
  }
})

it('refreshes the staged evidence when the owner edits the commit target', async () => {
  useVault([])
  vi.spyOn(ChatService.getInstance(), 'activeSession', 'get').mockReturnValue({
    value: {
      permissionMode: ref('confirm-all'),
      getToolMode: () => 'ask',
    },
  } as never)
  vi.mocked(nodeCommitPreview).mockImplementation(async (_owner, args) => ({
    files: [{ path: `${args.workspace}/sample.ts`, patch: 'sample patch' }],
  }))
  const wrapper = mount(AiToolApproval, {
    props: {
      message: {
        id: 'sample-commit',
        role: 'tool-call',
        toolName: 'node_git_commit',
        toolStatus: 'pending',
        toolParams: { workspace: 'sample-first' },
        content: '',
        timestamp: 1,
      } as ChatMessage,
    },
  })
  try {
    await flushPromises()
    expect(wrapper.text()).toContain('sample-first/sample.ts')
    await chooseApproval(wrapper, 'Edit before allowing')
    await wrapper.get('textarea').setValue(JSON.stringify({ workspace: 'sample-second' }))
    await flushPromises()
    expect(wrapper.text()).toContain('sample-second/sample.ts')
    expect(wrapper.text()).not.toContain('sample-first/sample.ts')
  } finally {
    wrapper.unmount()
  }
})

it('shows a provider escalation as command, folder and reason with protocol identifiers folded', async () => {
  useVault([])
  const input = {
    command: "npm test -- 'sample case'",
    cwd: '/sample/project',
    reason: 'Run the sample checks',
    request_id: 42,
    thread_id: 'sample-hidden-thread',
  }
  const wrapper = mount(AiToolApproval, {
    props: {
      nodePrompt: {
        prompt_id: 'sample',
        tool_name: 'codex.command',
        kind: 'permission',
        input,
        state: 'pending',
      } as never,
      message: { toolName: 'codex.command', toolParams: input } as never,
    },
  })
  try {
    expect(wrapper.text()).toContain(input.command)
    expect(wrapper.text()).toContain(input.cwd)
    expect(wrapper.text()).toContain(input.reason)
    expect(wrapper.text()).not.toContain(input.thread_id)
    await wrapper.get('[data-manager-evidence] .abele-disclosure__control').trigger('click')
    expect(wrapper.text()).toContain(input.thread_id)
  } finally {
    wrapper.unmount()
  }
})

it('shows staged files on the commit approval with patches folded until opened', async () => {
  useVault([])
  vi.spyOn(ChatService.getInstance(), 'activeSession', 'get').mockReturnValue({
    value: {
      permissionMode: ref('confirm-all'),
      getToolMode: () => 'ask',
    },
  } as never)
  vi.mocked(nodeCommitPreview).mockResolvedValue({
    files: [{ path: 'src/sample.ts', patch: '-before\n+after' }],
  })
  const wrapper = mount(AiToolApproval, {
    props: {
      message: {
        id: 'sample-commit',
        role: 'tool-call',
        toolName: 'node_git_commit',
        toolStatus: 'pending',
        toolParams: { message: 'Sample change' },
        content: '',
        timestamp: 1,
      } as ChatMessage,
    },
  })
  try {
    await flushPromises()
    expect(wrapper.text()).toContain('src/sample.ts')
    expect(wrapper.text()).not.toContain('+after')
    await wrapper.get('[data-node-commit-diff] .abele-disclosure__control').trigger('click')
    expect(wrapper.text()).toContain('+after')
  } finally {
    wrapper.unmount()
  }
})
