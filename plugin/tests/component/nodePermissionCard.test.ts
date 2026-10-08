import { mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import NodePermissionCard from '@/components/NodePermissionCard.vue'
import { useVault } from '../helpers/testEnv'
it.each(['select', 'input'] as const)(
  'answers a %s question with its exact value and cancels without a value',
  async (kind) => {
    useVault([])
    const prompt = {
      kind,
      prompt_id: 'sample-question',
      state: 'pending',
      title: 'Choose the next action',
      options: ['Inspect', 'Stop'],
      expires_at: Date.now() + 300000,
    }
    const wrapper = mount(NodePermissionCard, {
      props: { prompt: prompt as never, disabled: false },
    })
    try {
      expect(wrapper.text()).toContain(prompt.title)
      if (kind === 'select') {
        expect(wrapper.get('button.mod-cta').attributes('disabled')).toBeDefined()
        await wrapper.get('select[aria-label="Question answer"]').setValue('Inspect')
      } else await wrapper.get('textarea[aria-label="Question answer"]').setValue('Sample response')
      await wrapper.get('button.mod-cta').trigger('click')
      expect(wrapper.emitted('answer')![0]).toEqual([
        'allow',
        kind === 'select' ? 'Inspect' : 'Sample response',
      ])
      await wrapper
        .findAll('button')
        .find((b) => b.text() === 'Deny')!
        .trigger('click')
      expect(wrapper.emitted('answer')![1]).toEqual(['deny'])
    } finally {
      wrapper.unmount()
    }
  }
)

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
