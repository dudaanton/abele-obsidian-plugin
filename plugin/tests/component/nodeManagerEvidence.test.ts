import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import NodeManagerRunCard from '@/components/NodeManagerRunCard.vue'
import { nodeManagerFixture } from '@/testing/nodeManagerFixture'
import { useVault } from '../helpers/testEnv'

it('keeps the merged command evidence in one Original action fold', async () => {
  useVault([])
  const card = nodeManagerFixture('timed_out', false, false, { managerReason: 'git_timeout' })
  const view = mount(NodeManagerRunCard, { props: { card } })
  const folds = view
    .findAll('.abele-fold-heading')
    .filter((fold) => fold.text() === 'Original action')
  expect(folds).toHaveLength(1)
  await folds[0]!.trigger('click')
  expect(view.text()).toContain('git_timeout')
  expect(JSON.parse(view.get('.abele-state-line pre').text())).toEqual({
    argv: card.argv,
    folder: card.folder,
    reason: 'git_timeout',
  })
  expect(view.get('[data-manager-command]').text()).toBe('npm test')
  view.unmount()
})
