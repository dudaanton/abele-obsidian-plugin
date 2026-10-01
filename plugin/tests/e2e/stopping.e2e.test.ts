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

targets('desktop', 'phone')
const shots = shotDir('abele-stopping')
const available = isObsidianRunning() && hasTestApi()

function probe(mode: string) {
  return String.raw`(async () => {
    const T = window.__abeleTest
    const scripts = T.ScriptService.getInstance()
    const runs = T.ScriptRuns.getInstance()
    const chats = T.ChatService.getInstance()
    const cfg = T.AbeleConfig.getInstance().ai
    const oldFolder = cfg.scriptsFolder
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
    const report = { error: '', rejected: [], content: '', status: '', visible: false, histories: [], writes: 0, shot: '' }
    let leaf, session, release, scriptRun
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
      if (app.vault.getAbstractFileByPath(root)) throw new Error('Fixture folder is occupied')
      await app.vault.createFolder(root); madeDirs.push(root)
      const note = await put(notePath, 'original')
      cfg.scriptsFolder = root
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
      await scripts.discover()
      scripts.confirm(scripts.get(scriptPath))
      const finished = { value: false }
      const gate = new Promise((r) => { release = r })
      const running = scripts.execute(scriptPath, { gate, note: notePath, rejected: report.rejected, finished }, { source: 'command' }).catch((e) => String(e))
      await until(() => runs.runs.value.some((r) => r.path === scriptPath))
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
    } catch (e) { report.error = String(e && e.stack || e) }
    finally {
      window.fetch = realFetch
      release?.()
      if (scriptRun) { runs.stop(scriptRun.id); runs.forget(scriptRun.id) }
      if (session) { session.abort(); await chats.deleteChat(session.id) }
      leaf?.detach()
      T.AbeleConfig.getInstance().ai.scriptsFolder = oldFolder
      await T.AbeleConfig.getInstance().saveSettings()
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
