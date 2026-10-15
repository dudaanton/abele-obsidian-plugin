import { expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { NodeClient, MemoryClientStore } from '@abele/node-client'
import { NodeDocumentSource, NodeFilesModel } from '@/node/NodeFilesModel'
import NodePathEditorPane from '@/components/nodeWork/NodePathEditorPane.vue'
it('refuses an offline save while retaining an editable local draft and its content precondition', async () => {
  const client = new NodeClient(
    { profile: 'local-token-v1', url: 'ws://127.0.0.1:7777/channel', token: 'sample-token' },
    new MemoryClientStore()
  )
  const source = new NodeDocumentSource(client, 'sample-workspace', false, () => client.connected)
  vi.spyOn(source, 'read').mockResolvedValue({
    text: 'before',
    contentId: 'a'.repeat(64),
    size: 6,
    binary: false,
    large: false,
    tooLarge: false,
  })
  const model = new NodeFilesModel(client, 'sample-node', 'sample-workspace', undefined, source)
  await model.openFile('sample.ts')
  await model.beginEditing()
  await model.editText('local draft')
  const wrapper = mount(NodePathEditorPane, {
    props: { model, offline: true },
    global: { stubs: { GithubCode: true } },
  })
  // Saving is the tab header's, not a button in the pane; the pane says the draft is kept.
  expect(wrapper.findAll('button').some((button) => button.text() === 'Save file')).toBe(false)
  expect(wrapper.text()).toContain('Offline · your local draft is retained.')
  await expect(model.saveFile()).rejects.toThrow('Reconnect before saving')
  await flushPromises()
  expect(await client.pending()).toEqual([])
  expect(model.draft.value).toMatchObject({
    text: 'local draft',
    baseContentId: 'a'.repeat(64),
    status: 'draft',
  })
  wrapper.unmount()
})
