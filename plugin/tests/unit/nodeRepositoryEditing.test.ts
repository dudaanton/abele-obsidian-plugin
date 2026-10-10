import { describe, expect, it, vi } from 'vitest'
import { NodeClient, MemoryClientStore } from '@abele/node-client'
import { NodeDocumentSource, NodeFilesModel } from '@/node/NodeFilesModel'
const before = 'a'.repeat(64),
  after = 'b'.repeat(64)
function fixture() {
  const client = new NodeClient(
    { url: 'ws://127.0.0.1:7777/channel', profile: 'local-token-v1', token: 'a'.repeat(64) },
    new MemoryClientStore()
  )
  const source = new NodeDocumentSource(client, 'worktree-sample', true)
  const doc = {
    text: 'before',
    contentId: before,
    size: 6,
    binary: false,
    large: false,
    tooLarge: false,
  }
  return { client, source, doc }
}
describe('repository durable document adapter', () => {
  it.each(['worktree_id', 'path', 'operation_id', 'expected_content_id'] as const)(
    'rejects a receipt for another %s and preserves the original pending save',
    async (field) => {
      const { client, source, doc } = fixture()
      await source.edit('sample.ts', doc, 'draft')
      client.repository.write = vi.fn(async (_, operation_id) => ({ operation_id: operation_id! }))
      client.repository.mutationResult = vi.fn(async (operation_id) => ({
        operation_id,
        worktree_id: 'worktree-sample',
        path: 'sample.ts',
        state: 'saved',
        expected_content_id: before,
        content_id: after,
        predecessor_content_id: before,
        recovery_path: null,
        [field]: field === 'expected_content_id' ? 'c'.repeat(64) : 'another-target',
      }))
      await expect(source.save('sample.ts')).rejects.toThrow('receipt identity')
      const pending = (await source.draft('sample.ts'))!.pending!
      expect(pending.params).toMatchObject({
        worktree_id: 'worktree-sample',
        path: 'sample.ts',
        expected_content_id: before,
        text: 'draft',
      })
      expect(
        (await new NodeDocumentSource(client, 'worktree-sample', true).draft('sample.ts'))?.pending
          ?.operationId
      ).toBe(pending.operationId)
    }
  )
  it('saves to the worktree with exact content and resumes the original operation after interrupted admission', async () => {
    const { client, source, doc } = fixture()
    await source.edit('sample.ts', doc, 'draft')
    client.repository.write = vi.fn(async () => {
      throw new Error('interrupted admission')
    })
    await expect(source.save('sample.ts')).rejects.toThrow('interrupted admission')
    const pending = (await source.draft('sample.ts'))!.pending!
    expect(pending.params).toEqual({
      worktree_id: 'worktree-sample',
      path: 'sample.ts',
      expected_content_id: before,
      text: 'draft',
    })
    client.repository.write = vi.fn(async (_, operation_id) => ({ operation_id: operation_id! }))
    client.repository.mutationResult = vi.fn(async () => undefined)
    await source.check('sample.ts')
    await source.save('sample.ts')
    expect(client.repository.write).toHaveBeenCalledWith(pending.params, pending.operationId)
    expect((await source.draft('sample.ts'))!.pending!.operationId).toBe(pending.operationId)
    await expect(source.discard('sample.ts')).rejects.toThrow('unresolved')
  })
  it.each(['conflict', 'outcome_unknown', 'saved'] as const)(
    'uses the shared %s state and validates receipt target',
    async (state) => {
      const { client, source, doc } = fixture()
      await source.edit('sample.ts', doc, 'draft')
      client.repository.write = vi.fn(async (_, operation_id) => ({ operation_id: operation_id! }))
      client.repository.mutationResult = vi.fn(async (operation_id) => ({
        operation_id,
        worktree_id: 'worktree-sample',
        path: 'sample.ts',
        state,
        expected_content_id: before,
        content_id: after,
        predecessor_content_id: before,
        recovery_path: 'file-recovery/worktree-sample/copy',
      }))
      const draft = await source.save('sample.ts')
      expect(draft?.status).toBe(state)
      expect(draft?.text).toBe('draft')
      if (state === 'outcome_unknown') {
        await source.save('sample.ts')
        expect(client.repository.write).toHaveBeenCalledTimes(1)
        await expect(source.rebase('sample.ts', doc)).rejects.toThrow('unresolved')
      }
    }
  )
  it('does not share repository drafts with legacy workspace drafts and loads recovery through the repository adapter', async () => {
    const { client, source, doc } = fixture()
    await source.edit('sample.ts', doc, 'draft')
    expect(
      await new NodeDocumentSource(client, 'worktree-sample').draft('sample.ts')
    ).toBeUndefined()
    client.repository.write = vi.fn(async (_, operation_id) => ({ operation_id: operation_id! }))
    client.repository.mutationResult = vi.fn(async (operation_id) => ({
      operation_id,
      worktree_id: 'worktree-sample',
      path: 'sample.ts',
      state: 'outcome_unknown',
      expected_content_id: before,
      content_id: after,
      predecessor_content_id: before,
      recovery_path: 'file-recovery/worktree-sample/copy',
    }))
    client.repository.readRecovery = vi.fn(async () => ({
      offset: 0,
      total: 6,
      base64: btoa('before'),
    }))
    const model = new NodeFilesModel(client, 'node-sample', 'worktree-sample', undefined, source)
    await model.openFile('sample.ts', undefined, undefined, doc)
    await model.saveFile()
    await model.readPredecessor()
    expect(model.predecessorText.value).toBe('before')
    expect(client.repository.readRecovery).toHaveBeenCalledWith({
      worktree_id: 'worktree-sample',
      recovery_path: 'file-recovery/worktree-sample/copy',
      offset: 0,
    })
  })
})
