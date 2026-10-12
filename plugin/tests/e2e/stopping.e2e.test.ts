/** Stop revokes a suspended script's capabilities; retry keeps completed tool work. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
  restoreDesktopWindow,
} from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import { SCRIPT_FIXTURE } from './helpers/scriptFixture'

targets('desktop', 'phone')
const shots = shotDir('abele-stopping')
const available = isObsidianRunning() && hasTestApi()

function probe(mode: string) {
  return String.raw`(async () => {
    ${SCRIPT_FIXTURE}
    const T = window.__abeleTest
    let scripts = T.ScriptService.getInstance()
    const runs = T.ScriptRuns.getInstance()
    const chats = T.ChatService.getInstance()
    const oldActive = app.workspace.activeLeaf
    const leftClosed = app.workspace.leftSplit.collapsed
    const rightClosed = app.workspace.rightSplit.collapsed
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const until = async (check) => {
      for (let n = 0; n < 100; n++) { if (check()) return; await wait(30) }
      throw new Error('The stop probe did not settle')
    }
    const madeDirs = []
    const madeFiles = []
    const report = { error: '', rejected: [], content: '', status: '', visible: false, histories: [], writes: 0, shot: '', kept: [] }
    let leaf, session, release, scriptRun, fixture
    const realFetch = window.fetch
    const root = 'Sample stop fixture'
    const notePath = root + '/sample-note.md'
    const chatPath = root + '/sample-chat.abchat'
    const scriptPath = root + '/sample-script.js'
    const put = async (path, content) => {
      if (app.vault.getAbstractFileByPath(path)) throw new Error('Fixture path is occupied: ' + path)
      const file = await app.vault.create(path, content)
      madeFiles.push(path)
      return file
    }
    try {
      fixture = await saveScriptFixture()
      if (app.vault.getAbstractFileByPath(root)) throw new Error('Fixture folder is occupied')
      await app.vault.createFolder(root); madeDirs.push(root)
      const note = await put(notePath, 'original')
      const code = [
        '// @name Sample stop fixture',
        'await params.gate',
        'for (const [name, op] of [',
        '  ["write", () => write(params.note, "late")],',
        '  ["remove", () => remove(params.note)],',
        '  ["fetch", () => fetch("https://sample.invalid/stop-probe")],',
        '  ["form", () => form([])],',
        ']) { try { await op() } catch { params.rejected.push(name) } }',
        'params.finished.value = true',
      ].join('\n')
      await put(scriptPath, code)
      await enableScriptFixture(root)
      scripts = T.ScriptService.getInstance()
      await approveScriptFixture(scriptPath, code)
      const finished = { value: false }
      const gate = new Promise((r) => { release = r })
      let executionError
      const running = scripts.execute(scriptPath, { gate, note: notePath, rejected: report.rejected, finished }, { source: 'command' }).catch((e) => { executionError = e; return String(e) })
      await until(() => { if (executionError) throw executionError; return runs.runs.value.some((r) => r.path === scriptPath) })
      scriptRun = runs.runs.value.find((r) => r.path === scriptPath)
      leaf = app.workspace.getLeaf('tab')
      await leaf.setViewState({ type: 'abele-script-runs-view', active: true })
      await app.workspace.revealLeaf(leaf)
      const row = () => [...leaf.view.containerEl.querySelectorAll('.abele-runs__run')].find((r) => r.querySelector('.abele-runs__name')?.textContent === 'Sample stop fixture')
      await until(() => row())
      row().querySelector('.abele-runs__row').click()
      await until(() => [...row().querySelectorAll('button')].some((b) => b.textContent.trim() === 'Stop'))
      ;[...row().querySelectorAll('button')].find((b) => b.textContent.trim() === 'Stop').click()
      await running
      release()
      await until(() => finished.value)
      report.status = scriptRun.status
      report.content = await app.vault.read(note)
      await until(() => row().classList.contains('abele-runs__run_stopped'))
      report.visible = row().getBoundingClientRect().width > 0
      await wait(200)
      report.shot = ${JSON.stringify(shots + '/' + mode + '.png')}
      if (window.__e2eHost) await window.__e2eHost.shot(report.shot)
      else {
        const image = await require('@electron/remote').getCurrentWindow().webContents.capturePage()
        require('fs').writeFileSync(report.shot, image.toPNG())
      }

      // Exercise the real ChatSession -> AgentLoop -> OpenAIClient history commit path.
      const file = await put(chatPath, JSON.stringify({ v: 2, k: 'meta', type: 'abele-chat', title: 'Sample stop fixture', providerId: '', modelId: '' }) + '\n')
      await chats.openChatFile(file)
      session = chats.getSessionByFile(chatPath)
      if (!session) throw new Error('The fixture chat did not open')
      const fake = 'https://sample.invalid/stop-model'
      session.resolveModel = () => ({ id: 'sample', name: 'Sample', baseUrl: fake, apiKey: '', contextWindow: 100000, maxTokens: 1000, supportsReasoning: false })
      session.needsApproval = () => false
      session.getTools = () => [{ name: 'sample_write', description: 'Write the fixture', parameters: {}, execute: async () => {
        report.writes++
        await app.vault.modify(note, 'saved ' + report.writes)
        return { content: [{ type: 'text', text: 'Saved sample-note.md' }] }
      } }]
      for (const key of ['generateTitle', 'generateSummary', 'generateRecap', 'autoCompactIfNeeded']) session.summarizer[key] = async () => undefined
      for (const failure of ['network', 'stop']) {
        let requests = 0
        const id = 'sample-call-' + failure
        window.fetch = async (url, init) => {
          if (typeof url !== 'string' || !url.startsWith(fake)) return realFetch(url, init)
          requests++
          if (requests === 2) {
            if (failure === 'stop') { session.abort(); throw new DOMException('Stopped', 'AbortError') }
            throw new TypeError('Sample network drop')
          }
          if (requests === 3) report.histories.push({ failure, messages: JSON.parse(init.body).messages })
          const delta = requests === 1 ? { tool_calls: [{ index: 0, id, function: { name: 'sample_write', arguments: '{}' } }] } : { content: 'Saved already.' }
          const chunk = { choices: [{ delta, finish_reason: requests === 1 ? 'tool_calls' : 'stop' }] }
          return new Response('data: ' + JSON.stringify(chunk) + '\n\ndata: [DONE]\n\n', { status: 200 })
        }
        await session.sendMessage('Save the sample note: ' + failure)
        session.cancelAutoRetry()
        await session.retryRequest()
      }

      // Stop a real streamed response and reopen the saved chat before continuing.
      // All requests stay on the in-page fake provider; no external model is contacted.
      for (const state of ['stream', 'tool', 'approval']) {
        const prefix = 'kept-' + state + '-'
        let requests = 0, executions = 0, nextHistory
        session.needsApproval = (_name, args) => state === 'approval' && args?.ask === true
        session.getTools = () => [{ name: 'sample_read', description: 'Read a fixture', parameters: {}, execute: async (id) => {
          executions++
          if (state === 'tool' && id === prefix + '3') {
            session.abort()
            throw new DOMException('Stopped', 'AbortError')
          }
          return { content: [{ type: 'text', text: 'Sample result ' + id }] }
        } }]
        const chunk = (delta, finish_reason) => 'data: ' + JSON.stringify({choices: [{delta, finish_reason}]}) + '\n\n'
        window.fetch = async (url, init) => {
          if (typeof url !== 'string' || !url.startsWith(fake)) return realFetch(url, init)
          requests++
          if (requests === 1) {
            const count = state === 'stream' ? 2 : 4
            const tool_calls = Array.from({length: count}, (_, i) => ({index: i, id: prefix + (i + 1), function: {name: 'sample_read', arguments: JSON.stringify({path: 'sample-note.md', ask: i >= 2})}}))
            return new Response(chunk({content: 'Sample updates are ready.'}) + chunk({tool_calls}, 'tool_calls') + 'data: [DONE]\n\n')
          }
          if (state === 'stream' && requests === 2) return new Response(new ReadableStream({start(controller) {
            controller.enqueue(new TextEncoder().encode(chunk({content: 'Both completed results are kept.'})))
            init.signal.addEventListener('abort', () => controller.error(new DOMException('Stopped', 'AbortError')), {once: true})
          }}))
          nextHistory = JSON.parse(init.body).messages
          return new Response(chunk({content: 'Continue without replay.'}, 'stop') + 'data: [DONE]\n\n')
        }
        const sending = session.sendMessage('Inspect the sample: ' + state)
        if (state === 'stream') {
          await until(() => session.streamingContent.value.includes('Both completed results'))
          session.abort()
        }
        await sending
        if (state === 'approval') session.stopFromApproval()
        await session.flush()
        const kept = session.messages.value.filter(m => m.toolCallId?.startsWith(prefix))
        const partial = session.messages.value.some(m => m.content === 'Both completed results are kept.')
        const saved = session.currentChatFile.value
        await session.load(saved)
        const reopened = session.messages.value.filter(m => m.toolCallId?.startsWith(prefix))
        await chats.revealSidebar({focus: false})
        await wait(350)
        const scroller = document.querySelector('.abele-ai-chat__messages')
        if (scroller) scroller.scrollTop = scroller.scrollHeight
        await wait(200)
        const stoppedShot = ${JSON.stringify(shots)} + '/' + ${JSON.stringify(mode)} + '-kept-' + state + '.png'
        if (window.__e2eHost) await window.__e2eHost.shot(stoppedShot)
        else {
          const image = await require('@electron/remote').getCurrentWindow().webContents.capturePage()
          require('fs').writeFileSync(stoppedShot, image.toPNG())
        }
        await session.sendMessage('Continue the sample: ' + state)
        report.kept.push({state, kept, reopened, partial, executions, nextHistory, stoppedShot})
      }
    } catch (e) { report.error = String(e && e.stack || e) }
    finally {
      try {
      window.fetch = realFetch
      release?.()
      if (scriptRun) { runs.stop(scriptRun.id); runs.forget(scriptRun.id) }
      if (session) { session.abort(); await chats.deleteChat(session.id) }
      leaf?.detach()
      for (const path of madeFiles.reverse()) {
        const file = app.vault.getAbstractFileByPath(path)
        if (file) await app.vault.delete(file)
      }
      for (const path of madeDirs.reverse()) {
        const dir = app.vault.getAbstractFileByPath(path)
        if (dir && !dir.children.length) await app.vault.delete(dir, true)
      }
      await scripts.discover()
      if (leftClosed) app.workspace.leftSplit.collapse(); else app.workspace.leftSplit.expand()
      if (rightClosed) app.workspace.rightSplit.collapse(); else app.workspace.rightSplit.expand()
      if (oldActive) app.workspace.setActiveLeaf(oldActive, { focus: true })
      } finally { await restoreScriptFixture(fixture) }
    }
    return JSON.stringify(report)
  })()`
}

describe.runIf(available).each(onPhone() ? ['phone'] : ['desktop', 'emulated'])(
  'stopping on %s',
  (mode) => {
    let report: any
    beforeAll(async () => {
      if (mode === 'emulated') {
        await reloadApp('app.emulateMobile(true)')
        evalRaw(`require('@electron/remote').getCurrentWindow().setSize(390, 844)`)
      }
      const raw = evalRaw(probe(mode), 45_000)
      if (!raw.startsWith('{')) throw new Error(raw)
      report = JSON.parse(raw)
    })
    afterAll(async () => {
      if (mode === 'emulated') await restoreDesktopWindow()
    })

    it('finishes and cleans up its fixture', () => {
      expect(report.error).toBe('')
    })
    it('stops late effects through the visible run button', () => {
      expect(report.rejected).toEqual(['write', 'remove', 'fetch', 'form'])
      expect(report.content).toBe('original')
      expect(report.status).toBe('stopped')
      expect(report.visible).toBe(true)
    })
    it.each(['stream', 'tool', 'approval'])(
      'persists the stopped %s turn without replay or missing history pairs',
      (state) => {
        const kept = report.kept.find((item: any) => item.state === state)
        expect(kept).toBeTruthy()
        expect(kept.reopened).toEqual(kept.kept)
        expect(kept.kept.slice(0, 2).map((m: any) => m.toolResult)).toEqual([
          'Sample result kept-' + state + '-1',
          'Sample result kept-' + state + '-2',
        ])
        if (state === 'stream') {
          expect(kept.partial).toBe(true)
          expect(kept.nextHistory).toContainEqual(
            expect.objectContaining({
              role: 'assistant',
              content: 'Both completed results are kept.',
            })
          )
        } else {
          expect(kept.kept.slice(2).map((m: any) => m.toolExecution)).toEqual([
            state === 'tool' ? 'interrupted' : 'not-run',
            'not-run',
          ])
          expect(kept.kept.slice(2).every((m: any) => m.toolResult === undefined)).toBe(true)
        }
        const results = kept.nextHistory.filter(
          (m: any) => m.role === 'tool' && m.tool_call_id.startsWith('kept-' + state)
        )
        expect(results).toHaveLength(state === 'stream' ? 2 : 4)
        expect(results.slice(2).every((m: any) => /interrupted by the user/i.test(m.content))).toBe(
          true
        )
        expect(kept.executions).toBe(state === 'tool' ? 3 : 2)
      }
    )
    it.each(['network', 'stop'])(
      'keeps completed tool calls/results when retrying after %s',
      (failure) => {
        const history = report.histories.find((h: any) => h.failure === failure)?.messages
        expect(history).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              role: 'assistant',
              tool_calls: [expect.objectContaining({ id: 'sample-call-' + failure })],
            }),
            expect.objectContaining({
              role: 'tool',
              tool_call_id: 'sample-call-' + failure,
              content: 'Saved sample-note.md',
            }),
          ])
        )
        expect(report.writes).toBe(2)
      }
    )
  }
)
