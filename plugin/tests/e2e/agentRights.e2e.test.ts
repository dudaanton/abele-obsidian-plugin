/** Live settings, unattended approvals and the memory approval card on desktop and phone. */
import { describe, expect, it } from 'vitest'
import { evalLong, evalRaw, reloadApp } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const SHOTS = shotDir('abele-agent-rights')
interface Report {
  error?: string
  settingsSaved?: boolean
  scriptRefused?: boolean
  asks: boolean
  pending: boolean
  beforeMemory: number
  afterMemory: number
  visible: boolean
  overflow: number
  text: string
  shot: string
  restored: boolean
}

const probe = (desktopChecks: boolean, label: string) => `(async () => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const until = async fn => {
    for (let n = 0; n < 100; n++) { const value = fn(); if (value) return value; await wait(100) }
    throw new Error('Sample UI did not appear')
  }
  const t = window.__abeleTest
  const config = t.AbeleConfig.getInstance()
  const chats = t.ChatService.getInstance()
  const registry = t.AgentRegistry.getInstance()
  const savedAi = JSON.parse(JSON.stringify(config.ai))
  const oldTab = chats.activeTabId.value
  const rightClosed = app.workspace.rightSplit?.collapsed
  const leftClosed = app.workspace.leftSplit?.collapsed
  const hadSidebar = app.workspace.getLeavesOfType('abele-ai-sidebar-view').length > 0
  const fetchBefore = window.fetch
  const DIR = 'Sample agent rights'
  const FAKE = 'https://sample-model.invalid/v1'
  const MARK = 'Use concise sample summaries'
  const report = {asks: false, pending: false, beforeMemory: -1, afterMemory: -1, visible: false, overflow: -1, text: '', shot: '', restored: false}
  let tab = null, session = null, created = false, scriptPath = '', createdScript = false, createdScriptFolder = ''
  let phase = 'memory'
  const sse = (delta, finish) => new Response(
    'data: ' + JSON.stringify({choices: [{delta, finish_reason: null}]}) + '\\n\\n' +
    'data: ' + JSON.stringify({choices: [{delta: {}, finish_reason: finish}]}) + '\\n\\n' +
    'data: [DONE]\\n\\n', {headers: {'Content-Type': 'text/event-stream'}})
  const shoot = async name => {
    const path = ${JSON.stringify(SHOTS)} + '/' + ${JSON.stringify(label)} + '-' + name + '.png'
    await wait(600)
    if (window.__e2eHost) return await window.__e2eHost.shot(path)
    const remote = require('@electron/remote')
    const target = name === 'skills-folder'
      ? remote.BrowserWindow.getAllWindows().find(win => win.getTitle().startsWith('Settings') && win.getTitle().includes(' - ' + app.vault.getName() + ' - ')) || remote.getCurrentWindow()
      : remote.getCurrentWindow()
    const image = await target.webContents.capturePage()
    require('fs').writeFileSync(path, image.toPNG())
    return path
  }
  try {
    if (app.vault.getAbstractFileByPath(DIR)) throw new Error('Sample fixture folder already exists')
    await app.vault.createFolder(DIR); created = true
    config.ai.enabled = true
    config.ai.providers = [{id: 'sample-provider', name: 'Sample provider', baseUrl: FAKE, apiKeyId: '', models: [{id: 'sample-model', name: 'Sample model', contextWindow: 32000, maxTokens: 100, supportsReasoning: false}]}]
    config.ai.chatFolder = DIR + '/Chats/{{name}}'
    config.ai.commentAgentId = ''
    window.fetch = (url, options) => {
      if (!String(url).startsWith(FAKE)) return fetchBefore(url, options)
      const body = JSON.parse(options.body)
      const result = body.messages.findLast(message => message.role === 'tool')
      if (!body.tools?.length || result) return Promise.resolve(sse({content: result?.content || 'Sample answer'}, 'stop'))
      const name = phase === 'memory' ? 'remember' : 'eval_js'
      const args = phase === 'memory' ? {text: MARK} : {code: '2 + 2'}
      return Promise.resolve(sse({tool_calls: [{index: 0, id: 'sample-' + phase, type: 'function', function: {name, arguments: JSON.stringify(args)}}]}, 'tool_calls'))
    }
    if (${desktopChecks}) {
      app.setting.open(); app.setting.openTabById('abele')
      const settingsDoc = app.setting.activeTab.containerEl.ownerDocument
      await until(() => settingsDoc.querySelector('.abele-settings__nav .abele-tabs__tab'))
      ;[...settingsDoc.querySelectorAll('.abele-settings__nav .abele-tabs__tab')].find(el => el.textContent.includes('AI Agent')).click()
      await until(() => settingsDoc.querySelector('.abele-ai-settings__tabs .abele-tabs__tab'))
      ;[...settingsDoc.querySelectorAll('.abele-ai-settings__tabs .abele-tabs__tab')].find(el => el.textContent.trim() === 'General').click()
      const row = await until(() => [...settingsDoc.querySelectorAll('.setting-item')].find(el => el.querySelector('.setting-item-name')?.textContent === 'Skills folder'))
      const input = row.querySelector('input')
      input.value = DIR + '/Skills'; input.dispatchEvent(new Event('input', {bubbles: true}))
      await until(() => config.ai.skillsFolder === DIR + '/Skills')
      report.settingsSaved = true
      row.scrollIntoView({block: 'center'})
      await shoot('skills-folder')
      app.setting.close(); await wait(300)
    }
    const worker = registry.create({name: 'Sample memory worker', providerId: 'sample-provider', modelId: 'sample-model'})
    const beforeTabs = new Set(chats.tabOrder.value)
    const newTab = chats.createTab()
    if (beforeTabs.has(newTab)) throw new Error('No free chat tab')
    tab = newTab; session = chats.activeSession.value
    if (session.id !== tab) throw new Error('No sample chat session')
    session.agentId.value = worker.id
    await chats.revealSidebar({focus: false})
    report.asks = session.needsApproval('remember', {text: MARK})
    await session.sendMessage('Remember this sample preference')
    report.pending = session.pendingToolCalls.value[0]?.name === 'remember'
    report.beforeMemory = (worker.memory || []).length
    const card = await until(() => document.querySelector('.abele-tool-approval'))
    card.scrollIntoView({block: 'center'}); await wait(400)
    const approve = [...card.querySelectorAll('button')].find(el => el.textContent.trim() === 'Approve')
    if (!approve) throw new Error('Memory approval button absent')
    const rect = approve.getBoundingClientRect()
    report.visible = rect.width > 0 && rect.top >= 0 && rect.bottom <= innerHeight
    const box = card.getBoundingClientRect()
    report.overflow = Math.max(0, -box.left, box.right - innerWidth,
      ...[...card.querySelectorAll('button')].flatMap(button => {
        const bounds = button.getBoundingClientRect()
        return [box.left - bounds.left, bounds.right - box.right, bounds.right - innerWidth]
      }))
    report.text = card.textContent
    report.shot = await shoot('memory-approval')
    if (window.__e2eHost) {
      // Capturing waits while the native keyboard and drawer can settle. Use the live
      // rectangle after capture, not the coordinates measured before that wait.
      const current = approve.getBoundingClientRect()
      const x = current.left + current.width / 2, y = current.top + current.height / 2
      report.tap = {x, y, offsetTop: visualViewport?.offsetTop, offsetLeft: visualViewport?.offsetLeft, scale: visualViewport?.scale, hit: document.elementFromPoint(x, y)?.textContent, events: []}
      const touched = event => report.tap.events.push({x: event.touches[0]?.clientX, y: event.touches[0]?.clientY, target: event.target.className})
      document.addEventListener('touchstart', touched, {once: true, capture: true})
      await window.__e2eHost.tap(x, y)
      await shoot('memory-after-tap')
      document.removeEventListener('touchstart', touched, true)
    } else approve.click()
    await until(() => (worker.memory || []).length === 1 && !session.isExecutingTool.value && !session.isStreaming.value)
    report.afterMemory = worker.memory.length
    if (${desktopChecks}) {
      phase = 'script'
      const target = registry.create({name: 'Sample unattended worker', providerId: 'sample-provider', modelId: 'sample-model', toolModes: {eval_js: 'ask'}})
      const folder = config.ai.scriptsFolder || DIR + '/Scripts'
      config.ai.scriptsEnabled = true; config.ai.scriptsFolder = folder
      if (!app.vault.getAbstractFileByPath(folder)) {
        await app.vault.createFolder(folder); createdScriptFolder = folder
      }
      scriptPath = folder + '/sample-ask-check.js'
      if (app.vault.getAbstractFileByPath(scriptPath)) throw new Error('Sample script already exists')
      const code = '// @name Sample unattended check\\nreturn await agent("Sample calculation", {agent: ' + JSON.stringify(target.id) + '});'
      await t.ScriptTrust.getInstance().noteLocalWrite(scriptPath, code)
      await app.vault.create(scriptPath, code); createdScript = true
      await t.ScriptService.getInstance().discover()
      const answer = await t.ScriptService.getInstance().execute(scriptPath, {})
      report.scriptRefused = /eval_js.*approval/.test(answer)
    }
  } catch (error) { report.error = String(error.message || error) }
  finally {
    app.setting.close()
    window.fetch = fetchBefore
    if (session) { session.abort(); await chats.closeTab(tab) }
    if (createdScript && app.vault.getAbstractFileByPath(scriptPath)) await app.vault.delete(app.vault.getAbstractFileByPath(scriptPath), true)
    if (createdScriptFolder && !createdScriptFolder.startsWith(DIR + '/') && app.vault.getAbstractFileByPath(createdScriptFolder)) await app.vault.delete(app.vault.getAbstractFileByPath(createdScriptFolder), true)
    config.ai = savedAi; registry.notifyConfigReloaded()
    await config.saveSettings()
    if (created && app.vault.getAbstractFileByPath(DIR)) await app.vault.delete(app.vault.getAbstractFileByPath(DIR), true)
    await t.ScriptService.getInstance().discover()
    if (oldTab) chats.switchTab(oldTab)
    if (!hadSidebar) for (const leaf of app.workspace.getLeavesOfType('abele-ai-sidebar-view')) leaf.detach()
    if (rightClosed) app.workspace.rightSplit?.collapse(); else app.workspace.rightSplit?.expand()
    if (leftClosed) app.workspace.leftSplit?.collapse(); else app.workspace.leftSplit?.expand()
    report.restored = !app.vault.getAbstractFileByPath(DIR) && JSON.stringify(config.ai) === JSON.stringify(savedAi)
  }
  return JSON.stringify(report)
})()`

function assertMemory(report: Report) {
  expect(report.error).toBeUndefined()
  expect(report.asks).toBe(true)
  expect(report.pending).toBe(true)
  expect(report.beforeMemory).toBe(0)
  expect(report.text).toContain('Use concise sample summaries')
  expect(report.visible).toBe(true)
  expect(report.overflow).toBeLessThanOrEqual(1)
  expect(report.afterMemory).toBe(1)
  expect(report.shot).toMatch(/memory-approval\.png$/)
  expect(report.restored).toBe(true)
}

describe('agent rights in the running app', () => {
  it('shows memory before saving and respects unattended Ask', async () => {
    const report = JSON.parse(
      await evalLong(probe(!onPhone(), onPhone() ? 'phone' : 'desktop'), 120_000)
    ) as Report
    console.info(report)
    assertMemory(report)
    if (!onPhone()) {
      expect(report.settingsSaved).toBe(true)
      expect(report.scriptRefused).toBe(true)
    }
  }, 180_000)
  it.skipIf(onPhone())(
    'keeps the approval readable in an emulated phone viewport',
    async () => {
      await reloadApp('app.emulateMobile(true)')
      try {
        evalRaw("require('@electron/remote').getCurrentWindow().setContentSize(390, 844)")
        const report = JSON.parse(await evalLong(probe(false, 'emulated'), 120_000)) as Report
        console.info(report)
        assertMemory(report)
      } finally {
        await reloadApp('app.emulateMobile(false)')
      }
    },
    240_000
  )
})
