import { beforeAll, describe, expect, it } from 'vitest'
import { evalRaw, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'

interface Report {
  mainFinishedBeforeReviews: boolean
  reviewsAliveAfterMain: boolean
  noDraftActions: boolean
  replies: string[][]
  savedReplies: string[][]
  errors: string
}

const script = String.raw`(async () => {
  const T = window.__abeleTest
  const chats = T.ChatService.getInstance()
  const registry = T.AgentRegistry.getInstance()
  const cfg = T.AbeleConfig.getInstance().ai
  const before = { defaultAgentId: cfg.defaultAgentId, providers: cfg.providers }
  const activeBefore = chats.activeTabId.value
  const fetchBefore = window.fetch
  const FAKE = 'http://sample-reply-provider.invalid/v1'
  const path = 'AI/Chats/sample-reply-probe.abchat'
  const madeDirs = []
  const pending = new Map()
  let session, writer, reviewer
  const report = { mainFinishedBeforeReviews: false, reviewsAliveAfterMain: false, noDraftActions: false, replies: [], savedReplies: [], errors: '' }
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const until = async fn => {
    const end = Date.now() + 8000
    while (!fn() && Date.now() < end) await wait(50)
    if (!fn()) throw new Error('probe did not reach its expected state')
  }
  const respond = (controller, text) => {
    const enc = new TextEncoder()
    const chunk = { choices: [{ delta: { content: text }, finish_reason: null }] }
    controller.enqueue(enc.encode('data: ' + JSON.stringify(chunk) + '\n\n'))
    controller.enqueue(enc.encode('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n'))
    controller.close()
  }
  window.fetch = async (url, init) => {
    if (typeof url !== 'string' || !url.startsWith(FAKE)) return fetchBefore(url, init)
    const body = JSON.parse(init.body)
    const review = body.messages.some(m => m.role === 'system' && String(m.content).includes('Sample review prompt'))
    const last = body.messages.at(-1)
    const text = typeof last.content === 'string' ? last.content : last.content.map(p => p.text || '').join('')
    const stream = new ReadableStream({ start(controller) {
      if (review) pending.set(text, { signal: init.signal, reply: () => respond(controller, 'Review: ' + text) })
      else respond(controller, 'Sample main answer')
    } })
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }
  try {
    for (const dir of ['AI', 'AI/Chats']) if (!app.vault.getAbstractFileByPath(dir)) { await app.vault.createFolder(dir); madeDirs.unshift(dir) }
    cfg.providers = [...before.providers, { id: 'sample-reply-provider', name: 'Sample', baseUrl: FAKE, apiKeyId: '', models: [{ id: 'sample', name: 'Sample', contextWindow: 100000, maxTokens: 512, supportsReasoning: false }] }]
    reviewer = registry.create({ name: 'Sample reviewer', utility: true, providerId: 'sample-reply-provider', modelId: 'sample', prompts: [{ type: 'text', value: 'Sample review prompt' }] })
    writer = registry.create({ name: 'Sample writer', providerId: 'sample-reply-provider', modelId: 'sample', interceptorAgentId: reviewer.id, interceptorReplyOnly: true })
    const file = await app.vault.create(path, JSON.stringify({ v: 2, k: 'meta', type: 'abele-chat', agentId: writer.id, title: 'Sample reply probe' }) + '\n')
    await chats.openChatFile(file)
    await chats.revealSidebar()
    session = chats.getSessionByFile(path)
    if (!session) throw new Error('no sample session')
    for (const k of ['generateTitle', 'generateSummary', 'generateRecap', 'autoCompactIfNeeded']) session.summarizer[k] = async () => undefined
    // Send resolves before either review; a broken hold path must not hang the entire probe.
    await Promise.race([session.sendMessage('Sample first question'), wait(8000).then(() => { throw new Error('main turn waited on review') })])
    await Promise.race([session.sendMessage('Sample second question'), wait(8000).then(() => { throw new Error('second turn waited on review') })])
    await until(() => pending.size === 2)
    report.mainFinishedBeforeReviews = !session.isBusy && session.messages.value.filter(m => m.role === 'assistant').length === 2
    report.reviewsAliveAfterMain = [...pending.values()].every(p => !p.signal.aborted)
    await wait(100)
    report.noDraftActions = !session.getDraftMessage() && !document.querySelector('.abele-ai-chat .abele-chat-msg__draft-actions, .abele-ai-chat .abele-chat-msg__interceptor-input')
    pending.get('Sample second question').reply()
    await until(() => session.messages.value.find(m => m.content === 'Sample second question')?.interceptorChat?.length === 1)
    pending.get('Sample first question').reply()
    await until(() => session.messages.value.find(m => m.content === 'Sample first question')?.interceptorChat?.length === 1)
    report.replies = session.messages.value.filter(m => m.role === 'user').map(m => (m.interceptorChat || []).map(r => r.content))
    await session.save()
    const stored = await T.ChatStorage.getInstance().loadChat(app.vault.getAbstractFileByPath(path))
    report.savedReplies = stored.messages.filter(m => m.role === 'user').map(m => (m.interceptorChat || []).map(r => r.content))
  } catch (e) {
    report.errors = String(e?.message || e)
  } finally {
    // Close pending fake streams before restoring the provider so no request is left running.
    for (const p of pending.values()) { try { p.reply() } catch {} }
    if (session) { session.abort(); await chats.deleteChat(session.id) }
    window.fetch = fetchBefore
    if (writer) registry.remove(writer.id)
    if (reviewer) registry.remove(reviewer.id)
    cfg.providers = before.providers
    cfg.defaultAgentId = before.defaultAgentId
    if (activeBefore) chats.activeTabId.value = activeBefore
    const file = app.vault.getAbstractFileByPath(path)
    if (file) await app.vault.delete(file)
    for (const dir of madeDirs) { const folder = app.vault.getAbstractFileByPath(dir); if (folder && !folder.children.length) await app.vault.delete(folder, true) }
  }
  return JSON.stringify(report)
})()`

const available = isObsidianRunning() && hasTestApi()
describe.skipIf(!available)('reply-only review in the running chat', () => {
  let report: Report
  beforeAll(async () => {
    const result = evalRaw(script, 40000)
    expect(result.startsWith('Error:'), result).toBe(false)
    report = JSON.parse(result) as Report
  }, 90000)

  it('sends both main turns without waiting for or cancelling the reviews', () => {
    expect(report.errors).toBe('')
    expect(report.mainFinishedBeforeReviews).toBe(true)
    expect(report.reviewsAliveAfterMain).toBe(true)
    expect(report.noDraftActions).toBe(true)
  })

  it('keeps replies on their own messages and saves them', () => {
    const replies = [['Review: Sample first question'], ['Review: Sample second question']]
    expect(report.errors).toBe('')
    expect(report.replies).toEqual(replies)
    expect(report.savedReplies).toEqual(replies)
  })
})
