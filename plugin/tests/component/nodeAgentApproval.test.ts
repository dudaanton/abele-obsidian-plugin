import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import AiToolApproval from '@/components/AiToolApproval.vue'
import Button from '@/components/obsidian/Button.vue'
import { ChatService } from '@/ai/ChatService'
import type { ChatMessage } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

describe('node writes use chat file-edit permission choices', () => {
  it('offers unattended file edits, but never a misleading per-tool Auto override', () => {
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
      const labels = view.findAllComponents(Button).map((button) => button.props('text'))
      expect(labels.some((label) => label?.includes('Always allow writes'))).toBe(
        ['node_write', 'node_edit', 'node_replace'].includes(toolName)
      )
      expect(labels.includes('Always allow')).toBe(false)
      view.unmount()
    }
    vi.restoreAllMocks()
  })
})
