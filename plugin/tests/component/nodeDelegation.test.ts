import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { initializeLocale } from '@/i18n'
import { english } from '@/i18n/catalogs'
import { streamBMeta as russian } from '@/i18n/locales/ru/streamBMeta'
import NodeDelegationGrantsDialog from '@/components/NodeDelegationGrantsDialog.vue'
import NodeDelegationCard from '@/components/NodeDelegationCard.vue'
import {
  nodeDelegationGrantsFixture,
  nodeDelegationCardFixture,
} from '@/testing/nodeDelegationFixture'
const shell = { Modal: { template: '<div><slot /></div>' } }
it('localizes a cancelled developer state', () => {
  initializeLocale('ru', { ...english, ...russian })
  const wrapper = mount(NodeDelegationCard, {
    props: {
      card: { ...nodeDelegationCardFixture(), state: 'cancelled', pendingHumanPrompts: 0 },
      nodeLabel: 'Sample node',
    },
  })
  try {
    expect(wrapper.text()).toContain('отменено')
  } finally {
    wrapper.unmount()
    initializeLocale('en')
  }
})
it('keeps a long activity message compact while retaining its latest text', () => {
  const message = 'Earlier sample progress. '.repeat(100) + 'Latest sample action'
  const wrapper = mount(NodeDelegationCard, {
    props: {
      card: { ...nodeDelegationCardFixture(), activity: { message, files: [] } },
      nodeLabel: 'Sample node',
    },
  })
  try {
    expect(wrapper.text()).toContain('Latest sample action')
    expect(wrapper.text()).not.toContain(message)
    expect(wrapper.get('button').text()).toContain('Open child chat')
  } finally {
    wrapper.unmount()
  }
})
it('collapses finished reports and keeps pending prompts one press away', async () => {
  const card = {
    ...nodeDelegationCardFixture(),
    pendingHumanPrompts: 0,
    branch: 'work/sample-parser',
    activity: { message: 'Checking boundary cases', tool: 'Test', files: ['src/parser.ts'] },
  }
  const wrapper = mount(NodeDelegationCard, { props: { card, nodeLabel: 'Sample node' } })
  try {
    expect(wrapper.get('details.abele-node-delegation__details').attributes('open')).toBeUndefined()
    expect(wrapper.text()).toContain('work/sample-parser')
    await wrapper.setProps({ card: { ...card, state: 'running', pendingHumanPrompts: 2 } })
    expect(wrapper.get('details.abele-node-delegation__details').attributes('open')).toBeDefined()
    expect(wrapper.text()).toContain('Checking boundary cases')
    expect(wrapper.text()).toContain('src/parser.ts')
    await wrapper.get('[data-pending-prompts]').trigger('click')
    expect(wrapper.emitted('open')).toHaveLength(1)
  } finally {
    wrapper.unmount()
  }
})
it('requires explicit action/fake confirmation, resets it when the selected authority changes, and revokes only through owner UI', async () => {
  const props = nodeDelegationGrantsFixture()
  const approve = vi.spyOn(props.controller, 'approve')
  const revoke = vi.spyOn(props.controller, 'revoke')
  const wrapper = mount(NodeDelegationGrantsDialog, { props, global: { stubs: shell } })
  try {
    await flushPromises()
    await wrapper.get('[aria-label="Delegation project"]').setValue('sample-project')
    expect(wrapper.find('.abele-node-path code').text()).toBe(
      '/workspace/sample-project-with-a-long-name'
    )
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
