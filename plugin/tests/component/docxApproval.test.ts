import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import AiToolApproval from '@/components/AiToolApproval.vue'
import Diff from '@/components/Diff.vue'
import { ChatService } from '@/ai/ChatService'
import type { ChatMessage } from '@/ai/types'
import { wordRevision } from '@/word/write'
import { useVault } from '../helpers/testEnv'
import { sampleDocx } from '../fixtures/docx/sampleDocx'

afterEach(() => vi.restoreAllMocks())
it('previews a Word text edit in the existing approval card before any binary write', async () => {
  const app = useVault([])
  const data = sampleDocx()
  await app.vault.createBinary('sample.docx', data.buffer as ArrayBuffer)
  const session = {
    getToolMode: () => 'ask',
    scopeResolver: { isInScope: () => true },
    permissionMode: ref('confirm-all'),
    toolModes: ref({ docx_edit: 'ask' }),
  }
  vi.spyOn(ChatService.getInstance(), 'activeSession', 'get').mockReturnValue(ref(session) as never)
  const wrapper = mount(AiToolApproval, {
    props: {
      message: {
        id: 'sample-call',
        role: 'tool-call',
        content: '',
        timestamp: 1,
        toolName: 'docx_edit',
        toolStatus: 'pending',
        toolParams: {
          path: 'sample.docx',
          revision: wordRevision(data),
          operation: 'replace',
          paragraph: 1,
          old_text: 'report',
          new_text: 'summary',
        },
      } as ChatMessage,
    },
  })
  for (let i = 0; i < 30 && !wrapper.findComponent(Diff).exists(); i++) {
    await new Promise((r) => setTimeout(r, 10))
    await flushPromises()
  }
  const diff = wrapper.findComponent(Diff)
  expect(diff.exists()).toBe(true)
  expect(diff.props('textLeft')).toContain('Sample report')
  expect(diff.props('textRight')).toContain('Sample summary')
  expect(app.stats.modify).toBe(0)
  wrapper.unmount()
})
