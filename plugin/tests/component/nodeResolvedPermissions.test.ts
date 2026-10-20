import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import NodeMessageTree from '@/components/NodeMessageTree.vue'
import NodePermissionCard from '@/components/NodePermissionCard.vue'
import ChatToolRun from '@/components/ChatToolRun.vue'
import { useVault } from '../helpers/testEnv'

it('keeps a resolved permission and its proposed diff inside the collapsed tool row', async () => {
  useVault([])
  const prompt = {
    prompt_id: 'sample-prompt',
    state: 'resolved',
    tool_name: 'edit',
    choice: 'deny',
    input: { path: 'sample.txt' },
  }
  const wrapper = mount(NodeMessageTree, {
    props: {
      messages: [
        {
          id: 'tool-1',
          role: 'tool-call',
          content: '',
          timestamp: 0,
          toolName: 'edit',
          toolParams: {},
          toolStatus: 'rejected',
          toolExecution: 'not-run',
        },
        { id: 'answer-1', role: 'assistant', content: 'No change made.', timestamp: 1 },
      ],
      children: {},
      openResource: () => {},
      toolPrompts: { 'tool-1': [prompt] },
      promptDiffs: { 'sample-prompt': [{ path: 'sample.txt', old: 'before', new: 'after' }] },
    } as never,
  })
  try {
    expect(wrapper.text()).not.toContain('Permission resolved')
    wrapper.getComponent(ChatToolRun).vm.$emit('update:open', true)
    await wrapper.vm.$nextTick()
    expect(wrapper.findComponent(NodePermissionCard).exists()).toBe(true)
    expect(wrapper.findComponent(NodePermissionCard).props('diffs')).toHaveLength(1)
  } finally {
    wrapper.unmount()
  }
})
