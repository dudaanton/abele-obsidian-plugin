import { afterAll, beforeAll, expect, it } from 'vitest'
import { vaultCli } from './helpers/obsidianCli'
import { showAs, windowSize } from './helpers/phoneWindow'
import type { TestVault } from './helpers/syncVault'
import { probePrelude } from './helpers/layoutProbe'
import { shotDir } from './helpers/shots'

const shots = shotDir('stopped-history')
let vault: TestVault
let size: [number, number]
beforeAll(() => {
  const name = process.env.OBSIDIAN_TEST_VAULT
  if (!name) throw Error('Lease a pool vault for the stopped-history check')
  vault = { ...vaultCli(name), path: '', dispose: async () => {} }
  size = windowSize(vault)
  expect(vault.evalAwait('!!window.__abeleTest')).toBe(true)
})
afterAll(async () => {
  if (!vault) return
  await showAs(vault, size[0], size[1], false)
})

it.each(['desktop', 'phone'] as const)(
  '%s stopped turns retain calls, results and text after reopening',
  async (device) => {
    await showAs(vault, device === 'phone' ? 390 : 1200, 844, device === 'phone')
    for (const state of ['stream', 'tool', 'approval']) {
      const report = vault.evalAwait<any>(
        String.raw`(async () => {
      ${probePrelude(shots)}
      const chats = window.__abeleTest.ChatService.getInstance()
      const previous = chats.activeTabId.value, realFetch = window.fetch
      const leftClosed = app.workspace.leftSplit.collapsed, rightClosed = app.workspace.rightSplit.collapsed
      const root = 'Sample stopped history ' + Date.now()
      const prefix = 'kept-' + ${JSON.stringify(state)} + '-'
      const fake = 'https://sample.invalid/stopped-model'
      const state = ${JSON.stringify(state)}
      let session, sending, requests = 0, executions = 0, nextHistory
      try {
        await app.vault.createFolder(root)
        const note = await app.vault.create(root + '/sample-note.md', 'Original sample')
        const file = await app.vault.create(root + '/sample-chat.abchat', JSON.stringify({v: 2, k: 'meta', type: 'abele-chat', title: 'Sample stopped turn'}) + '\n')
        await chats.openChatFile(file)
        session = chats.getSessionByFile(file.path)
        if (!session) throw Error('The fixture chat did not open')
        session.resolveModel = () => ({id: 'sample', name: 'Sample', baseUrl: fake, apiKey: '', contextWindow: 100000, maxTokens: 1000, supportsReasoning: false})
        session.needsApproval = (_name, args) => state === 'approval' && args?.ask === true
        session.getTools = () => [{name: 'sample_read', description: 'Read a fixture', parameters: {}, execute: async id => {
          executions++
          if (state === 'tool' && id === prefix + '3') { session.abort(); throw new DOMException('Stopped', 'AbortError') }
          if (id === prefix + '2') await app.vault.modify(note, 'Saved sample')
          return {content: [{type: 'text', text: 'Sample result ' + id}]}
        }}]
        for (const key of ['generateTitle', 'generateSummary', 'generateRecap', 'autoCompactIfNeeded']) session.summarizer[key] = async () => undefined
        const chunk = (delta, finish_reason) => 'data: ' + JSON.stringify({choices: [{delta, finish_reason}]}) + '\n\n'
        window.fetch = async (url, init) => {
          if (typeof url !== 'string' || !url.startsWith(fake)) return realFetch(url, init)
          requests++
          if (requests === 1) {
            const tool_calls = Array.from({length: state === 'stream' ? 2 : 4}, (_, i) => ({index: i, id: prefix + (i + 1), function: {name: 'sample_read', arguments: JSON.stringify({path: 'sample-note.md', ask: i >= 2})}}))
            return new Response(chunk({content: 'Sample updates are ready.'}) + chunk({tool_calls}, 'tool_calls') + 'data: [DONE]\n\n')
          }
          if (state === 'stream' && requests === 2) return new Response(new ReadableStream({start(controller) {
            controller.enqueue(new TextEncoder().encode(chunk({content: 'Both completed results are kept.'})))
            init.signal.addEventListener('abort', () => controller.error(new DOMException('Stopped', 'AbortError')), {once: true})
          }}))
          nextHistory = JSON.parse(init.body).messages
          return new Response(chunk({content: 'Continue without replay.'}, 'stop') + 'data: [DONE]\n\n')
        }
        sending = session.sendMessage('Inspect the sample: ' + state)
        if (state === 'stream') {
          if (!(await until(() => session.streamingContent.value.includes('Both completed results'), 5000))) throw Error('No streaming text')
          session.abort()
        }
        await sending
        if (state === 'approval') session.stopFromApproval()
        await session.flush()
        const kept = session.messages.value.filter(m => m.toolCallId?.startsWith(prefix))
        const partial = session.messages.value.some(m => m.content === 'Both completed results are kept.')
        await session.load(file)
        const reopened = session.messages.value.filter(m => m.toolCallId?.startsWith(prefix))
        await chats.revealSidebar({focus: false})
        await wait(300)
        const scroller = document.querySelector('.abele-ai-chat__messages')
        if (scroller) scroller.scrollTop = scroller.scrollHeight
        await wait(150)
        await shoot(${JSON.stringify(device)} + '-' + state)
        await session.sendMessage('Continue without replay')
        return {kept, reopened, partial, executions, nextHistory, content: await app.vault.read(note)}
      } finally {
        if (session) {session.abort(); if (sending) await sending.catch(() => {}); await chats.deleteChat(session.id)}
        window.fetch = realFetch
        const folder = app.vault.getAbstractFileByPath(root)
        if (folder) await app.vault.delete(folder, true)
        if (previous) chats.switchTab(previous)
        if (leftClosed) app.workspace.leftSplit.collapse(); else app.workspace.leftSplit.expand()
        if (rightClosed) app.workspace.rightSplit.collapse(); else app.workspace.rightSplit.expand()
      }
    })()`,
        30000
      )
      expect(report.reopened).toEqual(report.kept)
      expect(report.kept.slice(0, 2).map((m: any) => m.toolResult)).toEqual([
        'Sample result kept-' + state + '-1',
        'Sample result kept-' + state + '-2',
      ])
      if (state === 'stream') {
        expect(report.partial).toBe(true)
        expect(report.nextHistory).toContainEqual(
          expect.objectContaining({
            role: 'assistant',
            content: 'Both completed results are kept.',
          })
        )
      } else {
        expect(report.kept.slice(2).map((m: any) => m.toolExecution)).toEqual([
          state === 'tool' ? 'interrupted' : 'not-run',
          'not-run',
        ])
        expect(report.kept.slice(2).every((m: any) => m.toolResult === undefined)).toBe(true)
      }
      const results = report.nextHistory.filter(
        (m: any) => m.role === 'tool' && m.tool_call_id.startsWith('kept-' + state)
      )
      expect(results).toHaveLength(state === 'stream' ? 2 : 4)
      expect(results.slice(2).every((m: any) => /interrupted by the user/i.test(m.content))).toBe(
        true
      )
      expect(report.executions).toBe(state === 'tool' ? 3 : 2)
      expect(report.content).toBe('Saved sample')
    }
  }
)
