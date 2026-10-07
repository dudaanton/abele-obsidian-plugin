import { afterEach, describe, expect, it } from 'vitest'
import type { App } from 'obsidian'
import { queuedCommentVault } from '../helpers/queuedCommentVault'
import { VaultCommentRepository, vaultCommentDocuments } from '@/comments/vaultRepository'
import { TextCommentService } from '@/comments/service'
import { encodeThread, type CommentThread } from '@/comments/model'
import { ChangeTracker } from '@/ai/rewind/ChangeTracker'

afterEach(() => ChangeTracker.get()?.uninstall())

const thread = (): CommentThread => ({
  version: 1,
  id: 'aaaaaa',
  anchor: { note: 'Notes/sample.md', quote: 'words' },
  appearance: 'yellow',
  entries: [{ id: 'bbbbbb', body: 'First', createdAt: '2025-01-02T03:04:05.000Z' }],
})
function setup() {
  const queued = queuedCommentVault([
    { path: 'Notes/sample.md', content: 'words' },
    { path: 'System/Comments/zzzzzz.abchat', content: 'AI sibling' },
  ])
  const { app, fake } = queued
  const repository = new VaultCommentRepository(app, () => 'System/Comments')
  return { ...queued, repository }
}
describe('vault human comment repository', () => {
  it('does not acknowledge cancellation as successful deletion', async () => {
    const m = setup()
    const saved = await m.repository.write(thread(), null)
    m.app.fileManager.trashFile = async () => {}
    await expect(m.repository.remove(saved.thread.id, saved.revision)).rejects.toThrow('not deleted')
    expect(await m.repository.read(saved.thread.id)).toEqual(saved)
    expect(m.removed).toEqual([])
  })
  it('consumes the revision guard at the real mutation-wrapper leaf, not at file-manager entry', async () => {
    const m = setup()
    const saved = await m.repository.write(thread(), null)
    const file = m.app.vault.getFileByPath(m.repository.path(saved.thread.id))!
    const trash = m.app.vault.trash.bind(m.app.vault)
    m.adapter.trashLocal = (path) =>
      m.adapter.queue(() => trash(m.app.vault.getFileByPath(path)!, true))
    ChangeTracker.install(m.app)
    const managedTrash = m.app.fileManager.trashFile.bind(m.app.fileManager)
    m.app.fileManager.trashFile = async (target) => {
      await m.app.vault.modify(file, encodeThread({ ...thread(), appearance: 'purple' }))
      await managedTrash(target)
    }
    await expect(m.repository.remove(saved.thread.id, saved.revision)).rejects.toThrow('changed')
    expect((await m.repository.read(saved.thread.id))!.thread.appearance).toBe('purple')
  })
  it('does not trash a synced revision arriving while the file-manager trash request is delayed', async () => {
    const m = setup()
    const saved = await m.repository.write(thread(), null)
    const file = m.app.vault.getFileByPath(m.repository.path(saved.thread.id))!
    const trash = m.app.fileManager.trashFile.bind(m.app.fileManager)
    m.app.fileManager.trashFile = async (target) => {
      await m.app.vault.modify(file, encodeThread({ ...thread(), appearance: 'pink' }))
      await trash(target)
    }
    await expect(m.repository.remove(saved.thread.id, saved.revision)).rejects.toThrow('changed')
    expect((await m.repository.read(saved.thread.id))!.thread.appearance).toBe('pink')
    expect(m.removed).toEqual([])
  })
  it('keeps sync writes out of the queue item containing the revision read and trash', async () => {
    const m = setup()
    const saved = await m.repository.write(thread(), null)
    const file = m.app.vault.getFileByPath(m.repository.path(saved.thread.id))!
    let release!: () => void, began!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = new Promise<void>((resolve) => {
      began = resolve
    })
    const read = m.adapter.read.bind(m.adapter)
    let hold = true
    m.adapter.read = (path) =>
      m.adapter.queue(async () => {
        // This is the native read action, not another queued adapter operation.
        const value = await m.app.vault.read(m.app.vault.getFileByPath(path)!)
        if (hold) {
          hold = false
          began()
          await gate
        }
        return value
      })
    const deleting = m.repository.remove(saved.thread.id, saved.revision).catch((error) => error)
    await started
    const synced = m.app.vault.modify(file, encodeThread({ ...thread(), appearance: 'blue' }))
    release()
    await Promise.all([deleting, synced])
    m.adapter.read = read
    expect(m.removed).toEqual([saved.revision])
    expect((await m.repository.read(saved.thread.id))!.thread.appearance).toBe('blue')
  })
  it('ignores foreign filenames rather than aborting enumeration of valid thread files', async () => {
    const m = setup()
    await m.repository.write(thread(), null)
    await m.app.vault.create('System/Comments/not-a-thread.abcomment', '{broken')
    expect(await m.repository.ids()).toEqual(['aaaaaa'])
    expect(
      await m.app.vault.read(m.app.vault.getFileByPath('System/Comments/not-a-thread.abcomment')!)
    ).toBe('{broken')
  })
  it('reloads from the configured folder without parsing AI siblings', async () => {
    const m = setup()
    const saved = await m.repository.write(thread(), null)
    const reload = new VaultCommentRepository(m.app, () => 'System/Comments')
    expect(await reload.read('aaaaaa')).toEqual(saved)
    expect(await reload.ids()).toEqual(['aaaaaa'])
    expect(await reload.occupied('zzzzzz')).toBe(true)
  })
  it('refuses duplicate creation and stale external changes, including concurrent writers', async () => {
    const m = setup()
    const saved = await m.repository.write(thread(), null)
    await expect(m.repository.write(thread(), null)).rejects.toThrow()
    const results = await Promise.allSettled([
      m.repository.write({ ...thread(), appearance: 'red' }, saved.revision),
      m.repository.write({ ...thread(), appearance: 'blue' }, saved.revision),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    await expect(m.repository.remove('aaaaaa', saved.revision)).rejects.toThrow('changed')
    expect(await m.repository.read('aaaaaa')).not.toBeNull()
  })
  it('detects malformed, missing and restored files and never removes AI siblings', async () => {
    const m = setup()
    expect(await m.repository.read('aaaaaa')).toBeNull()
    const saved = await m.repository.write(thread(), null)
    const file = m.app.vault.getFileByPath('System/Comments/aaaaaa.abcomment')!
    await m.app.vault.modify(file, '{broken')
    await expect(m.repository.read('aaaaaa')).rejects.toThrow()
    await m.app.vault.modify(file, encodeThread(thread()))
    expect(await m.repository.read('aaaaaa')).toEqual(saved)
    await m.repository.remove('aaaaaa', saved.revision)
    expect(await m.repository.read('aaaaaa')).toBeNull()
    expect(
      await m.app.vault.read(m.app.vault.getFileByPath('System/Comments/zzzzzz.abchat')!)
    ).toBe('AI sibling')
  })
  it('publishes into the latest saved note, follows unloaded folder moves, and retains unlinked files', async () => {
    const m = setup()
    let serial = 0
    const service = new TextCommentService(
      m.repository,
      vaultCommentDocuments(m.app),
      () => '2025-01-02T03:04:05.000Z',
      () => (++serial).toString().padStart(6, '0')
    )
    const draft = await service.draft('Notes/sample.md', 'words', 0, 5, 'yellow', 'First')
    await service.publish(draft)
    const reloaded = new TextCommentService(
      new VaultCommentRepository(m.app, () => 'System/Comments'),
      vaultCommentDocuments(m.app),
      () => '',
      () => ''
    )
    await reloaded.rename('Notes', 'Archive')
    expect((await m.repository.read(draft.thread.id))?.thread.anchor.note).toBe('Archive/sample.md')
    await m.app.vault.modify(m.app.vault.getFileByPath('Notes/sample.md')!, 'words')
    expect(await m.repository.ids()).toEqual([draft.thread.id])
  })
})
