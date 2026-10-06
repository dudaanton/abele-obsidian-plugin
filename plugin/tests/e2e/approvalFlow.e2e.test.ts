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

// Model responses and credential transport are controlled; the real chat, registered Fetch
// tool, protected synthetic slot and settings adapter still run. No credential-bearing traffic
// leaves the app. Permission metadata is read back from the actual plugin settings file.
export const approvalScript = (screen: string) => `(async () => {
  const api = window.__abeleTest
  const chats = api.ChatService.getInstance()
  const config = api.AbeleConfig.getInstance()
  const previous = JSON.parse(JSON.stringify(config.exportSettings()))
  const plugin = api.plugin
  const loadData = plugin.loadData, saveData = plugin.saveData
  const store = api.secrets(), keyId = 'sample-approval-key', value = 'fake-sample-approval-value'
  const expectedHeader = 'Basic ' + btoa('sample-user:' + value)
  let ownedKey = false, releaseSave
  const oldTab = chats.activeTabId.value
  const rightCollapsed = app.workspace.rightSplit.collapsed
  const local = app.loadLocalStorage('abele-key-destinations-v1')
  const realFetch = window.fetch
  const root = 'ApprovalSample'
  if (app.vault.getAbstractFileByPath(root)) throw Error('sample folder already exists')
  let session, observer, frame = 0
  let plan = [], requested = false, stage = ''
  const report = { listed: [], executed: [], cards: [], frames: [], persisted: [], shots: [], chatViews: 0, transportCalls: 0, correctHeader: false, redacted: false, readback: false, noPlaintext: false, mcpChangedPending: false, mcpSeparatelyAllowed: false, skippedWrite: false, unreadablePending: false, error: '' }
  const fake = 'https://sample-provider.invalid/v1'
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const until = async fn => {
    const deadline = Date.now() + 5000
    while (!fn()) { if (Date.now() > deadline) throw Error('sample transition timed out'); await wait(20) }
  }
  const toolCall = (id, name, args) => ({ id, name, args })
  const keyArgs = { url: 'https://api.sample.example/data', basicAuth: { username: 'sample-user', password: '\${abele_key:sample}' } }
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
    if (store.get(keyId)) throw Error('sample key slot already exists')
    config.ai = { ...config.ai, secrets: [{ name: 'sample', keyId }], providers: [], imageProviders: [], mcpServers: [], braveSearchApiKey: '', voice: { ...config.ai.voice, apiKeyId: keyId, endpoint: 'https://api.sample.example/data' } }
    config.fireflyBaseUrl = ''; config.calendars = { ...config.calendars, feeds: [] }
    store.set(keyId, value); ownedKey = true; await store.flush()
    await config.saveSettings()
    app.saveLocalStorage('abele-key-destinations-v1', {})
    api.networkSecurity.setRequestTransport(async request => {
      if (new URL(request.url).origin !== 'https://api.sample.example') throw Error('unexpected synthetic recipient')
      report.transportCalls++; report.correctHeader = request.headers.Authorization === expectedHeader
      return { status: 200, headers: { 'content-type': 'text/plain' }, text: request.headers.Authorization, arrayBuffer: new ArrayBuffer(0) }
    })
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
    const registered = session.getTools()
    const ls = registered.find(t => t.name === 'ls'), fetch = registered.find(t => t.name === 'fetch')
    if (!ls || !fetch) throw Error('registered scoped tools missing')
    const synthetic = name => ({ name, permissionKey: name === 'mcp_sample_read' ? 'mcp:' + JSON.stringify(['sample-mcp', 'read']) : undefined, destinationKey: name === 'mcp_sample_read' ? JSON.stringify(['http', 'https://mcp.sample.example/rpc']) : undefined, label: name, description: 'Synthetic sample; no transport or credential access', parameters: {}, execute: async (id) => {
      report.executed.push(id); await wait(100); return { content: [{ type: 'text', text: 'done' }] }
    } })
    session.getTools = () => [ls, synthetic('eval_js'), synthetic('mcp_sample_read'), { ...fetch, execute: async (...args) => { report.executed.push(args[0]); return fetch.execute(...args) } }]
    await chats.revealSidebar()
    await wait(200)
    // A workspace can show the same active chat in a tab and sidebar simultaneously.
    // Keep every mount in the trace and require exactly one card per view, not deduplication.
    report.chatViews = document.querySelectorAll('.abele-ai-chat').length
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
    const disk = await plugin.loadData()
    report.persisted = disk.ai.secrets.find(s => s.keyId === keyId)?.allowedOrigins ?? []
    report.noPlaintext = !JSON.stringify(disk).includes(value)
    report.redacted = !session.messages.value.find(m => m.toolCallId === 'key-first').toolResult.includes(expectedHeader.slice(6))
    await config.reloadSettings()
    report.readback = config.ai.secrets.find(s => s.keyId === keyId)?.allowedOrigins.includes('https://api.sample.example')
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

    config.ai.mcpServers = [{ id: 'sample-mcp', name: 'Sample', url: 'https://mcp.sample.example/rpc', enabled: true, keyId: '', headers: { Authorization: '\${abele_key:sample}' }, tools: [{ name: 'read', description: 'Synthetic MCP', inputSchema: {} }] }]
    session.toolModes.value = { ...session.toolModes.value, ['mcp:' + JSON.stringify(['sample-mcp', 'read'])]: 'auto' }
    await config.saveSettings()
    await start('mcp', [toolCall('mcp-first', 'mcp_sample_read', { query: 'sample' })])
    let entered = false
    const gate = new Promise(resolve => { releaseSave = resolve })
    plugin.saveData = async data => { if (!entered) { entered = true; await gate } return saveData.call(plugin, data) }
    click('Allow this address for these keys')
    await until(() => entered)
    config.ai.mcpServers[0].url = 'https://api.sample.example/rpc'
    releaseSave()
    await until(() => card()?.textContent.includes('Could not save key permission'))
    plugin.saveData = saveData
    report.mcpChangedPending = session.pendingToolCalls.value[0]?.id === 'mcp-first' && !report.executed.includes('mcp-first')
    report.mcpSeparatelyAllowed = !session.needsApproval('mcp_sample_read', { query: 'sample' })
    await shot('mcp-changed')
    await session.rejectToolCall()

    await start('unreadable', [toolCall('unreadable-first', 'fetch', { ...keyArgs, url: 'https://unreadable.sample.example/data' })])
    const currentAi = config.ai, beforeNoWrite = JSON.stringify(await loadData.call(plugin))
    plugin.loadData = async () => undefined
    await config.loadSettings(); config.ai = currentAi
    await config.saveSettings()
    report.skippedWrite = config.settingsUnreadable && beforeNoWrite === JSON.stringify(await loadData.call(plugin))
    click('Allow this address for these keys')
    await until(() => card()?.textContent.includes('Could not save key permission'))
    report.unreadablePending = session.pendingToolCalls.value[0]?.id === 'unreadable-first' && !report.executed.includes('unreadable-first') && beforeNoWrite === JSON.stringify(await loadData.call(plugin))
    await shot('unreadable')
    plugin.loadData = loadData
    await config.reloadSettings()
    await session.rejectToolCall()
    await wait(100)
  } catch (error) { report.error = String(error.message ?? error) }
  finally {
    releaseSave?.(); plugin.saveData = saveData; plugin.loadData = loadData
    observer?.disconnect(); cancelAnimationFrame(frame); window.fetch = realFetch
    api.networkSecurity.setRequestTransport(undefined)
    if (session) { session.abort(); await chats.deleteChat(session.id) }
    await config.loadSettings()
    if (ownedKey) { store.remove(keyId); await store.flush() }
    if (oldTab) chats.activeTabId.value = oldTab
    const folder = app.vault.getAbstractFileByPath(root)
    if (folder) await app.vault.delete(folder, true)
    config.applySettings(previous); await config.saveSettings(); await config.reloadSettings()
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
        expect(report.correctHeader).toBe(true)
        expect(report.transportCalls).toBe(1)
        expect(report.redacted).toBe(true)
        expect(report.readback).toBe(true)
        expect(report.noPlaintext).toBe(true)
        expect(report.mcpChangedPending).toBe(true)
        expect(report.mcpSeparatelyAllowed).toBe(true)
        expect(report.skippedWrite).toBe(true)
        expect(report.unreadablePending).toBe(true)
        expect(report.chatViews).toBeGreaterThan(0)
        expect(report.cards).toEqual(
          [
            'key:key-first',
            'batch:batch-first',
            'batch:uncovered',
            'mcp:mcp-first',
            'unreadable:unreadable-first',
          ].flatMap((state) => Array(report.chatViews).fill(state))
        )
        expect(report.frames.length).toBeGreaterThan(0)
        expect([...new Set(report.frames)]).toEqual([
          'key:key-first',
          'batch:batch-first',
          'batch:uncovered',
          'mcp:mcp-first',
          'unreadable:unreadable-first',
        ])
        expect(report.shots).toHaveLength(7)
        expect(report.shots.some((path: string) => path.startsWith('no picture:'))).toBe(false)
      } finally {
        if (screen === 'mobile') await restoreDesktopWindow()
      }
    },
    90_000
  )
})
