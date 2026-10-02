import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import AiToolApproval from '@/components/AiToolApproval.vue'
import Diff from '@/components/Diff.vue'
import { ChatService } from '@/ai/ChatService'
import type { ChatMessage } from '@/ai/types'
import { wordRevision } from '@/ooxml/write'
import { useVault } from '../helpers/testEnv'
import { sampleXlsx } from '../fixtures/xlsx/sampleXlsx'
afterEach(() => vi.restoreAllMocks())
it('previews binary cell changes with formulas in the existing confirmation without writing', async () => {
  const app = useVault([])
  const data = sampleXlsx()
  await app.vault.createBinary('sample.xlsx', data.buffer as ArrayBuffer)
  const session = {
    getToolMode: () => 'ask',
    scopeResolver: { isInScope: () => true },
    permissionMode: ref('confirm-all'),
    toolModes: ref({ xlsx_write: 'ask' }),
  }
  vi.spyOn(ChatService.getInstance(), 'activeSession', 'get').mockReturnValue(ref(session) as never)
  const wrapper = mount(AiToolApproval, {
    props: {
      message: {
        id: 'sample-call',
        role: 'tool-call',
        content: '',
        timestamp: 1,
        toolName: 'xlsx_write',
        toolStatus: 'pending',
        toolParams: {
          path: 'sample.xlsx',
          revision: wordRevision(data),
          sheet: 'Sample',
          range: 'B2',
          values: [[25]],
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
  expect(diff.props('textLeft')).toContain('B2: 20')
  expect(diff.props('textRight')).toContain('B2: 25')
  expect(app.stats.modify).toBe(0)
  wrapper.unmount()
})
