import { beforeEach, expect, it, vi } from 'vitest'
import { ref, shallowRef } from 'vue'
import { chatCodeSelection, insertCodeSelection } from '@/views/codeSelectionHost'
import { addGithubSelection } from '@/github/addSelection'

const f = vi.hoisted(() => ({
  chats: undefined as any,
  note: undefined as any,
  insert: vi.fn(() => ({ line: 3, ch: 0 })),
}))
vi.mock('@/ai/ChatService', () => ({ ChatService: { getInstance: () => f.chats } }))
vi.mock('@/github/linking', () => ({ recentNoteView: () => f.note }))
vi.mock('@/helpers/editorHelpers', () => ({ insertBlockOnOwnLine: f.insert }))
beforeEach(() => {
  f.chats = {
    activeSession: shallowRef({ id: 'sample-chat', conversationVersion: ref(2) }),
    pendingInput: ref(null),
    openBlankChat: vi.fn().mockResolvedValue({ id: 'sample-new-chat' }),
    revealSidebar: vi.fn(),
  }
  f.note = { editor: { setCursor: vi.fn() } }
  vi.clearAllMocks()
})
const selection = { text: 'sample value', from: 2, to: 4, side: 'before' as const }

it('inserts selected code into the recent note with its line span and diff side', () => {
  insertCodeSelection({} as never, 'sample.ts', selection)
  expect(f.insert).toHaveBeenCalledWith(
    f.note.editor,
    expect.stringContaining('sample.ts:2-4 (before)')
  )
  expect(f.insert).toHaveBeenCalledWith(f.note.editor, expect.stringContaining('sample value'))
  expect(f.note.editor.setCursor).toHaveBeenCalledWith({ line: 3, ch: 0 })
})
it('prepares a new chat draft for ask and appends to the existing draft for add', async () => {
  await chatCodeSelection('ask', 'sample.ts', selection)
  expect(f.chats.pendingInput.value).toMatchObject({
    tabId: 'sample-new-chat',
    append: false,
    focus: true,
  })
  await chatCodeSelection('add', 'sample.ts', selection)
  expect(f.chats.openBlankChat).toHaveBeenCalledTimes(1)
  expect(f.chats.pendingInput.value).toMatchObject({
    tabId: 'sample-chat',
    append: true,
    text: expect.stringContaining('sample value'),
  })
})
it('keeps GitHub add addressed to the chat chosen before the permalink resolves', async () => {
  let resolve!: (link: { url: string; label: string }) => void
  const link = new Promise<{ url: string; label: string }>((done) => {
    resolve = done
  })
  const adding = addGithubSelection(link, { code: 'sample value', path: 'sample.ts' })
  f.chats.activeSession.value = { id: 'sample-other-chat', conversationVersion: ref(1) }
  resolve({
    url: 'https://github.com/sample/project/blob/sample/sample.ts#L2-L4',
    label: 'Sample lines',
  })
  await adding
  expect(f.chats.pendingInput.value).toMatchObject({
    tabId: 'sample-chat',
    append: true,
    text: expect.stringContaining('sample value'),
  })
})
it('handles a rejected permalink even when no chat is open', async () => {
  f.chats.activeSession.value = null
  const link = Promise.reject(new Error('Sample unavailable link'))
  await addGithubSelection(link, { code: 'sample', path: 'sample.ts' })
})
