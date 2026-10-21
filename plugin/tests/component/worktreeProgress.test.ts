import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import WorktreeDialog from '@/components/nodeWork/WorktreeDialog.vue'

it('shows progress and prevents duplicate creation while the node creates a worktree', async () => {
  const view = mount(WorktreeDialog, {
    props: { branches: [], taken: [], base: 'main', busy: true },
  })
  await view.get('input').setValue('sample-branch')
  await view.get('input').trigger('keydown', { key: 'Enter' })
  expect(view.emitted('create')).toBeUndefined()
  expect(view.find('[aria-busy="true"]').exists()).toBe(true)
  view.unmount()
})
