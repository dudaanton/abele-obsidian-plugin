import { mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import ChatToolRun from '@/components/ChatToolRun.vue'
import ChatToolFiles from '@/components/chat/ChatToolFiles.vue'
import { toolFilePaths } from '@/ai/toolFiles'
import type { ChatMessage } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import { parseChat, serializeChat } from '@/ai/ChatLog'
import { UpdateTranscript } from '@/node/updateTranscript'
import { setup } from '../helpers/nodeAgentFixture'
import { openNodeToolFile } from '@/node/openToolFile'
import { NodeService } from '@/node/NodeService'
import { openNodeChatResource } from '@/node/nodeChatPlace'
import { openVaultFile } from '@/ai/openChat'
import { toolSummary } from '@/ai/toolLine'

vi.mock('@/node/nodeChatPlace', () => ({ openNodeChatResource: vi.fn() }))
vi.mock('@/ai/openChat', () => ({ openVaultFile: vi.fn() }))

const call = (extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'sample-call',
  role: 'tool-call',
  timestamp: 1,
  content: '',
  toolName: 'read',
  toolParams: { path: 'Sample/notes.md' },
  toolStatus: 'approved',
  toolResult: 'Raw sample contents',
  ...extra,
})
it.each(['read', 'write', 'create', 'Read', 'Write', 'edit_file', 'node_read', 'node_write'])(
  'extracts structured paths for %s',
  (toolName) => {
    expect(toolFilePaths(call({ toolName }))).toEqual(['Sample/notes.md'])
  }
)
it('keeps all provider paths without duplicates or prose guesses', () => {
  expect(toolFilePaths(call({ toolPaths: ['src/one.ts', 'src/two.ts', 'src/one.ts'] }))).toEqual([
    'src/one.ts',
    'src/two.ts',
  ])
  expect(
    toolFilePaths(call({ toolName: 'Bash', toolParams: { command: 'cat sample.md' } }))
  ).toEqual([])
  expect(toolFilePaths(call({ toolParams: { path: { bogus: true } } }))).toEqual([])
  expect(toolFilePaths(call({ toolParams: {}, toolResult: 'Read sample.md' }))).toEqual([])
})

it('indexes the same full paths that the tool line shows', () => {
  const path = 'Sample/' + 'long-folder/'.repeat(25) + 'sample.md'
  expect(toolSummary(call({ toolParams: { path, description: 'A generic description' } }))).toBe(
    path
  )
  expect(toolSummary(call({ toolPaths: ['src/one.ts', 'src/two.ts'] }))).toBe(
    'src/one.ts src/two.ts'
  )
})
it('keeps paths outside folded raw details and opens the remote context by keyboard', async () => {
  useVault([])
  const open = vi.fn()
  const message = call({ toolPaths: ['src/one.ts', 'src/two.ts'] })
  const wrapper = mount(ChatToolRun, {
    props: { id: 'run', calls: [message], open: false, resourceOpener: open },
    slots: { default: 'RAW DETAILS' },
  })
  try {
    expect(wrapper.findAll('[role="link"]').map((a) => a.text())).toEqual([
      'src/one.ts',
      'src/two.ts',
    ])
    await wrapper.findAll('[role="link"]')[1].trigger('keydown', { key: 'Enter' })
    expect(open).toHaveBeenCalledWith('src/two.ts')
    await wrapper.setProps({ open: true })
    expect(wrapper.findComponent(ChatToolFiles).exists()).toBe(false)
  } finally {
    wrapper.unmount()
  }
})
it('shows full long and failed paths and leaves missing paths empty', () => {
  useVault([])
  const path = 'Sample/' + 'long-folder/'.repeat(25) + 'missing.md'
  const wrapper = mount(ChatToolFiles, {
    props: { message: call({ toolStatus: 'rejected', toolParams: { path } }) },
  })
  try {
    expect(wrapper.get('[role="link"]').text()).toBe(path)
    expect(wrapper.text()).not.toContain('Raw sample contents')
  } finally {
    wrapper.unmount()
  }
  const missing = mount(ChatToolFiles, { props: { message: call({ toolParams: {} }) } })
  expect(missing.find('[role="link"]').exists()).toBe(false)
  missing.unmount()
})

it('opens vault paths locally and never resolves an old node call as a coincident vault file', async () => {
  useVault([{ path: 'Sample/notes.md', raw: 'Sample local content' }])
  vi.mocked(openVaultFile).mockClear()
  const local = mount(ChatToolFiles, { props: { message: call() } })
  const remote = mount(ChatToolFiles, { props: { message: call({ toolName: 'node_read' }) } })
  try {
    await local.get('[role="link"]').trigger('click')
    expect(openVaultFile).toHaveBeenCalledExactlyOnceWith('Sample/notes.md')
    vi.mocked(openVaultFile).mockClear()
    expect(remote.get('[role="link"]').attributes('aria-disabled')).toBe('true')
    await remote.get('[role="link"]').trigger('click')
    expect(openVaultFile).not.toHaveBeenCalled()
  } finally {
    local.unmount()
    remote.unmount()
  }
})

it('retains every provider location through live updates and journal replay', () => {
  const replay = () => {
    const messages = new Map<string, ChatMessage>()
    const transcript = new UpdateTranscript(
      (id, role) => {
        if (!messages.has(id)) messages.set(id, call({ id, role, toolParams: {} }))
        return messages.get(id)!
      },
      { context: vi.fn(), compactionUpdate: vi.fn(), summary: vi.fn() }
    )
    transcript.apply(
      {
        kind: 'tool_call',
        tool_call_id: 'files',
        tool_kind: 'edit',
        title: 'Edit files',
        status: 'in_progress',
        locations: [{ path: 'src/one.ts' }, { path: 'src/two.ts' }],
      },
      'codex',
      'run',
      1
    )
    expect(toolFilePaths([...messages.values()][0])).toEqual(['src/one.ts', 'src/two.ts'])
    transcript.apply(
      {
        kind: 'tool_call_update',
        tool_call_id: 'files',
        status: 'completed',
        content: [{ type: 'content', text: 'Done' }],
      },
      'codex',
      'run',
      2
    )
    const completed = structuredClone([...messages.values()][0])
    transcript.apply(
      { kind: 'tool_call_update', tool_call_id: 'files', locations: [] },
      'codex',
      'run',
      3
    )
    expect(toolFilePaths([...messages.values()][0])).toEqual([])
    return completed
  }
  expect(toolFilePaths(replay())).toEqual(toolFilePaths(replay()))
})

it('persists the executed node identity and opens only that remote place', async () => {
  const { session, factory } = setup()
  const { createNodeAgentTools } = await import('@/ai/tools/node/agent')
  const reported = vi.fn()
  await createNodeAgentTools(factory)
    .find((tool) => tool.name === 'node_read')!
    .execute(
      'sample-call',
      {
        node: 'sample-node',
        project: 'sample-project',
        workspace: 'sample-workspace',
        target_kind: 'workspace',
        path: 'sample.txt',
      },
      undefined,
      {
        session,
        onNodeFileTarget: reported,
        interactive: true,
      } as unknown as import('@/ai/toolContext').ToolContext
    )
  const target = reported.mock.calls[0][0]
  expect(target).toEqual({
    node_id: 'sample-node',
    project_id: 'sample-project',
    target: { kind: 'workspace', workspace_id: 'sample-workspace' },
  })
  const message = call({ toolName: 'node_read', toolNodeTarget: target })
  const saved = serializeChat({
    metadata: {
      type: 'abele-chat',
      title: 'Sample',
      created: '2026-01-01',
      providerId: 'sample',
      modelId: 'sample',
    },
    messages: [message],
    internalMessages: [],
  })
  expect(parseChat(saved).messages[0].toolNodeTarget).toEqual(target)
  vi.spyOn(NodeService, 'getInstance').mockReturnValue({
    nodes: { value: [{ id: 'sample-registration', expectedNodeId: 'sample-node' }] },
  } as unknown as NodeService)
  try {
    await openNodeToolFile('Sample/notes.md', target)
    expect(openNodeChatResource).toHaveBeenCalledWith('Sample/notes.md', {
      nodeId: 'sample-node',
      registrationId: 'sample-registration',
      projectId: 'sample-project',
      kind: 'workspace',
      id: 'sample-workspace',
    })
    vi.mocked(openNodeChatResource).mockClear()
    vi.mocked(NodeService.getInstance).mockReturnValue({
      nodes: { value: [] },
    } as unknown as NodeService)
    await expect(openNodeToolFile('Sample/notes.md', target)).rejects.toThrow('unavailable')
    expect(openNodeChatResource).not.toHaveBeenCalled()
  } finally {
    vi.restoreAllMocks()
  }
})
