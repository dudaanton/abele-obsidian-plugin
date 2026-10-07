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
it.each(['save', 'check'] as const)(
  "%s completion cannot adopt another view's revision without its text",
  async (action) => {
    const s = await nodeFilesFixture('edit'),
      a = s.model,
      path = s.initialPath!
    await a.editText('shown A')
    const b = new NodeFilesModel(a.client, a.nodeId, a.workspaceId, 'other-session')
    const settle = async () => {
      const draft = (await a.documents.draft(path))!,
        pending = draft.pending!
      await a.client.store.transaction((state) => {
        state.outbox = []
        state.results[pending.operationId] = {
          result: {
            operation_id: pending.operationId,
            workspace_id: a.workspaceId,
            path,
            state: 'saved',
            expected_content_id: pending.params.expected_content_id,
            content_id: 'b'.repeat(64),
            predecessor_content_id: pending.params.expected_content_id,
            recovery_path: null,
          },
        }
      })
      return a.documents.check(path, draft.revision)
    }
    const changeOtherView = async () => {
      await b.openFile(path)
      await b.beginEditing()
      await b.editText('shared B')
    }
    if (action === 'save') {
      const original = a.documents.save.bind(a.documents)
      a.documents.save = async (...args) => {
        await original(...args)
        const completed = await settle()
        await changeOtherView()
        return completed
      }
      await a.saveFile().catch((e) => {
        expect((e as Error).message).toContain('another view')
      })
    } else {
      await a.saveFile()
      const original = a.documents.check.bind(a.documents)
      const pending = a.draft.value!.pending!
      await a.client.store.transaction((state) => {
        state.outbox = []
        state.results[pending.operationId] = {
          result: {
            operation_id: pending.operationId,
            workspace_id: a.workspaceId,
            path,
            state: 'saved',
            expected_content_id: pending.params.expected_content_id,
            content_id: 'b'.repeat(64),
            predecessor_content_id: pending.params.expected_content_id,
            recovery_path: null,
          },
        }
      })
      a.documents.check = async (...args) => {
        const completed = await original(...args)
        await changeOtherView()
        return completed
      }
      await a.checkSave().catch((e) => {
        expect((e as Error).message).toContain('another view')
      })
    }
    expect(a.draftText.value).toBe('shown A')
    await expect(a.editText('continued A')).rejects.toThrow('another view')
    expect((await b.documents.draft(path))!.text).toBe('shared B')
  }
)
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
