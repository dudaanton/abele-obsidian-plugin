import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadPlugin,
} from './helpers/obsidianCli'

const FOLDER = 'Deferred reload probe'
const CHAT = `${FOLDER}/sample-chat.abchat`
const NOTE = `${FOLDER}/sample-note.md`
const available = isObsidianRunning() && hasTestApi()

describe.runIf(available)('deferred attachments across a plugin reload', () => {
  let created = false
  let report: { restored: string[]; editing: string[]; afterCancel: number; fileKept: boolean }

  beforeAll(async () => {
    expect(
      evalRaw(`(async () => {
      const folder = ${JSON.stringify(FOLDER)}
      if (app.vault.getAbstractFileByPath(folder)) throw new Error('probe folder already exists')
      await app.vault.createFolder(folder)
      await app.vault.create(${JSON.stringify(NOTE)}, 'Sample note body')
      const meta = { v: 2, k: 'meta', type: 'abele-chat', title: 'Sample deferred chat', created: '2026-01-01' }
      const file = await app.vault.create(${JSON.stringify(CHAT)}, JSON.stringify(meta) + '\\n')
      const chats = window.__abeleTest.ChatService.getInstance()
      await chats.openChatFile(file)
      const session = chats.getSessionByFile(file.path)
      session.isStreaming.value = true
      await session.sendMessage('Sample dictated question', [${JSON.stringify(NOTE)}])
      session.isStreaming.value = false
      return 'saved'
    })()`)
    ).toBe('saved')
    created = true
    reloadPlugin()
    report = JSON.parse(evalRaw(`(async () => {
      const chats = window.__abeleTest.ChatService.getInstance()
      const file = app.vault.getAbstractFileByPath(${JSON.stringify(CHAT)})
      await chats.openChatFile(file)
      await chats.revealSidebar()
      const session = chats.getSessionByFile(file.path)
      const restored = session.queuedMessages.value.flatMap(q => q.attachments || [])
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
      for (let i = 0; i < 50 && !document.querySelector('.abele-ai-chat__queued-edit'); i++) await wait(100)
      const edit = document.querySelector('.abele-ai-chat__queued-edit')
      if (!edit) throw new Error('no restored queue to edit')
      edit.click()
      await wait(200)
      const editing = session.draft.value.attachments.map(file => file.path)
      const text = session.draft.value.text
      if (text !== 'Sample dictated question') throw new Error('dictated words were lost')
      if (session.queuedMessages.value.length) throw new Error('editing left a queued copy')
      session.isStreaming.value = true
      await session.sendMessage(text, editing)
      session.isStreaming.value = false
      session.draft.value.text = ''
      session.draft.value.attachments = []
      await wait(100)
      document.querySelector('.abele-ai-chat__queued-remove').click()
      await session.flush()
      const parsed = await window.__abeleTest.ChatStorage.getInstance().loadChat(file)
      return JSON.stringify({ restored, editing, afterCancel: parsed.metadata.queuedMessages?.length || 0,
        fileKept: !!app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}) })
    })()`))
  }, 90_000)

  afterAll(() => {
    if (!created) return
    evalRaw(`(async () => {
      const chats = window.__abeleTest.ChatService.getInstance()
      const session = chats.getSessionByFile(${JSON.stringify(CHAT)})
      if (session) await chats.deleteChat(session.id)
      const folder = app.vault.getAbstractFileByPath(${JSON.stringify(FOLDER)})
      if (folder) await app.vault.delete(folder, true)
      return 'ok'
    })()`)
  })

  it('restores durable attachment references, edits them and persists cancellation', () => {
    expect(report.restored).toEqual([NOTE])
    expect(report.editing).toEqual([NOTE])
    expect(report.afterCancel).toBe(0)
    expect(report.fileKept).toBe(true)
  })
})
