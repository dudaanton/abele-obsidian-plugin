/**
 * A chat linked to a note by hand.
 *
 * The same link a write makes (`chatNoteLinks.test.ts`), on the same data: an entry in the
 * chat file's `touched`, which is the source of truth, copied into the index the footer reads.
 * Nothing here is a second mechanism — a card under the note cannot tell the two apart, a
 * rename follows both, and a later write to an attached note simply dates the link again.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { TFile } from 'obsidian'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { attachNote, chatsOf, detachNote } from '@/ai/chatNoteLinks'
import { CommentService } from '@/ai/CommentService'
import { GlobalStore } from '@/stores/GlobalStore'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { parseChatMetadata, serializeChat } from '@/ai/ChatLog'
import { DEFAULT_AI_SETTINGS, type TouchedNote } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

vi.mock('@/editor/CommentPlugin', () => ({
  dispatchCommentsChanged: vi.fn(),
  setCommentInfoSource: vi.fn(),
}))

const NOTE_A = 'Notes/A.md'
const NOTE_B = 'Notes/B.md'
const AT = '2026-09-03T10:00:00.000Z'

let app: FakeApp

/** A chat file in the folder and in the index, naming `notes`. */
async function seedChat(name: string, notes: TouchedNote[] = []): Promise<TFile> {
  const path = `AI/Chats/${name}.abchat`
  await app.vault.create(
    path,
    serializeChat({
      metadata: {
        type: 'abele-chat',
        providerId: 'p',
        modelId: 'm',
        created: '2026-09-03',
        title: name,
        touched: notes.length ? notes : undefined,
        recap: 'Talked it through.',
      },
      messages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: 1 }],
      internalMessages: [],
    })
  )
  ChatStorage.getInstance().addHistoryEntry({
    path,
    title: name,
    created: '2026-09-03',
    notes: notes.length ? notes : undefined,
  })
  return app.vault.getAbstractFileByPath(path) as TFile
}

const storage = () => ChatStorage.getInstance()
const entryOf = (path: string) =>
  storage()
    .getHistory()
    .find((e) => e.path === path)
const indexed = (path: string) => entryOf(path)?.notes?.map((n) => n.path) ?? []
const inFile = async (file: TFile) =>
  (parseChatMetadata(await app.vault.read(file))?.touched ?? []).map((n) => n.path)

beforeEach(() => {
  app = useVault([
    { path: NOTE_A, content: 'alpha\n' },
    { path: NOTE_B, content: 'beta\n' },
    { path: 'Pictures/x.png', content: 'png' },
  ])
  AgentRegistry.destroy()
  ChatStorage.destroy()
  CommentService.getInstance().destroy()
  ChatService.getInstance().destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    agents: [],
    defaultAgentId: '',
    chatHistory: [],
    chatFolder: 'AI/Chats/{{name}}',
    commentFolder: 'AI/Comments',
  }
  AbeleConfig.getInstance().saveSettings = vi.fn(async () => {})
  AgentRegistry.getInstance().setDefault(AgentRegistry.getInstance().create({ name: 'D' }).id)
  GlobalStore.getInstance().chatLinksVersion.value = 0
  vi.spyOn(ChatService.getInstance(), 'saveTabs').mockImplementation(() => {})
})

describe('attaching a chat nobody has open', () => {
  it('writes the link into the file and the index both', async () => {
    const file = await seedChat('Plans')

    expect(await attachNote(file.path, NOTE_A)).toBe(true)

    expect(await inFile(file)).toEqual([NOTE_A])
    expect(indexed(file.path)).toEqual([NOTE_A])
  })

  it('dates the link by when it was attached', async () => {
    const file = await seedChat('Plans')
    const before = Date.now()

    await attachNote(file.path, NOTE_A)

    expect(new Date(entryOf(file.path)!.notes![0].at).getTime()).toBeGreaterThanOrEqual(before)
  })

  it('says the index changed, so a footer on screen draws the card', async () => {
    const file = await seedChat('Plans')
    const before = GlobalStore.getInstance().chatLinksVersion.value

    await attachNote(file.path, NOTE_A)

    expect(GlobalStore.getInstance().chatLinksVersion.value).toBeGreaterThan(before)
  })

  it('adds to the notes already there, several per chat', async () => {
    const file = await seedChat('Plans', [{ path: NOTE_B, at: AT }])

    await attachNote(file.path, NOTE_A)

    expect(await inFile(file)).toEqual([NOTE_B, NOTE_A])
    expect(indexed(file.path)).toEqual([NOTE_B, NOTE_A])
  })

  it('does nothing twice: a note already linked keeps its one entry and its date', async () => {
    const file = await seedChat('Plans', [{ path: NOTE_A, at: AT }])
    const before = await app.vault.read(file)

    expect(await attachNote(file.path, NOTE_A)).toBe(false)

    expect(await app.vault.read(file)).toBe(before)
    expect(entryOf(file.path)?.notes).toEqual([{ path: NOTE_A, at: AT }])
  })

  it('refuses what has no footer to appear under', async () => {
    const file = await seedChat('Plans')

    expect(await attachNote(file.path, 'Pictures/x.png')).toBe(false)
    expect(await attachNote(file.path, 'Notes/Missing.md')).toBe(false)
    expect(await attachNote(file.path, file.path)).toBe(false)
    expect(indexed(file.path)).toEqual([])
  })

  /** A comment is not in the index; it reaches a note's footer by being expanded, not this. */
  it('refuses a chat that is not in the index', async () => {
    expect(await attachNote('AI/Comments/abc.abchat', NOTE_A)).toBe(false)
  })

  it('survives the index being rebuilt out of the files', async () => {
    const file = await seedChat('Plans')
    await attachNote(file.path, NOTE_A)
    AbeleConfig.getInstance().ai.chatHistory = []

    await storage().refreshHistory()

    expect(indexed(file.path)).toEqual([NOTE_A])
  })
})

describe('attaching the chat open in a tab', () => {
  async function openSession(file: TFile): Promise<ChatSession> {
    const session = new ChatSession(ChatService.getInstance())
    await session.load(file)
    ChatService.getInstance().adoptSession(session)
    return session
  }

  it('goes through the session, so its next save does not take the link back', async () => {
    const file = await seedChat('Plans')
    const session = await openSession(file)

    await attachNote(file.path, NOTE_A)

    expect(session.touched.value.map((n) => n.path)).toEqual([NOTE_A])
    await session.save()
    expect(await inFile(file)).toEqual([NOTE_A])
    expect(indexed(file.path)).toEqual([NOTE_A])
  })

  /** A link made by hand is not work the chat did: nothing to write a recap about. */
  it('does not ask for a recap', async () => {
    const file = await seedChat('Plans')
    const session = await openSession(file)

    await attachNote(file.path, NOTE_A)

    expect((session as unknown as { wantsRecap(): boolean }).wantsRecap()).toBe(false)
  })

  it('is reopened with the link', async () => {
    const file = await seedChat('Plans')
    await openSession(file)
    await attachNote(file.path, NOTE_A)

    const reopened = new ChatSession(ChatService.getInstance())
    await reopened.load(file)

    expect(reopened.touched.value.map((n) => n.path)).toEqual([NOTE_A])
  })
})

describe('detaching', () => {
  it('takes the note out of the file and the index, leaving the others', async () => {
    const file = await seedChat('Plans', [
      { path: NOTE_A, at: AT },
      { path: NOTE_B, at: AT },
    ])

    expect(await detachNote(file.path, NOTE_A)).toBe(true)

    expect(await inFile(file)).toEqual([NOTE_B])
    expect(indexed(file.path)).toEqual([NOTE_B])
  })

  /** The last link gone is a chat that names no notes — not one stuck with its last card. */
  it('clears the last link from the index too', async () => {
    const file = await seedChat('Plans', [{ path: NOTE_A, at: AT }])

    await detachNote(file.path, NOTE_A)

    expect(await inFile(file)).toEqual([])
    expect(entryOf(file.path)?.notes).toBeUndefined()
  })

  it('clears the last link from an open session and its index entry', async () => {
    const file = await seedChat('Plans', [{ path: NOTE_A, at: AT }])
    const session = new ChatSession(ChatService.getInstance())
    await session.load(file)
    ChatService.getInstance().adoptSession(session)

    await detachNote(file.path, NOTE_A)

    expect(session.touched.value).toEqual([])
    expect(await inFile(file)).toEqual([])
    expect(entryOf(file.path)?.notes).toBeUndefined()
  })

  it('does the same to a link a write made — they are one kind of link', async () => {
    const file = await seedChat('Wrote A', [{ path: NOTE_A, at: AT }])

    await detachNote(file.path, NOTE_A)

    expect(indexed(file.path)).toEqual([])
  })

  it('does nothing for a note that was not linked', async () => {
    const file = await seedChat('Plans', [{ path: NOTE_B, at: AT }])
    const before = await app.vault.read(file)

    expect(await detachNote(file.path, NOTE_A)).toBe(false)

    expect(await app.vault.read(file)).toBe(before)
  })
})

describe('an attached note that is renamed', () => {
  it('is followed like any other link', async () => {
    const file = await seedChat('Plans')
    await attachNote(file.path, NOTE_A)

    await storage().handleNoteRename(NOTE_A, 'Notes/Renamed.md')

    expect(await inFile(file)).toEqual(['Notes/Renamed.md'])
    expect(indexed(file.path)).toEqual(['Notes/Renamed.md'])
  })
})

describe('which chats a note has', () => {
  it('lists the chats linked to it, whichever way', async () => {
    await seedChat('Wrote A', [{ path: NOTE_A, at: AT }])
    const attached = await seedChat('Attached')
    await seedChat('Elsewhere', [{ path: NOTE_B, at: AT }])
    await attachNote(attached.path, NOTE_A)

    expect(
      chatsOf(NOTE_A)
        .map((e) => e.title)
        .sort()
    ).toEqual(['Attached', 'Wrote A'])
  })
})

describe('a script', () => {
  const SCRIPT = 'Scripts/tidy.js'

  beforeEach(async () => {
    AbeleConfig.getInstance().ai.scriptsFolder = 'Scripts'
    await app.vault.create(SCRIPT, '// @name tidy\n')
    await app.vault.create('Elsewhere/loose.js', '')
  })

  it('takes a chat attached by hand, and lists it', async () => {
    const file = await seedChat('Plans')

    expect(await attachNote(file.path, SCRIPT)).toBe(true)

    expect(await inFile(file)).toEqual([SCRIPT])
    expect(chatsOf(SCRIPT).map((e) => e.title)).toEqual(['Plans'])
  })

  it('is only a .js under the scripts folder', async () => {
    const file = await seedChat('Plans')

    expect(await attachNote(file.path, 'Elsewhere/loose.js')).toBe(false)
    AbeleConfig.getInstance().ai.scriptsFolder = ''
    expect(await attachNote(file.path, SCRIPT)).toBe(false)
  })
})
