import { describe, it, expect, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import type { App } from 'obsidian'
import { TextComments } from '@/comments/TextComments'
import { GlobalStore } from '@/stores/GlobalStore'
import { ChatStorage } from '@/ai/ChatStorage'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { buildFakeVault } from '../helpers/fakeVault'
import { encodeThread, type CommentThread } from '@/comments/model'

function setup() {
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    enabled: false,
    commentFolder: 'System/Comments',
  }
  const folder = ChatStorage.commentsFolder()
  const thread: CommentThread = {
    version: 1,
    id: 'aaaaaa',
    anchor: { note: 'Notes/sample.md', quote: 'words' },
    appearance: 'yellow',
    entries: [{ id: 'bbbbbb', body: 'First', createdAt: '2025-01-02T03:04:05.000Z' }],
  }
  const fake = buildFakeVault([
    { path: 'Notes/sample.md', content: 'words%%c:aaaaaa%%' },
    { path: folder + '/aaaaaa.abcomment', content: encodeThread(thread) },
  ])
  const app = Object.assign(fake, { workspace: { iterateAllLeaves() {} } }) as unknown as App
  ;(GlobalStore.getInstance() as unknown as { _app: unknown })._app = app
  const comments = new TextComments(app)
  return { app, comments, thread, folder }
}
describe('vault human comment presentation adapter', () => {
  it('invalidates external changes, missing/restored files and malformed revisions without losing kind', async () => {
    const m = setup()
    m.comments.touch('Notes/sample.md', ['aaaaaa'])
    await flushPromises()
    expect(m.comments.get('aaaaaa')).toMatchObject({
      kind: 'human',
      appearance: 'yellow',
      messages: 1,
    })
    const file = m.app.vault.getFileByPath(m.folder + '/aaaaaa.abcomment')!
    await m.app.vault.modify(file, encodeThread({ ...m.thread, appearance: 'pink' }))
    m.comments.invalidate('aaaaaa')
    m.comments.touch('Notes/sample.md', ['aaaaaa'])
    await flushPromises()
    expect(m.comments.get('aaaaaa')?.appearance).toBe('pink')
    await m.app.vault.delete(file)
    m.comments.invalidate('aaaaaa')
    m.comments.touch('Notes/sample.md', ['aaaaaa'])
    await flushPromises()
    expect(m.comments.get('aaaaaa')).toMatchObject({ kind: 'human', messages: 0 })
    const restored = await m.app.vault.create(m.folder + '/aaaaaa.abcomment', '{broken')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    m.comments.invalidate('aaaaaa')
    m.comments.touch('Notes/sample.md', ['aaaaaa'])
    await flushPromises()
    expect(m.comments.get('aaaaaa')?.state).toBe('error')
    expect(log).toHaveBeenCalled()
    log.mockRestore()
    await m.app.vault.modify(restored, encodeThread(m.thread))
    m.comments.invalidate('aaaaaa')
    m.comments.touch('Notes/sample.md', ['aaaaaa'])
    await flushPromises()
    expect(m.comments.get('aaaaaa')).toMatchObject({
      appearance: 'yellow',
      state: 'idle',
      messages: 1,
    })
    m.comments.destroy()
  })
})
