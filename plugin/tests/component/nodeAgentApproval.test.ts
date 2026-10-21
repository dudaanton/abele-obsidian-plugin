import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { ALWAYS_TOOL, ALWAYS_WRITES, approvalMenu } from '../helpers/approvalCard'
import AiToolApproval from '@/components/AiToolApproval.vue'
import { ChatService } from '@/ai/ChatService'
import type { ChatMessage } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
it('keeps delegation identifiers in collapsed evidence beside a readable task brief', () => {
  useVault([])
  const view = mount(AiToolApproval, {
    props: {
      message: {
        id: 'sample-delegate-call',
        role: 'tool-call',
        content: '',
        timestamp: 1,
        toolName: 'node_delegate',
        toolStatus: 'pending',
        toolParams: {
          node: 'sample-node-id',
          project_id: 'sample-project-id',
          provider: 'pi',
          title: 'Review the sample parser',
          text: 'Check the parser boundary cases.',
        },
      },
    },
  })
  try {
    expect(view.get('.setting-item-name').text()).toBe('Review the sample parser')
    expect(view.get('details code').text()).toContain('sample-project-id')
    expect(view.get('details').attributes('open')).toBeUndefined()
    expect(view.text()).toContain('Check the parser boundary cases.')
  } finally {
    view.unmount()
  }
})

describe('node writes use chat file-edit permission choices', () => {
  it('offers unattended file edits, but never a misleading per-tool Auto override', async () => {
    useVault([])
    const permissionMode = ref('confirm-all')
    vi.spyOn(ChatService, 'getInstance').mockReturnValue({
      activeSession: {
        value: {
          permissionMode,
          getToolMode: () => 'ask',
          scopeResolver: { isInScope: () => false },
        },
      },
    } as never)
    for (const toolName of [
      'node_write',
      'node_edit',
      'node_replace',
      'node_mv',
      'node_cp',
      'node_rm',
    ]) {
      const message: ChatMessage = {
        id: 'sample-call',
        role: 'tool-call',
        content: '',
        timestamp: 1,
        toolName,
        toolParams: {
          node: 'sample-node',
          project: 'sample-project',
          workspace: 'sample-target',
          path: 'sample.txt',
          text: 'new',
          expected_content_id: 'a'.repeat(64),
        },
        toolStatus: 'pending',
      }
      const view = mount(AiToolApproval, { props: { message } })
      // The rarer answers are in the card's menu.
      const titles = (await approvalMenu(view)).map((item) => item.title)
      expect(titles.includes(ALWAYS_WRITES)).toBe(
        ['node_write', 'node_edit', 'node_replace'].includes(toolName)
      )
      expect(titles.some((title) => ALWAYS_TOOL.test(title))).toBe(false)
      view.unmount()
    }
    vi.restoreAllMocks()
  })
})
