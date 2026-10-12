import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import AiChatMessage from '@/components/AiChatMessage.vue'
import AiSubAgentRun from '@/components/AiSubAgentRun.vue'
import type { ChatMessage } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

let view: VueWrapper | undefined
beforeEach(() => useVault([]))
afterEach(() => {
  view?.unmount()
  view = undefined
})

describe('visible helper and reply-change lines', () => {
  it('keeps a helper call discoverable when find asks for its hidden raw tool name', async () => {
    const message: ChatMessage = {
      id: 'sample-helper-call',
      role: 'tool-call',
      content: '',
      timestamp: 1,
      toolName: 'delegate',
      toolParams: { task: 'Read the sample source' },
      toolStatus: 'approved',
      toolResult: 'Sample done',
      subAgentRun: {
        runId: 'sample-run',
        agentName: 'Sample helper',
        branchCount: 1,
        status: 'done',
      },
    }
    view = mount(AiChatMessage, { props: { message } })
    expect(view.find('.abele-chat-msg__tool-line').exists()).toBe(false)
    view.vm.revealPart('tool')
    await view.vm.$nextTick()
    expect(view.get('[data-find-part="tool"]').text()).toContain('delegate')
  })
  it('does not invent one task for an empty helper run', () => {
    view = mount(AiSubAgentRun, {
      props: {
        run: {
          runId: 'sample-empty-run',
          agentName: 'Sample helper',
          branchCount: 0,
          status: 'error',
        },
      },
    })
    expect(view.get('.tree-item-self').text()).toContain('Sample helper · 0 tasks')
  })
})
