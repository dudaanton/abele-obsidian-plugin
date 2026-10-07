import { afterEach, describe, expect, it, vi } from 'vitest'
import { useVault } from '../helpers/testEnv'
import { ChatStorage } from '@/ai/ChatStorage'
import { serializeChat } from '@/ai/ChatLog'
import { resolveAnchorPath } from '@/selection/anchorLinks'
import { chatCopyPath, readChat, rewriteChat } from '@/ai/chatCopy'

const content = (chatId: string, kind?: 'comment') =>
  serializeChat({
    metadata: { type: 'abele-chat', providerId: '', modelId: '', created: '', chatId, kind },
    messages: [],
    internalMessages: [],
  })
afterEach(() => ChatStorage.destroy())

describe('rebuildable chat identity index', () => {
  it('leaves a live writer safety copy intact before truncation and interrupted rewrite', async () => {
    const path = 'Chats/sample-writing.abchat'
    const app = useVault([{ path, content: content('source') }])
    const file = app.vault.getFiles()[0]
    const backup = chatCopyPath(app as never, path)
    const next = content('source', 'comment')
    let release!: () => void, copied!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const ready = new Promise<void>((resolve) => {
      copied = resolve
    })
    const modify = app.vault.modify.bind(app.vault)
    const intercepted = vi.spyOn(app.vault, 'modify').mockImplementationOnce(async () => {
      copied()
      await gate
      await modify(file, '')
      throw new Error('Interrupted rewrite')
    })
    const writing = rewriteChat(app as never, file, next).catch((error: Error) => error.message)
    await ready
    try {
      expect(await ChatStorage.getInstance().selectionIdentityIndex()).toEqual([
        { path, chatId: 'source' },
      ])
      expect(await app.vault.adapter.exists(backup)).toBe(true)
      expect(await app.vault.adapter.read(backup)).toBe(`${path}\n${next}`)
    } finally {
      release()
      expect(await writing).toBe('Interrupted rewrite')
      intercepted.mockRestore()
    }
    expect(await app.vault.read(file)).toBe('')
    expect(await app.vault.adapter.exists(backup)).toBe(true)
    expect((await readChat(app as never, file)).metadata?.kind).toBe('comment')
    expect(await app.vault.read(file)).toBe(next)
  })
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
    // Discovery keeps both copies untouched; the normal open path still repairs the file.
    expect(await app.vault.read(app.vault.getFiles()[0])).toBe('')
    expect(await app.vault.adapter.exists(backup)).toBe(true)
    await ChatStorage.getInstance().loadChat(app.vault.getFiles()[0])
    expect(await app.vault.read(app.vault.getFiles()[0])).toBe(content('source'))
    expect(await app.vault.adapter.exists(backup)).toBe(false)
  })
  it.each([
    ['wrong source path', 'Chats/other.abchat', content('source')],
    ['torn safety copy', 'Chats/sample-inspect.abchat', '{"v":2,"k":"meta"'],
  ])('does not repair or remove a %s during discovery', async (_label, source, copy) => {
    const path = 'Chats/sample-inspect.abchat'
    const app = useVault([{ path, content: '' }])
    const backup = chatCopyPath(app as never, path)
    const raw = `${source}\n${copy}`
    await app.vault.adapter.write(backup, raw)
    expect(await ChatStorage.getInstance().selectionIdentityIndex()).toEqual([
      { path, chatId: undefined },
    ])
    expect(await app.vault.read(app.vault.getFiles()[0])).toBe('')
    expect(await app.vault.adapter.read(backup)).toBe(raw)
  })
  it('keeps a whole main file authoritative and leaves its older backup untouched', async () => {
    const path = 'Chats/sample-whole.abchat'
    const app = useVault([{ path, content: content('current') }])
    const backup = chatCopyPath(app as never, path)
    const raw = `${path}\n${content('earlier')}`
    await app.vault.adapter.write(backup, raw)
    expect(await ChatStorage.getInstance().selectionIdentityIndex()).toEqual([
      { path, chatId: 'current' },
    ])
    expect(await app.vault.adapter.read(backup)).toBe(raw)
    expect(await app.vault.read(app.vault.getFiles()[0])).toBe(content('current'))
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
