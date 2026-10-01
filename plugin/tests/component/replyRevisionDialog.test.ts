import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import AiReplyRevisionDialog from '@/components/AiReplyRevisionDialog.vue'
import Button from '@/components/obsidian/Button.vue'
import type { ReplyProposal } from '@/ai/replyAnnotations'

const proposal: ReplyProposal = {
  id: 'p',
  parent: 'sample-chat.abchat',
  message: 'r',
  before: 'A small lamp.',
  from: 2,
  old: 'small',
  text: 'bright',
  request: 'Please rewrite this.',
  author: 'Sample editor',
  at: 2,
  status: 'pending',
}
const stubs = {
  ObsidianModal: { template: '<div><slot /><slot name="footer" /></div>' },
  Diff: {
    props: ['textLeft', 'textRight'],
    template: '<pre>{{ textLeft }} → {{ textRight }}</pre>',
  },
}
const open = (decide = vi.fn(async () => {})) =>
  mount(AiReplyRevisionDialog, { props: { proposal, decide }, global: { stubs } })
const button = (view: ReturnType<typeof open>, text: string) =>
  view.findAllComponents(Button).find((b) => b.props('text') === text)!

describe('owner review of a reply passage', () => {
  it('shows only the proposed passage diff and the request, and changes nothing on open or close', async () => {
    const decide = vi.fn(async () => {}),
      view = open(decide)
    expect(view.text()).toContain('small → bright')
    expect(view.text()).toContain('Please rewrite this.')
    expect(decide).not.toHaveBeenCalled()
    await button(view, 'Later').trigger('click')
    expect(decide).not.toHaveBeenCalled()
    expect(view.emitted('close')).toHaveLength(1)
  })
  it.each([
    ['Accept', true],
    ['Reject', false],
  ] as const)('%s records only that explicit owner decision', async (label, accepted) => {
    const decide = vi.fn(async () => {}),
      view = open(decide)
    await button(view, label).trigger('click')
    await flushPromises()
    expect(decide).toHaveBeenCalledExactlyOnceWith(accepted)
    expect(view.emitted('close')).toHaveLength(1)
  })
  it('keeps a stale or failed proposal open with an error and no false success', async () => {
    const view = open(
      vi.fn(async () => {
        throw new Error('The reply changed.')
      })
    )
    await button(view, 'Accept').trigger('click')
    await flushPromises()
    expect(view.text()).toContain('The reply changed.')
    expect(view.emitted('close')).toBeUndefined()
  })
})
