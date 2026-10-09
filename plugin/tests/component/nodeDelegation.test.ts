import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import NodeDelegationGrantsDialog from '@/components/NodeDelegationGrantsDialog.vue'
import NodeDelegationCard from '@/components/NodeDelegationCard.vue'
import {
  nodeDelegationGrantsFixture,
  nodeDelegationCardFixture,
} from '@/testing/nodeDelegationFixture'
const shell = { Modal: { template: '<div><slot /></div>' } }
it('requires explicit action/fake confirmation, resets it when the selected authority changes, and revokes only through owner UI', async () => {
  const props = nodeDelegationGrantsFixture()
  const approve = vi.spyOn(props.controller, 'approve')
  const revoke = vi.spyOn(props.controller, 'revoke')
  const wrapper = mount(NodeDelegationGrantsDialog, { props, global: { stubs: shell } })
  try {
    await flushPromises()
    await wrapper.get('[aria-label="Delegation project"]').setValue('sample-project')
    await wrapper.get('[aria-label="Delegation provider"]').setValue('pi')
    const button = () => wrapper.findAll('button').find((b) => b.text() === 'Approve grant')!
    expect(button().attributes('disabled')).toBeDefined()
    await wrapper.get('[aria-label="Approve delegation actions"]').trigger('click')
    expect(button().attributes('disabled')).toBeUndefined()
    await wrapper.get('[aria-label="Delegation provider"]').setValue('fake')
    expect(
      wrapper.get('[aria-label="Approve delegation actions"]').attributes('aria-checked')
    ).toBe('false')
    expect(button().attributes('disabled')).toBeDefined()
    await wrapper.get('[aria-label="Allow fake delegation"]').trigger('click')
    await wrapper.get('[aria-label="Approve delegation actions"]').trigger('click')
    await button().trigger('click')
    await flushPromises()
    expect(approve).toHaveBeenCalledWith({
      parent_id: 'sample-parent',
      project_ids: ['sample-project'],
      providers: ['fake'],
      allow_fake: true,
    })
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Revoke grant')!
      .trigger('click')
    await flushPromises()
    expect(revoke).toHaveBeenCalledWith('sample-grant')
    expect(wrapper.text()).toContain('Revoked')
  } finally {
    wrapper.unmount()
  }
})
it('renders one durable result and informational question without vault markup execution; child opens separately', async () => {
  const card = nodeDelegationCardFixture()
  card.reports[1].text = '[[sample-note]] <script>unexpected()</script>'
  const wrapper = mount(NodeDelegationCard, { props: { card, nodeLabel: 'Sample node' } })
  try {
    expect(wrapper.findAll('[data-mailbox-seq="2"]')).toHaveLength(1)
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.find('a.internal-link').exists()).toBe(false)
    expect(wrapper.text()).toContain('Worker question (informational)')
    expect(wrapper.text()).toContain('human prompt(s)')
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('open')).toHaveLength(1)
    await wrapper.setProps({ card: structuredClone(card) })
    expect(wrapper.findAll('[data-mailbox-seq="2"]')).toHaveLength(1)
  } finally {
    wrapper.unmount()
  }
})
