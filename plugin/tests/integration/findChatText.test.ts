import { afterEach, expect, it, vi } from 'vitest'
import { buildFakeVault } from '../helpers/fakeVault'
import { findChatText } from '@/ai/tools/findChatText'
import { chatForAgent } from '@/ai/chatText'
import { conversationLog } from '@/ai/ChatLog'
import type { TFile, Vault } from 'obsidian'

afterEach(() => vi.restoreAllMocks())
const meta = { v: 2, k: 'meta', type: 'abele-chat', title: 'Sample', activeLeafId: 'a' }
const records = [
  meta,
  { k: 'msg', id: 'u', role: 'user', content: 'question', timestamp: 1 },
  { k: 'msg', id: 'old', parentId: 'u', role: 'assistant', content: 'abandoned', timestamp: 2 },
  { k: 'msg', id: 'tool', parentId: 'u', role: 'tool-call', toolResult: 'PRIVATE', timestamp: 3 },
  { k: 'msg', id: 'a', parentId: 'tool', role: 'assistant', content: 'obsolete', timestamp: 4 },
  { k: 'int', role: 'toolResult', content: 'PRIVATE' },
  { k: 'msg', id: 'a', parentId: 'tool', role: 'assistant', content: 'answer', timestamp: 4 },
  { ...meta, title: 'Updated sample' },
]
const raw = records.map((r) => JSON.stringify(r)).join('\n') + '\n'

it('retains last-wins metadata, messages and branch topology without private records', async () => {
  const log = await conversationLog(raw, async () => {})
  expect(chatForAgent(log, 'Sample')).toBe(chatForAgent(raw, 'Sample'))
  expect(chatForAgent(log, 'Sample')).toContain('Updated sample')
  expect(chatForAgent(log, 'Sample')).toContain('answer')
  expect(chatForAgent(log, 'Sample')).not.toMatch(/PRIVATE|abandoned|obsolete/)
})

it('preserves glued recovery, nested private objects, torn lines and legacy files', async () => {
  const publicRecord = JSON.stringify({
    k: 'msg',
    id: 'a',
    role: 'assistant',
    content: 'recovered',
    timestamp: 2,
  })
  const cases = [
    JSON.stringify(meta) + '\n' + '{"k":"int","content":"torn' + publicRecord + '\n',
    JSON.stringify(meta) +
      '\n' +
      JSON.stringify({
        k: 'int',
        content: { k: 'msg', id: 'a', role: 'assistant', content: 'PRIVATE' },
      }) +
      '\n',
    raw + '{"k":"msg","content":"torn',
    JSON.stringify({
      metadata: { type: 'abele-chat', title: 'Legacy' },
      messages: [{ id: 'u', role: 'user', content: 'legacy question' }],
      internalMessages: [{ role: 'toolResult', content: 'PRIVATE' }],
    }),
  ]
  for (const value of cases) {
    const reduced = await conversationLog(value, async () => {})
    expect(chatForAgent(reduced, 'Sample')).toBe(chatForAgent(value, 'Sample'))
    expect(chatForAgent(reduced, 'Sample')).not.toContain('PRIVATE')
  }
})

it('caches only transcripts and invalidates on write, rename, delete and stat change', async () => {
  const app = buildFakeVault([{ path: 'Renamed.md', raw, mtime: 1 }])
  const vault = app.vault as unknown as Vault
  const file = vault.getAbstractFileByPath('Renamed.md') as TFile
  let current = raw
  const read = vi.spyOn(app.vault, 'cachedRead').mockImplementation(async () => current)
  const get = () =>
    findChatText(
      vault,
      file,
      async () => {},
      () => vault.cachedRead(file)
    )
  expect(await get()).toContain('answer')
  expect(await get()).not.toContain('PRIVATE')
  expect(read).toHaveBeenCalledTimes(1)
  current = raw.replace('answer', 'edited')
  for (const event of ['modify', 'rename', 'delete']) {
    app.emit('vault', event, file)
    expect(await get()).toContain('edited')
  }
  expect(read).toHaveBeenCalledTimes(4)
  file.stat.mtime++
  await get()
  expect(read).toHaveBeenCalledTimes(5)
})

it('can abort cooperatively inside a single huge private line', async () => {
  const value =
    JSON.stringify(meta) + '\n' + '{"k":"int","content":"' + 'x'.repeat(50 * 1024 * 1024) + '"}\n'
  const clock = vi.spyOn(performance, 'now')
  let now = 0
  clock.mockImplementation(() => (now += 10))
  let yields = 0
  await expect(
    conversationLog(value, async () => {
      yields++
      throw new Error('cancelled')
    })
  ).rejects.toThrow('cancelled')
  expect(yields).toBe(1)
})
