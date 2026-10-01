import { beforeEach, describe, expect, it } from 'vitest'
import { buildScriptContext } from '@/scripting/ScriptContext'
import { useVault } from '../helpers/testEnv'
import { serializeChat } from '@/ai/ChatLog'
import { TFile } from 'obsidian'

const path = 'AI/Chats/sample-chat.abchat'
const original = serializeChat({
  metadata: { type: 'abele-chat', providerId: '', modelId: '', created: '' },
  messages: [{ id: 'r', role: 'assistant', content: 'An invented sentence.', timestamp: 1 }],
  internalMessages: [],
})
let app: ReturnType<typeof useVault>
const context = () =>
  buildScriptContext({ params: {}, signal: new AbortController().signal, logs: [] })
beforeEach(() => {
  app = useVault([
    { path, content: original },
    { path: 'sample-note.md', content: 'before' },
  ])
})
describe('scripts cannot bypass reply review through file operations', () => {
  it.each(['edit', 'write', 'replace', 'create', 'move', 'copy'] as const)(
    'refuses %s into a chat log even with script scope bypass',
    async (operation) => {
      const ctx = context()
      const run = () => {
        if (operation === 'edit')
          return ctx.edit(path, 'An invented sentence.', 'Silently changed.')
        if (operation === 'write')
          return ctx.write(path, original.replace('An invented sentence.', 'Silently changed.'))
        if (operation === 'replace')
          return ctx.replace(path, [
            {
              type: 'replace-in-content',
              old_value: 'An invented sentence.',
              value: 'Silently changed.',
            },
          ])
        if (operation === 'create') return ctx.create('AI/Chats/sample-new.abchat', original)
        if (operation === 'move') return ctx.move('sample-note.md', 'AI/Chats/sample-new.abchat')
        return ctx.copy('sample-note.md', 'AI/Chats/sample-new.abchat')
      }
      await expect(run()).rejects.toThrow(/chat.*(review|controls)/i)
      expect(await app.vault.read(app.vault.getAbstractFileByPath(path) as TFile)).toBe(original)
      expect(app.vault.getAbstractFileByPath('AI/Chats/sample-new.abchat')).toBeNull()
    }
  )
  it('keeps ordinary script note writes unrestricted by chat scope', async () => {
    await context().edit('sample-note.md', 'before', 'after')
    expect(await app.vault.read(app.vault.getAbstractFileByPath('sample-note.md') as TFile)).toBe(
      'after'
    )
  })
})
