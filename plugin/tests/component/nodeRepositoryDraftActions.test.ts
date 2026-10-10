import { beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { MemoryClientStore, NodeClient } from '@abele/node-client'
import GithubBlob from '@/components/github/GithubBlob.vue'
import GithubCode from '@/components/github/GithubCode.vue'
import { NodeDocumentSource, NodeFilesModel } from '@/node/NodeFilesModel'
import { confirmAction } from '@/modal/confirm'
import { WORKING_TREE } from '@/repository/node'
import { useVault } from '../helpers/testEnv'
vi.mock('@/modal/confirm', () => ({ confirmAction: vi.fn(async () => true) }))
beforeEach(() => {
  useVault([])
  vi.mocked(confirmAction).mockReset().mockResolvedValue(true)
})
async function fixture() {
  const client = new NodeClient(
    { url: 'ws://127.0.0.1:7777/channel', profile: 'local-token-v1', token: 'a'.repeat(64) },
    new MemoryClientStore()
  )
  const documents = new NodeDocumentSource(client, 'worktree-sample', true)
  const model = new NodeFilesModel(client, 'node-sample', 'worktree-sample', undefined, documents)
  let disk = {
    text: 'original',
    contentId: 'a'.repeat(64),
    size: 8,
    binary: false,
    large: false,
    tooLarge: false,
  }
  const read = vi.spyOn(documents, 'read').mockImplementation(async () => ({ ...disk }))
  const results = new Map<string, any>()
  client.operationResult = vi.fn(async (id) =>
    results.has(id) ? { result: results.get(id) } : undefined
  )
  client.repository.write = vi.fn(async (params, operation_id = crypto.randomUUID()) => {
    const state = params.expected_content_id === disk.contentId ? 'saved' : 'conflict'
    results.set(operation_id, {
      operation_id,
      worktree_id: 'worktree-sample',
      path: 'sample.ts',
      state,
      expected_content_id: params.expected_content_id,
      content_id: 'd'.repeat(64),
      predecessor_content_id: disk.contentId,
      recovery_path: null,
    })
    if (state === 'saved') disk = { ...disk, text: params.text, contentId: 'd'.repeat(64) }
    return { operation_id }
  })
  client.repository.mutationResult = vi.fn(async (id) => results.get(id))
  const wrapper = mount(GithubBlob, {
    props: {
      text: disk.text,
      contentId: disk.contentId,
      file: {
        host: 'node.invalid',
        owner: 'Sample node',
        repo: 'Sample project',
        ref: WORKING_TREE,
        path: 'sample.ts',
      },
      editor: model,
      writable: true,
    },
  })
  await flushPromises()
  const code = () => wrapper.findAllComponents(GithubCode).at(-1)!
  const button = (text: string) => wrapper.findAll('button').find((b) => b.text() === text)!
  return {
    wrapper,
    model,
    client,
    read,
    code,
    button,
    setDisk(text = 'external', contentId = 'b'.repeat(64)) {
      disk = { ...disk, text, contentId }
    },
    get disk() {
      return disk
    },
  }
}
it('re-reads the current node version after conflict instead of reloading cached props', async () => {
  const f = await fixture()
  try {
    f.code().vm.$emit('change', 'mine')
    await flushPromises()
    f.setDisk()
    await f.button('Save file').trigger('click')
    await flushPromises()
    expect(f.model.draft.value?.status).toBe('conflict')
    await f.button('Reload').trigger('click')
    await flushPromises()
    expect(f.read).toHaveBeenCalled()
    expect(f.model.document.value?.contentId).toBe('b'.repeat(64))
    expect(f.model.draft.value).toBeUndefined()
    expect(f.code().props('text')).toBe('external')
    f.code().vm.$emit('change', 'next edit')
    await flushPromises()
    await f.model.saveFile()
    expect(f.model.draft.value?.status).toBe('saved')
    expect(f.client.repository.write).toHaveBeenLastCalledWith(
      expect.objectContaining({ expected_content_id: 'b'.repeat(64), text: 'next edit' }),
      expect.any(String)
    )
  } finally {
    f.wrapper.unmount()
  }
})
it('presents just Reload and Keep mine and adopts the newly read disk base without changing my text', async () => {
  const f = await fixture()
  try {
    f.code().vm.$emit('change', 'mine')
    await flushPromises()
    f.setDisk()
    await f.wrapper.setProps({ text: 'external', contentId: 'b'.repeat(64) })
    await flushPromises()
    expect(f.wrapper.text()).not.toContain('Use loaded version as base')
    expect(f.wrapper.text()).not.toContain('Unsent edit ·')
    // Disk changes again after the visible observation; the owner action must not use B.
    f.setDisk('latest external', 'c'.repeat(64))
    await f.button('Keep mine').trigger('click')
    await flushPromises()
    expect(f.read).toHaveBeenCalled()
    expect(f.model.draftText.value).toBe('mine')
    expect(f.model.draft.value?.baseContentId).toBe('c'.repeat(64))
    await f.model.saveFile()
    expect(f.model.draft.value?.status).toBe('saved')
    expect(f.disk.text).toBe('mine')
  } finally {
    f.wrapper.unmount()
  }
})
it('allows a passive same-file refresh while Keep mine reads disk without adopting different text', async () => {
  const f = await fixture()
  try {
    f.code().vm.$emit('change', 'mine')
    await flushPromises()
    f.setDisk()
    await f.wrapper.setProps({ text: 'external', contentId: 'b'.repeat(64) })
    await flushPromises()
    let finish!: () => void
    f.read.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      return { ...f.disk }
    })
    await f.button('Keep mine').trigger('click')
    await flushPromises()
    await f.model.openFile('sample.ts', undefined, undefined, f.disk)
    finish()
    await flushPromises()
    expect(f.model.draft.value?.baseContentId).toBe('b'.repeat(64))
    expect(f.model.draftText.value).toBe('mine')
    expect(f.wrapper.text()).not.toContain('File view changed')
  } finally {
    f.wrapper.unmount()
  }
})
it('rejects reconciliation after navigation away and back even when the same draft is visible again', async () => {
  const f = await fixture()
  try {
    f.code().vm.$emit('change', 'mine')
    await flushPromises()
    f.setDisk()
    await f.wrapper.setProps({ text: 'external', contentId: 'b'.repeat(64) })
    await flushPromises()
    let finish!: () => void
    f.read.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      return { ...f.disk }
    })
    const reconciling = f.model.keepMine()
    await flushPromises()
    await f.model.openFile('other.ts', undefined, undefined, f.disk)
    await f.model.openFile('sample.ts', undefined, undefined, f.disk)
    finish()
    await expect(reconciling).rejects.toThrow('File view changed')
    await flushPromises()
    expect(f.model.draft.value?.baseContentId).toBe('a'.repeat(64))
    expect(f.model.draftText.value).toBe('mine')
  } finally {
    f.wrapper.unmount()
  }
})
it('retains the draft when a fresh disk read fails instead of discarding it or adopting cached bytes', async () => {
  const f = await fixture()
  try {
    f.code().vm.$emit('change', 'mine')
    await flushPromises()
    f.setDisk()
    await f.wrapper.setProps({ text: 'external', contentId: 'b'.repeat(64) })
    await flushPromises()
    f.read.mockRejectedValue(new Error('Node unavailable'))
    await f.button('Reload').trigger('click')
    await flushPromises()
    expect(f.model.draft.value?.text).toBe('mine')
    expect(f.model.draft.value?.baseContentId).toBe('a'.repeat(64))
    expect(f.wrapper.text()).toContain('Node unavailable')
    await f.button('Keep mine').trigger('click')
    await flushPromises()
    expect(f.model.draft.value?.baseContentId).toBe('a'.repeat(64))
    expect(f.model.draftText.value).toBe('mine')
  } finally {
    f.wrapper.unmount()
  }
})
it('does not discard another view’s draft after it changed while confirmation was open', async () => {
  const f = await fixture()
  try {
    f.code().vm.$emit('change', 'mine')
    await flushPromises()
    f.setDisk()
    await f.wrapper.setProps({ text: 'external', contentId: 'b'.repeat(64) })
    await flushPromises()
    let approve!: (value: boolean) => void
    vi.mocked(confirmAction).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          approve = resolve
        })
    )
    await f.button('Reload').trigger('click')
    await flushPromises()
    const other = new NodeFilesModel(
      f.client,
      'node-sample',
      'worktree-sample',
      undefined,
      new NodeDocumentSource(f.client, 'worktree-sample', true)
    )
    await other.openFile('sample.ts', undefined, undefined, f.disk)
    await other.editText('another view draft')
    approve(true)
    await flushPromises()
    expect(f.model.draftText.value).toBe('mine')
    expect((await other.documents.draft('sample.ts'))?.text).toBe('another view draft')
    expect(f.wrapper.text()).toContain('another view')
  } finally {
    f.wrapper.unmount()
  }
})
it('reloads a rejected private copy without deleting another view’s shared draft', async () => {
  const f = await fixture()
  try {
    f.code().vm.$emit('change', 'mine')
    await flushPromises()
    const other = new NodeFilesModel(
      f.client,
      'node-sample',
      'worktree-sample',
      undefined,
      new NodeDocumentSource(f.client, 'worktree-sample', true)
    )
    await other.openFile('sample.ts', undefined, undefined, f.disk)
    await other.editText('shared text')
    await expect(f.model.editText('private text')).rejects.toThrow('another view')
    await f.wrapper.find('[aria-label="Reload current version"]').trigger('click')
    await flushPromises()
    expect(f.model.draftText.value).toBe('shared text')
    expect((await other.documents.draft('sample.ts'))?.text).toBe('shared text')
    expect(f.read).toHaveBeenCalled()
  } finally {
    f.wrapper.unmount()
  }
})
it('confirms discarding a changed draft, preserves it on cancellation, and reloads disk only on approval', async () => {
  const f = await fixture()
  try {
    f.code().vm.$emit('change', 'mine')
    await flushPromises()
    f.setDisk()
    await f.wrapper.setProps({ text: 'external', contentId: 'b'.repeat(64) })
    await flushPromises()
    vi.mocked(confirmAction).mockResolvedValueOnce(false)
    await f.button('Reload').trigger('click')
    await flushPromises()
    expect(confirmAction).toHaveBeenCalled()
    expect(f.model.draftText.value).toBe('mine')
    expect(f.model.draft.value).toBeDefined()
    await f.button('Reload').trigger('click')
    await flushPromises()
    expect(f.model.draft.value).toBeUndefined()
    expect(f.code().props('text')).toBe('external')
    expect(f.model.document.value?.contentId).toBe('b'.repeat(64))
  } finally {
    f.wrapper.unmount()
  }
})
