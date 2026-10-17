import { expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import NativeActions from '@/components/github/NativeActions.vue'
import PullRequestDialog from '@/components/nodeWork/PullRequestDialog.vue'
import { useVault } from '../helpers/testEnv'
it('cancels native PR creation without submitting or offering an unsupported draft', async () => {
  useVault([])
  const view = mount(PullRequestDialog, {
    props: {
      branch: 'sample-topic',
      base: 'main',
      commits: 1,
      files: 1,
      initialTitle: 'Sample change',
      host: 'Gitea',
      draftSupported: false,
    },
  })
  expect(view.find('[aria-label="Open as a draft"]').exists()).toBe(false)
  expect(view.text()).toContain('Draft creation is not available')
  await view
    .findAll('button')
    .find((b) => b.text() === 'Cancel')!
    .trigger('click')
  expect(view.emitted('cancel')).toHaveLength(1)
  expect(view.emitted('create')).toBeUndefined()
  view.unmount()
})
it('writes only on submit, keeps failed comments, and cancels merge without a request', async () => {
  useVault([])
  const writer = {
    comment: vi.fn().mockRejectedValue(new Error('Check the service')),
    merge: vi.fn(),
  }
  const view = mount(NativeActions, {
    props: { writer, number: 14, head: 'a'.repeat(40), open: true, pull: true },
  })
  await view.find('textarea').setValue('Sample comment')
  expect(writer.comment).not.toHaveBeenCalled()
  await view
    .findAll('button')
    .find((b) => b.text() === 'Comment')!
    .trigger('click')
  await flushPromises()
  expect(writer.comment).toHaveBeenCalledWith(14, 'Sample comment')
  expect((view.find('textarea').element as HTMLTextAreaElement).value).toBe('Sample comment')
  expect(view.text()).toContain('Check the service')
  await view
    .findAll('button')
    .find((b) => b.text() === 'Merge')!
    .trigger('click')
  expect(writer.merge).not.toHaveBeenCalled()
  view.unmount()
})
