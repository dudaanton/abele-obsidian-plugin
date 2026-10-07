import { afterEach, describe, expect, it } from 'vitest'
import { useVault } from '../helpers/testEnv'
import { ChatStorage } from '@/ai/ChatStorage'
import { serializeChat } from '@/ai/ChatLog'
import { resolveAnchorPath } from '@/selection/anchorLinks'
import { chatCopyPath } from '@/ai/chatCopy'

const content = (chatId: string, kind?: 'comment') =>
  serializeChat({
    metadata: { type: 'abele-chat', providerId: '', modelId: '', created: '', chatId, kind },
    messages: [],
    internalMessages: [],
  })
afterEach(() => ChatStorage.destroy())

describe('rebuildable chat identity index', () => {
  it('recovers an emptied chat through its backup and still disambiguates duplicate identities', async () => {
    const app = useVault([
      { path: 'Chats/sample-torn.abchat', content: '' },
      { path: 'Copies/sample-whole.abchat', content: content('source') },
    ])
    const path = 'Chats/sample-torn.abchat'
    const backup = chatCopyPath(app as never, path)
    await app.vault.adapter.write(backup, `${path}\n${content('source')}`)
    const index = await ChatStorage.getInstance().selectionIdentityIndex()
    expect(resolveAnchorPath('source', path, index)).toEqual({
      status: 'ambiguous',
      paths: ['Chats/sample-torn.abchat', 'Copies/sample-whole.abchat'],
    })
    expect(await app.vault.read(app.vault.getFiles()[0])).toBe(content('source'))
    expect(await app.vault.adapter.exists(backup)).toBe(false)
  })
  it('does not trust unchanged file timestamps as identity evidence', async () => {
    const app = useVault([{ path: 'sample.abchat', content: content('source') }])
    const file = app.vault.getFiles()[0]
    file.stat = { mtime: 1, ctime: 1, size: 100 }
    const storage = ChatStorage.getInstance()
    expect(await storage.selectionIdentityIndex()).toEqual([
      { path: 'sample.abchat', chatId: 'source' },
    ])
    await app.vault.modify(file, content('other'))
    expect(await storage.selectionIdentityIndex()).toEqual([
      { path: 'sample.abchat', chatId: 'other' },
    ])
  })
  it('discovers unopened discussions outside the chat folder and refreshes rename, reuse, copies and deletion', async () => {
    const app = useVault([
      { path: 'Elsewhere/discussion.abchat', content: content('source', 'comment') },
    ])
    const storage = ChatStorage.getInstance()
    const resolve = async () =>
      resolveAnchorPath(
        'source',
        'Elsewhere/discussion.abchat',
        await storage.selectionIdentityIndex()
      )
    expect(await resolve()).toEqual({ status: 'found', path: 'Elsewhere/discussion.abchat' })
    const file = app.vault.getFiles()[0]
    await app.vault.rename(file, 'Moved/discussion.abchat')
    await app.vault.create('Elsewhere/discussion.abchat', content('other'))
    expect(await resolve()).toEqual({ status: 'found', path: 'Moved/discussion.abchat' })
    const copy = await app.vault.create('Copies/discussion.abchat', content('source'))
    expect(await resolve()).toEqual({
      status: 'ambiguous',
      paths: ['Copies/discussion.abchat', 'Moved/discussion.abchat'],
    })
    await app.vault.delete(copy)
    await app.vault.delete(file)
    expect(await resolve()).toEqual({ status: 'missing' })
  })
})
