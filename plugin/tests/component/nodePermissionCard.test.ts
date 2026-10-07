import { mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import NodePermissionCard from '@/components/NodePermissionCard.vue'
import { useVault } from '../helpers/testEnv'
it('shows one accent approval row, a short summary and expandable original arguments without vault reads', async () => {
  const app = useVault([{ path: 'sample.txt', raw: 'LOCAL SAMPLE' }]),
    read = vi.spyOn(app.vault, 'read')
  const prompt = {
    prompt_id: 'sample',
    state: 'pending',
    tool_name: 'Edit',
    input: { file_path: 'sample.txt', old_string: 'before', new_string: 'after' },
    expires_at: Date.now() + 300000,
  }
  const wrapper = mount(NodePermissionCard, {
    props: { prompt: prompt as never, disabled: false },
    global: { stubs: { Diff: true } },
  })
  try {
    expect(wrapper.text()).toContain('Edit')
    expect(wrapper.text()).toContain('sample.txt')
    expect(wrapper.get('details').attributes('open')).toBeUndefined()
    expect(wrapper.get('.abele-tool-approval__actions button.mod-cta').text()).toBe('Approve')
    expect(wrapper.findAll('.abele-tool-approval__actions button').map((b) => b.text())).toEqual([
      'Approve',
      'Deny',
    ])
    await wrapper.get('button.mod-cta').trigger('click')
    expect(wrapper.emitted('answer')).toEqual([['allow']])
    expect(wrapper.text()).toContain('in 5 min')
    expect(read).not.toHaveBeenCalled()
  } finally {
    wrapper.unmount()
  }
})
