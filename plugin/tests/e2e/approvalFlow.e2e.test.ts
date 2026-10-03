import { describe, expect, it } from 'vitest'
import {
  evalLong,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
  restoreDesktopWindow,
} from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'
import { onPhone, targets } from './helpers/target'

targets('desktop', 'phone')
const shots = shotDir('abele-approval-flow')

// Only the fake model address is intercepted. Key-bearing calls use a synthetic tool with no
// transport or key lookup; ls is the real scoped tool from the running development bundle.
export const approvalScript = (screen: string) => `(async () => {
  const api = window.__abeleTest
  const chats = api.ChatService.getInstance()
  const config = api.AbeleConfig.getInstance()
  const previous = config.ai
  const save = config.saveSettings
  const oldTab = chats.activeTabId.value
  const rightCollapsed = app.workspace.rightSplit.collapsed
  const local = app.loadLocalStorage('abele-key-destinations-v1')
  const realFetch = window.fetch
  const root = 'ApprovalSample'
  if (app.vault.getAbstractFileByPath(root)) throw Error('sample folder already exists')
  let session, observer, frame = 0
  let plan = [], requested = false, stage = ''
  const report = { listed: [], executed: [], cards: [], frames: [], persisted: [], shots: [], error: '' }
  const fake = 'https://sample-provider.invalid/v1'
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const until = async fn => {
    const deadline = Date.now() + 5000
    while (!fn()) { if (Date.now() > deadline) throw Error('sample transition timed out'); await wait(20) }
  }
  const toolCall = (id, name, args) => ({ id, name, args })
  const keyArgs = { url: 'https://api.sample.example/data', headers: { Authorization: '\${abele_key:sample}' } }
  const sse = calls => {
    const chunks = calls.length ? [
      { choices: [{ delta: { tool_calls: calls.map((c, index) => ({ index, id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ] : [{ choices: [{ delta: { content: 'Sample complete' }, finish_reason: 'stop' }] }]
    return chunks.map(c => 'data: ' + JSON.stringify(c) + '\\n\\n').join('') + 'data: [DONE]\\n\\n'
  }
  window.fetch = async (url, init) => {
    if (typeof url !== 'string' || !url.startsWith(fake)) return realFetch(url, init)
    const calls = requested ? [] : plan
    requested = true
    return new Response(sse(calls), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }
  const shot = async name => {
    const path = ${JSON.stringify(shots)} + '/' + ${JSON.stringify(screen)} + '-' + name + '.png'
    if (window.__e2eHost) report.shots.push(await window.__e2eHost.shot(path))
    else if (typeof require === 'function') {
      const image = await require('@electron/remote').getCurrentWindow().webContents.capturePage()
      require('fs').writeFileSync(path, image.toPNG()); report.shots.push(path)
    }
  }
  const card = () => document.querySelector('.abele-tool-approval')
  const click = text => {
    const button = [...card().querySelectorAll('button')].find(b => b.textContent === text)
    if (!button) throw Error('missing sample action: ' + text)
    button.click()
  }
  const start = async (name, calls) => {
    stage = name; plan = calls; requested = false
    await session.sendMessage('Run the ' + name + ' sample')
    if (session.error.value) throw Error(session.error.value)
    await wait(100)
  }
  try {
    config.ai = { ...previous, secrets: [{ name: 'sample', keyId: 'sample-approval-key' }] }
    config.saveSettings = async () => { report.persisted = config.ai.secrets[0].allowedOrigins ?? [] }
    app.saveLocalStorage('abele-key-destinations-v1', {})
    await app.vault.createFolder(root)
    await app.vault.createFolder(root + '/Nested')
    await app.vault.create(root + '/Nested/visible.md', 'Sample visible text')
    await app.vault.create(root + '/Nested/hidden.md', 'Sample hidden text')
    await app.vault.create(root + '/hidden.md', 'Sample hidden text')
    const id = chats.createTab()
    if (id === oldTab) throw Error('no new sample tab available')
    session = chats.getSession(id)
    session.save = async () => {}
    session.resolveModel = () => ({ id: 'sample', name: 'Sample', baseUrl: fake, apiKey: '', contextWindow: 100000, maxTokens: 1000, supportsReasoning: false })
    for (const name of ['generateTitle', 'generateSummary', 'generateRecap', 'autoCompactIfNeeded']) session.summarizer[name] = async () => {}
    session.scopeResolver.clear()
    session.scopeResolver.addFile(root + '/Nested/visible.md')
    session.permissionMode.value = 'confirm-all'
    session.toolModes.value = { eval_js: 'ask', fetch: 'auto' }
    const ls = session.getTools().find(t => t.name === 'ls')
    if (!ls) throw Error('scoped ls missing')
    const synthetic = name => ({ name, label: name, description: 'Synthetic sample; no transport or credential access', parameters: {}, execute: async (id) => {
      report.executed.push(id); await wait(100); return { content: [{ type: 'text', text: 'done' }] }
    } })
    session.getTools = () => [ls, synthetic('eval_js'), synthetic('fetch')]
    await chats.revealSidebar()
    await wait(200)
    observer = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node.nodeType === 1 && (node.matches?.('.abele-tool-approval') || node.querySelector?.('.abele-tool-approval'))) report.cards.push(stage + ':' + (session.pendingToolCalls.value[0]?.id ?? 'none'))
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    const observeFrame = () => {
      if (card()) report.frames.push(stage + ':' + (session.pendingToolCalls.value[0]?.id ?? 'none'))
      frame = requestAnimationFrame(observeFrame)
    }
    frame = requestAnimationFrame(observeFrame)
    await start('listing', [toolCall('list-root', 'ls', { path: '/' }), toolCall('list-parent', 'ls', { path: root }), toolCall('list-nested', 'ls', { path: root + '/Nested' })])
    report.listed = session.messages.value.filter(m => m.toolName === 'ls').map(m => m.toolResult)
    if (session.pendingToolCalls.value.length || card()) throw Error('listing asked approval')
    await shot('listing')
    await start('key', [toolCall('key-first', 'fetch', keyArgs)])
    await until(() => !!card())
    await shot('key')
    click('Allow this address for these keys')
    await until(() => !session.isExecutingTool.value && !session.pendingToolCalls.value.length)
    if (card()) throw Error('trusted key left a second card')
    await shot('key-settled')
    await start('batch', [toolCall('batch-first', 'eval_js', { code: 'sample-first' }), toolCall('batch-second', 'eval_js', { code: 'sample-second' }), toolCall('batch-third', 'eval_js', { code: 'sample-third' }), toolCall('uncovered', 'fetch', { ...keyArgs, url: 'https://other.example/data' })])
    await until(() => !!card())
    await shot('batch')
    click('Always allow')
    await until(() => session.pendingToolCalls.value[0]?.id === 'uncovered' && !session.isExecutingTool.value)
    await wait(100)
    await shot('uncovered')
    await session.rejectToolCall()
    await wait(100)
  } catch (error) { report.error = String(error.message ?? error) }
  finally {
    observer?.disconnect(); cancelAnimationFrame(frame); window.fetch = realFetch
    if (session) { session.abort(); await chats.deleteChat(session.id) }
    if (oldTab) chats.activeTabId.value = oldTab
    const folder = app.vault.getAbstractFileByPath(root)
    if (folder) await app.vault.delete(folder, true)
    config.ai = previous; config.saveSettings = save
    app.saveLocalStorage('abele-key-destinations-v1', local)
    if (rightCollapsed) app.workspace.rightSplit.collapse()
  }
  return report
})()`

describe('approval transitions in the running chat', () => {
  it.each(onPhone() ? ['phone'] : ['desktop', 'mobile'])(
    '%s preserves scoped listing, first trust and covered batch approvals',
    async (screen) => {
      expect(isObsidianRunning() && hasTestApi()).toBe(true)
      try {
        if (screen === 'mobile') {
          await reloadApp('app.emulateMobile(true)')
          evalRaw("require('@electron/remote').getCurrentWindow().setContentSize(390, 844)")
        }
        const raw = await evalLong(approvalScript(screen), 35_000)
        if (raw.startsWith('Error:')) throw Error(raw)
        const report = JSON.parse(raw)
        console.info(JSON.stringify(report))
        expect(report.error).toBe('')
        expect(report.listed).toEqual(['ApprovalSample/', 'Nested/', 'visible.md'])
        expect(report.executed).toEqual(['key-first', 'batch-first', 'batch-second', 'batch-third'])
        expect(report.persisted).toEqual(['https://api.sample.example'])
        expect(report.cards).toEqual(['key:key-first', 'batch:batch-first', 'batch:uncovered'])
        expect(report.frames.length).toBeGreaterThan(0)
        expect([...new Set(report.frames)]).toEqual([
          'key:key-first',
          'batch:batch-first',
          'batch:uncovered',
        ])
        expect(report.shots).toHaveLength(5)
        expect(report.shots.some((path: string) => path.startsWith('no picture:'))).toBe(false)
      } finally {
        if (screen === 'mobile') await restoreDesktopWindow()
      }
    },
    90_000
  )
})
