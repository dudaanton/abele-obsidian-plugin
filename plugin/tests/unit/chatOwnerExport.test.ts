import { expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { TFile } from 'obsidian'
import type { ChatSession } from '@/ai/ChatSession'
import { copyFullChatLog } from '@/ai/chatOwnerExport'
import { serializeChat } from '@/ai/ChatLog'
import { useVault } from '../helpers/testEnv'

it('copies the full saved log only through the explicit owner action', async () => {
  const raw = serializeChat({
    metadata: { type: 'abele-chat', title: 'Sample', created: '2026-01-01' },
    messages: [
      {
        id: 'a',
        role: 'assistant',
        content: 'Answer',
        thinking: 'PRIVATE_REASONING',
        timestamp: 1,
      },
    ],
    internalMessages: [{ role: 'user', content: 'PRIVATE_CONTEXT', timestamp: 1 }],
  })
  const app = useVault([{ path: 'Sample.abchat', raw: 'older saved log' }])
  const file = app.vault.getAbstractFileByPath('Sample.abchat') as TFile
  const session = {
    currentChatFile: ref(file),
    saveForRelease: vi.fn(async () => {
      await app.vault.modify(file, raw)
    }),
  } as unknown as ChatSession
  const clipboard = { writeText: vi.fn(async (_text: string) => {}) }
  expect(clipboard.writeText).not.toHaveBeenCalled()
  await copyFullChatLog(session, clipboard)
  expect(session.saveForRelease).toHaveBeenCalledOnce()
  expect(clipboard.writeText).toHaveBeenCalledExactlyOnceWith(raw)
})

it('does not export an old file when the conversation changes while saving', async () => {
  const app = useVault([{ path: 'Sample.abchat', raw: 'private' }])
  const currentChatFile = ref(app.vault.getAbstractFileByPath('Sample.abchat'))
  const session = {
    currentChatFile,
    saveForRelease: async () => {
      currentChatFile.value = null
    },
  } as unknown as ChatSession
  const clipboard = { writeText: vi.fn(async () => {}) }
  await expect(copyFullChatLog(session, clipboard)).rejects.toThrow()
  expect(clipboard.writeText).not.toHaveBeenCalled()
})

it('does not copy a stale log after a save failure', async () => {
  const app = useVault([{ path: 'Sample.abchat', raw: 'older' }])
  const session = {
    currentChatFile: ref(app.vault.getAbstractFileByPath('Sample.abchat')),
    saveForRelease: async () => {
      throw new Error('Sample save failure')
    },
  } as unknown as ChatSession
  const clipboard = { writeText: vi.fn(async () => {}) }
  await expect(copyFullChatLog(session, clipboard)).rejects.toThrow('Sample save failure')
  expect(clipboard.writeText).not.toHaveBeenCalled()
})
