import { expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { nodeFilesFixture } from '@/testing/nodeFilesFixture'
import { NodeFilesModel } from '@/node/NodeFilesModel'

it('reload cannot restore a draft snapshot older than text typed while the read was pending', async () => {
  const s = await nodeFilesFixture('edit'),
    model = s.model,
    path = s.initialPath!
  const current = await model.client.readFile(model.workspaceId, path)
  let release!: () => void
  model.client.readFile = vi.fn(async () => {
    await new Promise<void>((r) => {
      release = r
    })
    return current
  })
  const reload = model.openFile(path)
  await flushPromises()
  await model.editText('new text during reload')
  release()
  await reload
  expect(model.draftText.value).toBe('new text during reload')
  expect((await model.documents.draft(path))?.text).toBe('new text during reload')
})
it('two models cannot overwrite a newer shared draft or save text other than the shown snapshot', async () => {
  const s = await nodeFilesFixture('edit'),
    a = s.model,
    path = s.initialPath!
  await a.editText('draft A')
  const b = new NodeFilesModel(a.client, a.nodeId, a.workspaceId, 'other-session')
  await b.openFile(path)
  await b.beginEditing()
  await b.editText('draft B')
  a.client.writeFile = vi.fn(a.client.writeFile.bind(a.client))
  await expect(a.saveFile()).rejects.toThrow('another view')
  expect(a.draftText.value).toBe('draft A')
  await expect(a.editText('continued A')).rejects.toThrow('another view')
  expect((await b.documents.draft(path))?.text).toBe('draft B')
  expect(a.client.writeFile).not.toHaveBeenCalled()
})
it('sync validation throws retain the visible paste, warn about storage, and block save/reload', async () => {
  const s = await nodeFilesFixture('edit'),
    model = s.model,
    path = s.initialPath!,
    text = 'x'.repeat(16 * 1024 * 1024 + 1)
  const previous = (await model.documents.draft(path))!.text
  await expect(Promise.resolve().then(() => model.editText(text))).rejects.toThrow('limit')
  expect(model.draftText.value).toBe(text)
  expect(model.draftError.value).toContain('copy')
  await expect(model.saveFile()).rejects.toThrow('limit')
  await expect(model.openFile(path)).rejects.toThrow('limit')
  expect((await model.documents.draft(path))!.text).toBe(previous)
  expect(await model.client.pending()).toEqual([])
})
it('a restored text draft stays editable locally after the current file grows beyond the save limit', async () => {
  const s = await nodeFilesFixture('edit'),
    model = s.model,
    path = s.initialPath!
  const text = 'large current file\n'.repeat(2000)
  model.client.readContent = vi.fn(async () => ({
    offset: 0,
    total: text.length,
    base64: btoa(text),
  }))
  await model.openFile(path)
  await model.editText('retained edited text')
  expect((await model.documents.draft(path))!.text).toBe('retained edited text')
})
it('programmatic draft validation throws follow the same Promise/error path as storage rejections', async () => {
  const s = await nodeFilesFixture('edit'),
    model = s.model
  model.documents.edit = () => {
    throw new Error('validation failure')
  }
  await expect(Promise.resolve().then(() => model.editText('visible text'))).rejects.toThrow(
    'validation failure'
  )
  expect(model.draftError.value).toContain('copy')
  await expect(model.saveFile()).rejects.toThrow('validation failure')
})
