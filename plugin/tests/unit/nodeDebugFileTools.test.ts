import { expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import NodePathDebugFile from '@/components/nodeWork/NodePathDebugFile.vue'
import NodeFileTools from '@/components/nodeWork/NodeFileTools.vue'
vi.mock('@/node/NodePathDebugSource', () => ({
  mountNodePathDebugSource: () => ({ destroy() {}, update() {}, reveal() {} }),
}))
it('keeps repository search and line blame available beside the debug margin', async () => {
  const blame = vi.fn(async () => [])
  const wrapper = mount(NodePathDebugFile, {
    props: {
      context: {
        registrationId: 'sample-registration',
        conversationId: 'sample-chat',
        sourceId: 'sample-source',
        debugSessionId: 'sample-debug',
        incarnation: 'sample-incarnation',
        path: 'src/sample.ts',
        text: 'const sample = 1',
      },
      repository: { blame } as never,
      revision: 'sample-ref',
    },
    global: { stubs: { NodeFileTools: true } },
  })
  expect(wrapper.findComponent(NodeFileTools).exists()).toBe(true)
  await wrapper.find('[aria-label="Toggle line blame"]').trigger('click')
  await flushPromises()
  expect(blame).toHaveBeenCalledWith('sample-ref', 'src/sample.ts')
  wrapper.unmount()
})
