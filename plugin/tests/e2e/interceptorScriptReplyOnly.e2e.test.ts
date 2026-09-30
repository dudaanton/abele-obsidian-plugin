import { beforeAll, describe, expect, it } from 'vitest'
import { evalRaw, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'

interface Report {
  error: string
  mainBeforeScripts: boolean
  noDraftActions: boolean
  inputs: { text: string; earlier: number }[]
  replies: string[][]
  savedReplies: string[][]
  renderedReplies: boolean
  silentHidden: boolean
  ignoredRewrite: string
}

const probe = String.raw`(async () => {
  const T = window.__abeleTest
  const chats = T.ChatService.getInstance()
  const scripts = T.ScriptService.getInstance()
  const cfg = T.AbeleConfig.getInstance().ai
  const oldFolder = cfg.scriptsFolder
  const oldTab = chats.activeTabId.value
  const wasRightCollapsed = app.workspace.rightSplit.collapsed
  const realFetch = window.fetch
  const FAKE = 'http://sample-script-reply.invalid/v1'
  const folder = cfg.scriptsFolder || 'Scripts'
  const scriptPath = folder + '/sample-side-review.js'
  const chatPath = 'AI/Chats/sample-script-reply.abchat'
  const name = 'Sample side reviewer'
  const madeDirs = []
  const pending = new Map()
  const inputs = []
  globalThis.__sampleScriptReviews = { pending, inputs }
  let session
  const report = { error: '', mainBeforeScripts: false, noDraftActions: false, inputs, replies: [], savedReplies: [], renderedReplies: false, silentHidden: false, ignoredRewrite: '' }
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const until = async fn => {
    const end = Date.now() + 8000
    while (!fn() && Date.now() < end) await wait(50)
    if (!fn()) throw new Error('probe did not reach its expected state')
  }
  const send = async text => {
    let done = false
    const sending = session.sendMessage(text).then(() => { done = true })
    await until(() => done)
    await sending
  }
  window.fetch = async (url, init) => {
    if (typeof url !== 'string' || !url.startsWith(FAKE)) return realFetch(url, init)
    const chunks = [
      { choices: [{ delta: { content: 'Sample main answer' }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ]
    return new Response(chunks.map(c => 'data: ' + JSON.stringify(c) + '\n\n').join('') + 'data: [DONE]\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }
  try {
    cfg.scriptsFolder = folder
    for (const dir of ['AI', 'AI/Chats', folder]) {
      if (!app.vault.getAbstractFileByPath(dir)) { await app.vault.createFolder(dir); madeDirs.unshift(dir) }
    }
    await app.vault.create(scriptPath, [
      '// @name ' + name,
      '// @interceptor 30',
      'globalThis.__sampleScriptReviews.inputs.push({ text: message.text, earlier: chat.messages.length })',
      'return await new Promise(resolve => globalThis.__sampleScriptReviews.pending.set(message.text, resolve))',
    ].join('\n'))
    await scripts.discover()
    const indexed = scripts.get(scriptPath)
    if (!indexed) throw new Error('sample script was not indexed')
    scripts.confirm(indexed)
    const file = await app.vault.create(chatPath, JSON.stringify({ v: 2, k: 'meta', type: 'abele-chat', title: 'Sample script reply' }) + '\n')
    await chats.openChatFile(file)
    await chats.revealSidebar()
    session = chats.getSessionByFile(chatPath)
    if (!session) throw new Error('sample chat did not open')
    session.resolveModel = () => ({ id: 'sample', name: 'Sample', baseUrl: FAKE, apiKey: '', contextWindow: 100000, maxTokens: 512, supportsReasoning: false })
    for (const k of ['generateTitle', 'generateSummary', 'generateRecap', 'autoCompactIfNeeded']) session.summarizer[k] = async () => undefined
    session.interceptor.script.value = name
    session.interceptor.replyOnly.value = true
    session.interceptor.pattern.value = '^/review'
    await send('Plain question')
    await send('/review first')
    await send('/review second')
    await until(() => pending.size === 2)
    report.mainBeforeScripts = !session.isBusy && session.messages.value.filter(m => m.role === 'assistant').length === 3
    report.noDraftActions = !session.getDraftMessage() && !document.querySelector('.abele-ai-chat .abele-chat-msg__draft-actions, .abele-ai-chat .abele-chat-msg__interceptor-input')
    const notes = text => session.messages.value.find(m => m.content === text)?.interceptorChat || []
    pending.get('/review second')({ reply: 'Second side answer' })
    await until(() => notes('/review second').length === 1)
    pending.get('/review first')({ reply: 'First side answer' })
    await until(() => notes('/review first').length === 1)
    await until(() => [...document.querySelectorAll('.abele-chat-msg__interceptor-messages')].some(el => el.textContent.includes('First side answer')))
    report.renderedReplies = ['First side answer', 'Second side answer'].every(text => [...document.querySelectorAll('.abele-chat-msg__interceptor-messages')].some(el => el.textContent.includes(text)))
    report.replies = session.messages.value.filter(m => m.role === 'user').map(m => (m.interceptorChat || []).map(r => r.content))
    await session.save()
    const stored = await T.ChatStorage.getInstance().loadChat(file)
    report.savedReplies = stored.messages.filter(m => m.role === 'user').map(m => (m.interceptorChat || []).map(r => r.content))
    await send('/review silent')
    await until(() => pending.has('/review silent'))
    pending.get('/review silent')()
    const silent = session.messages.value.find(m => m.content === '/review silent')
    await until(() => session.interceptor.replyReviews.value[silent.id]?.streaming === false)
    await wait(100)
    const silentEl = [...document.querySelectorAll('.abele-chat-msg')].find(el => el.textContent.includes('/review silent'))
    report.silentHidden = !!silentEl && !silentEl.querySelector('.abele-chat-msg__interceptor') && !notes('/review silent').length
    await send('/review rewrite')
    await until(() => pending.has('/review rewrite'))
    pending.get('/review rewrite')({ text: 'Replacement', approve: true })
    await until(() => notes('/review rewrite').length === 2)
    report.ignoredRewrite = notes('/review rewrite').map(m => m.content).join(' ')
  } catch (e) {
    report.error = String(e?.message || e)
  } finally {
    if (session) session.abort()
    for (const resolve of pending.values()) resolve()
    if (session) await chats.deleteChat(session.id)
    window.fetch = realFetch
    for (const path of [chatPath, scriptPath]) { const file = app.vault.getAbstractFileByPath(path); if (file) await app.vault.delete(file) }
    cfg.scriptsFolder = oldFolder
    await scripts.discover()
    if (oldTab) chats.activeTabId.value = oldTab
    if (wasRightCollapsed) app.workspace.rightSplit.collapse()
    delete globalThis.__sampleScriptReviews
    for (const dir of madeDirs) { const folder = app.vault.getAbstractFileByPath(dir); if (folder && !folder.children.length) await app.vault.delete(folder, true) }
  }
  return JSON.stringify(report)
})()`

const available = isObsidianRunning() && hasTestApi()
describe.skipIf(!available)('reply-only scripts in the running chat', () => {
  let report: Report
  beforeAll(() => {
    report = JSON.parse(evalRaw(probe, 60000)) as Report
    expect(report.error).toBe('')
  }, 90000)

  it('finishes main turns before scripts and snapshots only preceding messages', () => {
    expect(report.mainBeforeScripts).toBe(true)
    expect(report.noDraftActions).toBe(true)
    expect(report.inputs.slice(0, 2)).toEqual([
      { text: '/review first', earlier: 2 },
      { text: '/review second', earlier: 4 },
    ])
  })

  it('renders and saves side replies on their own messages, even out of order', () => {
    const replies = [[], ['First side answer'], ['Second side answer']]
    expect(report.replies).toEqual(replies)
    expect(report.savedReplies).toEqual(replies)
    expect(report.renderedReplies).toBe(true)
  })

  it('hides silent results and explains ignored control results', () => {
    expect(report.silentHidden).toBe(true)
    expect(report.ignoredRewrite).toMatch(/ignored the rewrite/)
    expect(report.ignoredRewrite).toMatch(/ignored tool-approval/)
  })
})
