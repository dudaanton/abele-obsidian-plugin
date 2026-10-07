import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatAnchorHistory from '@/components/ChatAnchorHistory.vue'
import { useVault } from '../helpers/testEnv'

const snapshot = {
  text: 'original quote',
  sentence: 'original quote',
  title: 'Sample',
  pathHint: 'sample.abchat',
  source: {
    kind: 'chat',
    chatId: 'chat',
    messageId: 'reply',
    revisionId: 'old',
    role: 'assistant',
    author: 'assistant',
    quote: 'original quote',
    range: { space: 'rendered', start: 0, end: 14 },
    projectionVersion: 'chat-text-v1',
    context: { before: '', after: '' },
  },
} as const
const anchor = { id: 'anchor', original: snapshot.source, snapshot, placements: [] }

describe('read-only retained selection', () => {
  it('explains a historical return without presenting an editable reply', () => {
    useVault([])
    const wrapper = mount(ChatAnchorHistory, {
      props: {
        anchor,
        resolution: {
          status: 'historical',
          revision: {
            reference: snapshot.source,
            content: 'original quote',
            projection: { version: 'chat-text-v1', text: 'original quote' },
          },
          placement: {
            revision: snapshot.source,
            projectionVersion: 'chat-text-v1',
            range: snapshot.source.range,
          },
        },
      },
      global: { stubs: { ObsidianModal: { template: '<div><slot/><slot name="footer"/></div>' } } },
    })
    expect(wrapper.text()).toContain('earlier version')
    expect(wrapper.text()).toContain('original quote')
    expect(wrapper.find('textarea, input, [contenteditable="true"]').exists()).toBe(false)
    wrapper.unmount()
  })
  it('keeps the original quote when a placement is unresolved', () => {
    useVault([])
    const wrapper = mount(ChatAnchorHistory, {
      props: { anchor, resolution: { status: 'unresolved', snapshot } },
      global: { stubs: { ObsidianModal: { template: '<div><slot/><slot name="footer"/></div>' } } },
    })
    expect(wrapper.text()).toContain('cannot be verified')
    expect(wrapper.find('blockquote').text()).toBe('original quote')
    expect(wrapper.find('[data-selection-return]').exists()).toBe(false)
    wrapper.unmount()
  })
})
