import { expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { Prompt } from '@abele/node-client'
import NodePermissionCard from '@/components/NodePermissionCard.vue'
import AiToolApproval from '@/components/AiToolApproval.vue'
import { NodeChatPresenter } from '@/node/NodeChatPresenter'
import { ChatService } from '@/ai/ChatService'
import { useVault } from '../helpers/testEnv'
const prompt: Prompt = {
  kind: 'permission',
  prompt_id: 'sample-prompt',
  session_id: 'sample-session',
  run_id: 'obsidian:sample-invocation',
  revision: 1,
  action_digest: 'a'.repeat(64),
  expires_at: Number.MAX_SAFE_INTEGER,
  state: 'pending',
  choice: null,
  installation_id: null,
  delivered: false,
  tool_name: 'create',
  input: {
    invocation_id: 'sample-invocation',
    tool_name: 'create',
    arguments: { path: 'sample.md', content: 'The exact proposed text.' },
    preview: { path: 'sample.md', content: 'The exact proposed text.' },
    vault_id: 'sample-vault',
    revision: 'sample-revision',
  },
}
it('uses the ordinary approval card and routes answers without accessing an active vault chat', async () => {
  useVault([{ path: 'sample.md', content: 'Unrelated local text' }])
  const activeChat = vi.spyOn(ChatService, 'getInstance').mockImplementation(() => {
    throw new Error('Must not use the active vault chat')
  })
  const view = mount(NodePermissionCard, { props: { prompt, disabled: false } })
  try {
    expect(view.findComponent(AiToolApproval).exists()).toBe(true)
    expect(view.text()).toContain('The exact proposed text.')
    expect(view.text()).not.toContain('Unrelated local text')
    await view
      .findAll('button')
      .find((button) => button.text() === 'Allow')!
      .trigger('click')
    expect(view.emitted('answer')).toEqual([['allow', undefined]])
    expect(activeChat).not.toHaveBeenCalled()
  } finally {
    view.unmount()
    vi.restoreAllMocks()
  }
})
it('cancels the exact invocation on Stop without interrupting a fabricated native run ID', async () => {
  const request = vi.fn(async () => ({})),
    refresh = vi.fn(async () => {}),
    report = vi.fn(),
    interrupt = vi.fn()
  const stale = { ...prompt, input: { ...prompt.input, invocation_id: 'another-invocation' } }
  await NodeChatPresenter.prototype.stopFromApproval.call(
    {
      reference: { sessionId: prompt.session_id },
      projection: { value: { prompts: [prompt] } },
      connection: { client: { connected: true, request } },
      refresh,
      report,
      interrupt,
    } as never,
    stale
  )
  expect(request).toHaveBeenCalledWith('obsidian.tools.v1.cancel', {
    invocation_id: 'sample-invocation',
  })
  expect(interrupt).not.toHaveBeenCalled()
  expect(report).not.toHaveBeenCalled()
})
