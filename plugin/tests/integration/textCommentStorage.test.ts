import { describe, expect, it } from 'vitest'
import type { App } from 'obsidian'
import { buildFakeVault } from '../helpers/fakeVault'
import { VaultCommentRepository, vaultCommentDocuments } from '@/comments/vaultRepository'
import { TextCommentService } from '@/comments/service'
import { encodeThread, type CommentThread } from '@/comments/model'

const thread = (): CommentThread => ({
  version: 1,
  id: 'aaaaaa',
  anchor: { note: 'Notes/sample.md', quote: 'words' },
  appearance: 'yellow',
  entries: [{ id: 'bbbbbb', body: 'First', createdAt: '2025-01-02T03:04:05.000Z' }],
})
function setup() {
  const fake = buildFakeVault([
    { path: 'Notes/sample.md', content: 'words' },
    { path: 'System/Comments/zzzzzz.abchat', content: 'AI sibling' },
  ])
  const app = fake as unknown as App
  const repository = new VaultCommentRepository(app, () => 'System/Comments')
  return { fake, app, repository }
}
describe('vault human comment repository', () => {
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
