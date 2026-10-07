import { describe, expect, it, vi } from 'vitest'
import { routeChatAnchorLinks } from '@/ai/chatFileLeaves'

describe('selection links clicked in ordinary notes', () => {
  it('routes the address before Obsidian resolves a stale or reused file path', async () => {
    const original = vi.fn(async () => {})
    const workspace = { openLinkText: original }
    const open = vi.fn(async () => {})
    const undo = routeChatAnchorLinks(workspace as never, open)
    await workspace.openLinkText('old.abchat#abele-selection=chat/anchor', 'note.md', false)
    expect(open).toHaveBeenCalledWith('old.abchat#abele-selection=chat/anchor')
    expect(original).not.toHaveBeenCalled()
    await workspace.openLinkText('other.md#Heading', 'note.md', false)
    expect(original).toHaveBeenCalledWith('other.md#Heading', 'note.md', false, undefined)
    undo()
    expect(workspace.openLinkText).toBe(original)
  })
  it('fails closed on malformed selection addresses instead of creating a note', async () => {
    const original = vi.fn(async () => {})
    const workspace = { openLinkText: original }
    const open = vi.fn(async () => {})
    const undo = routeChatAnchorLinks(workspace as never, open)
    await workspace.openLinkText('deleted.abchat#abele-selection=%FF/a', '', false)
    expect(open).toHaveBeenCalledOnce()
    expect(original).not.toHaveBeenCalled()
    undo()
  })
})
