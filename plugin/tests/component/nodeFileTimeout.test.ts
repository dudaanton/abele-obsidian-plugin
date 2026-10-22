import { expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import NodePathFilePane from '@/components/nodeWork/NodePathFilePane.vue'
import { NodePathFileModel, type NodePathModel, type PathTarget } from '@/node/NodePathModel'
import { useVault } from '../helpers/testEnv'

const target: PathTarget = {
  nodeId: 'sample-node',
  registrationId: 'sample-registration',
  projectId: 'sample-project',
  kind: 'worktree',
  id: 'sample-worktree',
}

it('keeps uncertain outcomes as alerts without a timeout retry', async () => {
  useVault([])
  const model = new NodePathFileModel(
    {
      openFile: vi.fn().mockRejectedValue(new Error('outcome_unknown')),
      fileRefresh: ref({}),
    } as unknown as NodePathModel,
    target
  )
  await expect(model.open('sample.ts')).rejects.toThrow('outcome_unknown')
  const view = mount(NodePathFilePane, { props: { model } })
  try {
    expect(view.get('[role=alert]').text()).toContain('The result is unknown.')
    expect(view.findAll('button').some((button) => button.text() === 'Retry')).toBe(false)
  } finally {
    view.unmount()
    model.destroy()
  }
})

it('retries the first failed file read with the same target and stage', async () => {
  useVault([])
  const openFile = vi.fn().mockRejectedValueOnce(new Error('git_timeout')).mockResolvedValue({
    path: 'sample.ts',
    text: 'sample content',
  })
  const model = new NodePathFileModel(
    { openFile, fileRefresh: ref({}) } as unknown as NodePathModel,
    target
  )
  await expect(model.open('sample.ts', 'staged')).rejects.toThrow('git_timeout')
  const view = mount(NodePathFilePane, { props: { model }, global: { stubs: { FileView: true } } })
  try {
    expect(view.text()).toContain('Git on the node')
    expect(view.text()).not.toContain('git_timeout')
    await view.get('button').trigger('click')
    await flushPromises()
    expect(openFile).toHaveBeenCalledTimes(2)
    expect(openFile.mock.calls[1]).toEqual([
      target,
      'sample.ts',
      'staged',
      undefined,
      expect.any(Function),
      true,
    ])
    expect(model.document.value?.text).toBe('sample content')
    expect(model.error.value).toBe('')
  } finally {
    view.unmount()
    model.destroy()
  }
})

it('shows the waiting message when the panel already knows the node is offline', async () => {
  useVault([])
  const openFile = vi.fn().mockRejectedValueOnce(new Error('git_timeout')).mockResolvedValue({
    path: 'sample.ts',
    text: 'sample content',
  })
  const model = new NodePathFileModel(
    {
      openFile,
      fileRefresh: ref({}),
    } as unknown as NodePathModel,
    target
  )
  await expect(model.open('sample.ts')).rejects.toThrow('git_timeout')
  const view = mount(NodePathFilePane, { props: { model, offline: true } })
  try {
    expect(view.text()).toContain('The file will open when the node is back.')
    expect(view.find('[role=alert]').exists()).toBe(false)
    expect(view.find('button').exists()).toBe(false)
    await view.setProps({ offline: false })
    await flushPromises()
    expect(openFile).toHaveBeenCalledTimes(2)
    expect(model.document.value?.text).toBe('sample content')
  } finally {
    view.unmount()
    model.destroy()
  }
})
