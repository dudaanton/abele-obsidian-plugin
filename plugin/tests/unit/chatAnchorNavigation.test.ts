import { describe, expect, it } from 'vitest'
import {
  anchorBacklink,
  anchorAddress,
  parseAnchorLink,
  resolveAnchorPath,
} from '@/selection/anchorLinks'
import { resolveAnchorReturn, prepareSelectionBacklink } from '@/ai/chatAnchorNavigation'
import { captureChatSelection, createChatAnchor } from '@/selection/anchors'
import type { ChatMessage } from '@/ai/types'

const revision = {
  reference: { chatId: 'conversation', messageId: 'answer', revisionId: 'version' },
  content: 'echo **echo**',
  projection: { version: 'chat-text-v1', text: 'echo echo' },
}
const snapshot = captureChatSelection({
  revision,
  range: { space: 'rendered', start: 5, end: 9 },
  sentence: 'echo echo',
  title: 'Sample',
  pathHint: 'Chats/sample.abchat',
  role: 'assistant',
  author: 'assistant',
})
const anchor = createChatAnchor(snapshot, revision, () => 'anchor')
const message: ChatMessage = {
  id: 'answer',
  role: 'assistant',
  content: revision.content,
  timestamp: 1,
  selection: { revisionId: 'version', versions: [revision], anchors: [anchor] },
}
const child = (id: string, parentId: string, timestamp: number): ChatMessage => ({
  id,
  parentId,
  timestamp,
  role: 'user',
  content: id,
})

describe('ordinary selection backlinks', () => {
  it('escapes address and path delimiters without losing Unicode or literal percent signs', () => {
    const address = { chatId: 'chat#[]|% /🪴', anchorId: 'anchor/|]#%?' }
    const path = 'Chats/sample # [one]%.abchat'
    const link = anchorBacklink(path, address)
    expect(link).toMatch(/^\[\[.*\|Return to selection\]\]$/)
    expect(parseAnchorLink(link.slice(2, -2).split('|')[0])).toEqual({ pathHint: path, address })
    expect(parseAnchorLink(path + '#' + anchorAddress(address))).toEqual({
      pathHint: path,
      address,
    })
  })
  it('does not treat ordinary headings or malformed addresses as anchors', () => {
    expect(parseAnchorLink('sample.abchat#Introduction')).toBeNull()
    expect(parseAnchorLink('sample.abchat#abele-selection=%FF/a')).toBeNull()
    expect(parseAnchorLink('sample.abchat#abele-selection=/a')).toBeNull()
  })
  it('uses identity after rename, including an old path reused by a different chat', () => {
    expect(
      resolveAnchorPath('chat', 'old.abchat', [
        { path: 'old.abchat', chatId: 'other' },
        { path: 'nested/new.abchat', chatId: 'chat' },
      ])
    ).toEqual({ status: 'found', path: 'nested/new.abchat' })
  })
  it('requires disambiguation for copies even when the hinted path exists', () => {
    expect(
      resolveAnchorPath('chat', 'first.abchat', [
        { path: 'second.abchat', chatId: 'chat' },
        { path: 'first.abchat', chatId: 'chat' },
      ])
    ).toEqual({ status: 'ambiguous', paths: ['first.abchat', 'second.abchat'] })
    expect(
      resolveAnchorPath('deleted', 'first.abchat', [{ path: 'first.abchat', chatId: 'chat' }])
    ).toEqual({ status: 'missing' })
  })
  it('exposes no backlink when anchor persistence fails', async () => {
    let exposed = false
    await expect(
      prepareSelectionBacklink(snapshot, {
        ensureAnchor: async () => {
          throw new Error('save failed')
        },
        path: () => 'sample.abchat',
      }).then(() => {
        exposed = true
      })
    ).rejects.toThrow('save failed')
    expect(exposed).toBe(false)
  })
})

describe('verified return targets', () => {
  it('retains the active descendant branch containing the message', () => {
    const messages = [message, child('later-b', 'answer', 3), child('later-a', 'answer', 2)]
    expect(
      resolveAnchorReturn('conversation', 'anchor', messages, ['answer', 'later-b'])
    ).toMatchObject({
      status: 'ready',
      leafId: 'later-b',
      messageId: 'answer',
      resolution: { status: 'current', placement: { range: { start: 5, end: 9 } } },
    })
  })
  it('chooses a deterministic valid descendant when the wrong branch is active', () => {
    const messages = [
      message,
      child('z', 'answer', 2),
      child('a', 'answer', 2),
      child('other', 'root', 3),
    ]
    expect(resolveAnchorReturn('conversation', 'anchor', messages, ['other'])).toMatchObject({
      status: 'ready',
      leafId: 'a',
    })
  })
  it('returns the retained historical revision, never another occurrence in edited text', () => {
    const changed = {
      ...message,
      content: 'echo changed echo',
      selection: { ...message.selection!, revisionId: 'new' },
    }
    expect(resolveAnchorReturn('conversation', 'anchor', [changed], ['answer'])).toMatchObject({
      status: 'ready',
      resolution: { status: 'historical', revision },
    })
  })
  it('keeps the quote when no verified source survives and does not guess', () => {
    const changed = { ...message, selection: { ...message.selection!, versions: [] } }
    expect(resolveAnchorReturn('conversation', 'anchor', [changed], ['answer'])).toMatchObject({
      status: 'ready',
      resolution: { status: 'unresolved', snapshot },
    })
    expect(resolveAnchorReturn('other', 'anchor', [message], ['answer'])).toEqual({
      status: 'missing',
    })
  })
  it('rejects duplicate anchor identities rather than picking the first message', () => {
    expect(
      resolveAnchorReturn(
        'conversation',
        'anchor',
        [message, { ...message, id: 'copy' }],
        ['answer']
      )
    ).toEqual({ status: 'ambiguous' })
  })
})
