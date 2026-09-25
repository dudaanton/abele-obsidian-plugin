/**
 * A chat message kept in a note as a card.
 *
 * What is pinned here is the part that is ours and survives without the app: the block the
 * card is written as reads back to the same message, a message with fences of its own does not
 * break out of it, the card lands on a line of its own at the cursor of the note being worked
 * in — a comment's own note first — and a chat that has been renamed since is still found.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, shallowRef } from 'vue'
import { MarkdownView, TFile } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { ChatService } from '@/ai/ChatService'
import { CommentService } from '@/ai/CommentService'
import {
  formatMessageBlock,
  parseMessageBlock,
  insertMessageCard,
  openMessage,
  removeMessageBlock,
} from '@/ai/messageCards'
import type { ChatSession } from '@/ai/ChatSession'

const inner = (block: string) => block.split('\n').slice(1, -1).join('\n')

describe('the block a card is written as', () => {
  it('reads back to the chat, the message and its text', () => {
    const block = formatMessageBlock({
      chat: 'AI/Chats/Trip.abchat',
      message: 'abc123',
      text: 'First line\n\nSecond: with a colon',
    })

    expect(block.split('\n')[0]).toBe('```abele-message')
    expect(parseMessageBlock(inner(block))).toEqual({
      chat: 'AI/Chats/Trip.abchat',
      message: 'abc123',
      text: 'First line\n\nSecond: with a colon',
    })
  })

  it('is fenced longer than any fence in the message, so the message cannot close it', () => {
    const text = 'Here is code:\n```js\nx()\n```'
    const block = formatMessageBlock({ chat: 'c.abchat', message: 'm', text })

    expect(block.startsWith('````abele-message')).toBe(true)
    expect(block.endsWith('\n````')).toBe(true)
    expect(parseMessageBlock(inner(block))?.text).toBe(text)
  })

  it("carries the chat's title and the message's date, after the two lines that find it", () => {
    const block = formatMessageBlock({
      chat: 'AI/Chats/Trip.abchat',
      message: 'abc123',
      title: 'Planning the trip',
      date: '2026-09-23 14:05',
      text: 'Riga.',
    })

    expect(block.split('\n').slice(1, 5)).toEqual([
      'chat: AI/Chats/Trip.abchat',
      'message: abc123',
      'title: Planning the trip',
      'date: 2026-09-23 14:05',
    ])
    expect(parseMessageBlock(inner(block))).toEqual({
      chat: 'AI/Chats/Trip.abchat',
      message: 'abc123',
      title: 'Planning the trip',
      date: '2026-09-23 14:05',
      text: 'Riga.',
    })
  })

  it('reads a card written before it had a title or a date', () => {
    const block = parseMessageBlock('chat: c.abchat\nmessage: m\n---\ntext')

    expect(block?.title).toBeUndefined()
    expect(block?.date).toBeUndefined()
  })

  it('is refused when it names no chat or no message', () => {
    expect(parseMessageBlock('message: m\n---\ntext')).toBeNull()
    expect(parseMessageBlock('chat: c.abchat\n---\ntext')).toBeNull()
  })
})

/** A note open in a pane, with a cursor, holding its text as lines. */
function openNote(path: string, lines: string[], cursorLine: number) {
  const view = Object.create(MarkdownView.prototype) as MarkdownView
  const file = Object.assign(new TFile(), { path, basename: path.replace(/\.md$/, '') })
  const editor = {
    lines,
    getCursor: () => ({ line: cursorLine, ch: 0 }),
    getLine: (n: number) => lines[n],
    lineCount: () => lines.length,
    replaceRange: (text: string, at: { line: number; ch: number }) => {
      const joined = lines.join('\n')
      let offset = 0
      for (let i = 0; i < at.line; i++) offset += lines[i].length + 1
      offset += at.ch
      const next = joined.slice(0, offset) + text + joined.slice(offset)
      lines.splice(0, lines.length, ...next.split('\n'))
    },
  }
  Object.assign(view, { file, editor, leaf: {} })
  return { view, editor, lines }
}

function session(options: { note?: string; file?: string | null; title?: string } = {}) {
  const file = options.file === null ? null : { path: options.file ?? 'AI/Chats/Trip.abchat' }
  return {
    allMessages: ref([
      { id: 'm1', role: 'user', content: 'Where to?', timestamp: 1 },
      {
        id: 'm2',
        role: 'assistant',
        content: 'Riga, then Tallinn.',
        timestamp: new Date(2026, 8, 23, 14, 5).getTime(),
      },
    ]),
    chatTitle: ref(options.title ?? ''),
    anchor: shallowRef(options.note ? { note: options.note } : null),
    currentChatFile: shallowRef(file),
    save: vi.fn(),
  } as unknown as ChatSession
}

function workspaceWith(views: MarkdownView[], recent: MarkdownView | null) {
  ;(GlobalStore.getInstance() as unknown as { _app: unknown })._app = {
    workspace: {
      rootSplit: {},
      getLeavesOfType: () => views.map((view) => ({ view })),
      getMostRecentLeaf: () => (recent ? { view: recent } : null),
    },
    vault: {},
  }
}

describe('putting a card into a note', () => {
  it('goes after the line the cursor is on, as a block of its own', async () => {
    const note = openNote('Plans.md', ['# Plans', 'A paragraph', 'More'], 1)
    workspaceWith([note.view], note.view)

    expect(await insertMessageCard(session(), 'm2')).toBe(true)

    expect(note.lines.slice(0, 4)).toEqual(['# Plans', 'A paragraph', '', '```abele-message'])
    const text = note.lines.join('\n')
    expect(text).toContain('Riga, then Tallinn.\n```\n\nMore')
    expect(text.endsWith('\nMore')).toBe(true)
  })

  it('leaves one blank line under it, not two, when the note already has one there', async () => {
    const note = openNote('Plans.md', ['A paragraph', '', 'More'], 0)
    workspaceWith([note.view], note.view)

    await insertMessageCard(session(), 'm2')

    expect(note.lines.join('\n')).toContain('Riga, then Tallinn.\n```\n\nMore')
  })

  it('leaves one blank line under it when put on an empty line with another below', async () => {
    const note = openNote('Plans.md', ['Text', '', '', 'More'], 1)
    workspaceWith([note.view], note.view)

    await insertMessageCard(session(), 'm2')

    expect(note.lines.join('\n')).toContain('Riga, then Tallinn.\n```\n\nMore')
  })

  it('adds no empty line at the end of a note', async () => {
    const note = openNote('Plans.md', ['Text', ''], 1)
    workspaceWith([note.view], note.view)

    await insertMessageCard(session(), 'm2')

    expect(note.lines[note.lines.length - 1]).toBe('```')
  })

  it("names the chat by its title and dates the card by the message's time", async () => {
    const note = openNote('Plans.md', ['x'], 0)
    workspaceWith([note.view], note.view)

    await insertMessageCard(session({ title: 'Baltic trip' }), 'm2')

    const text = note.lines.join('\n')
    expect(text).toContain('message: m2\ntitle: Baltic trip\ndate: 2026-09-23 14:05\n---')
  })

  it('takes an empty line as it is', async () => {
    const note = openNote('Plans.md', ['Text', '', 'More'], 1)
    workspaceWith([note.view], note.view)

    await insertMessageCard(session(), 'm1')

    expect(note.lines.slice(0, 3)).toEqual([
      'Text',
      '```abele-message',
      'chat: AI/Chats/Trip.abchat',
    ])
  })

  it("goes into a comment's own note, not the one last looked at", async () => {
    const own = openNote('Commented.md', ['Passage'], 0)
    const other = openNote('Other.md', ['Elsewhere'], 0)
    workspaceWith([other.view, own.view], other.view)

    await insertMessageCard(session({ note: 'Commented.md' }), 'm2')

    expect(own.lines.join('\n')).toContain('message: m2')
    expect(other.lines).toEqual(['Elsewhere'])
  })

  it('saves a chat that has no file yet, since the card has to lead somewhere', async () => {
    const note = openNote('Plans.md', ['x'], 0)
    workspaceWith([note.view], note.view)
    const s = session({ file: null })
    ;(s.save as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      s.currentChatFile.value = { path: 'AI/Chats/New.abchat' } as TFile
    })

    await insertMessageCard(s, 'm2')

    expect(s.save).toHaveBeenCalled()
    expect(note.lines.join('\n')).toContain('chat: AI/Chats/New.abchat')
  })

  it('writes nothing when no note is open', async () => {
    workspaceWith([], null)

    expect(await insertMessageCard(session(), 'm2')).toBe(false)
  })
})

describe('pressing a card', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    ChatService.getInstance().pendingReveal.value = null
  })

  it('opens the chat and asks for the message', async () => {
    const chat = Object.assign(new TFile(), { path: 'AI/Chats/Trip.abchat', basename: 'Trip' })
    ;(GlobalStore.getInstance() as unknown as { _app: unknown })._app = {
      vault: { getFileByPath: (p: string) => (p === chat.path ? chat : null) },
    }
    const service = ChatService.getInstance()
    const opened = vi.spyOn(service, 'openChatFile').mockResolvedValue()
    vi.spyOn(service, 'revealSidebar').mockResolvedValue()
    vi.spyOn(CommentService.getInstance(), 'isCommentFile').mockReturnValue(false)

    await openMessage({ chat: chat.path, message: 'm2', text: '' }, 'Plans.md')

    expect(opened).toHaveBeenCalledWith(chat)
    expect(service.pendingReveal.value).toBe('m2')
  })

  it('finds a chat renamed since by its message, and corrects the card', async () => {
    const moved = Object.assign(new TFile(), {
      path: 'AI/Chats/Riga trip.abchat',
      extension: 'abchat',
    })
    const other = Object.assign(new TFile(), { path: 'AI/Chats/Other.abchat', extension: 'abchat' })
    const note = Object.assign(new TFile(), { path: 'Plans.md' })
    let noteText = '```abele-message\nchat: AI/Chats/New chat.abchat\nmessage: m2\n---\nhi\n```'
    ;(GlobalStore.getInstance() as unknown as { _app: unknown })._app = {
      vault: {
        getFileByPath: (p: string) => (p === 'Plans.md' ? note : null),
        getFiles: () => [other, moved, note],
        cachedRead: async (f: TFile) =>
          f === moved ? '{"id":"m2","role":"assistant"}' : '{"id":"zz"}',
        process: async (_f: TFile, fn: (t: string) => string) => {
          noteText = fn(noteText)
        },
      },
    }
    const service = ChatService.getInstance()
    const opened = vi.spyOn(service, 'openChatFile').mockResolvedValue()
    vi.spyOn(service, 'revealSidebar').mockResolvedValue()
    vi.spyOn(CommentService.getInstance(), 'isCommentFile').mockReturnValue(false)

    await openMessage({ chat: 'AI/Chats/New chat.abchat', message: 'm2', text: 'hi' }, 'Plans.md')

    expect(opened).toHaveBeenCalledWith(moved)
    expect(noteText).toContain('chat: AI/Chats/Riga trip.abchat\nmessage: m2')
    expect(service.pendingReveal.value).toBe('m2')
  })

  it('opens a comment as a comment, not as a full chat', async () => {
    const comment = Object.assign(new TFile(), {
      path: 'AI/Comments/k7d2ph.abchat',
      basename: 'k7d2ph',
    })
    ;(GlobalStore.getInstance() as unknown as { _app: unknown })._app = {
      vault: { getFileByPath: () => comment },
    }
    const comments = CommentService.getInstance()
    vi.spyOn(comments, 'isCommentFile').mockReturnValue(true)
    const shown = vi.spyOn(comments, 'showInSidebar').mockResolvedValue(true)
    const expanded = vi.spyOn(comments, 'openFile').mockResolvedValue()

    await openMessage({ chat: comment.path, message: 'm1', text: '' })

    expect(shown).toHaveBeenCalledWith('k7d2ph')
    expect(expanded).not.toHaveBeenCalled()
  })
})

describe('removing a card from its note', () => {
  const card = (message: string, text = 'hi') =>
    formatMessageBlock({ chat: 'c.abchat', message, text })

  it('takes the block out with one of the blank lines around it', () => {
    const note = ['Before', '', card('m1'), '', 'After'].join('\n')

    expect(removeMessageBlock(note, 'm1')).toBe('Before\n\nAfter')
  })

  it('takes the blank line after a card that opened the note', () => {
    expect(removeMessageBlock([card('m1'), '', 'After'].join('\n'), 'm1')).toBe('After')
  })

  it('takes only the card for that message, a fence inside a message included', () => {
    const other = card('m2', 'code:\n```js\nx()\n```')
    const note = ['A', '', card('m1'), '', other, '', 'B'].join('\n')

    expect(removeMessageBlock(note, 'm2')).toBe(['A', '', card('m1'), '', 'B'].join('\n'))
  })

  it('takes the one on the given line when a message is in the note twice', () => {
    const note = [card('m1', 'first'), '', card('m1', 'second')].join('\n')
    const second = note.split('\n').indexOf('second') - 4

    expect(removeMessageBlock(note, 'm1', second)).toBe(card('m1', 'first'))
  })

  it('leaves a note with no such card as it was', () => {
    expect(removeMessageBlock('Just text', 'm1')).toBe('Just text')
  })
})
