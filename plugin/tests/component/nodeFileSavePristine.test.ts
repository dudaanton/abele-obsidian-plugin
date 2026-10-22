import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import NodeFileSaveState from '@/components/NodeFileSaveState.vue'
import { nodeFilesFixture } from '@/testing/nodeFilesFixture'

it('does not label an untouched editor as an unsent edit', async () => {
  const { model, initialPath } = await nodeFilesFixture('files')
  await model.openFile(initialPath!)
  await model.beginEditing()
  const view = mount(NodeFileSaveState, { props: { model, actions: false } })
  expect(view.text()).not.toContain('Unsent edit')
  view.unmount()
})

it('does not repeat the tab unsaved indicator below its save action', async () => {
  const { model, initialPath } = await nodeFilesFixture('files')
  await model.openFile(initialPath!)
  await model.beginEditing()
  await model.editText('local edit')
  const view = mount(NodeFileSaveState, { props: { model, actions: false } })
  try {
    expect(view.text()).not.toContain('Unsent edit')
  } finally {
    view.unmount()
  }
})
