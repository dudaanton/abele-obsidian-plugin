/**
 * A script as a chat's interceptor, in the running app.
 *
 * A script marked `@interceptor` is set as the chat's interceptor with a pattern. A message that
 * does not match goes to the agent untouched and the script never runs; one that matches is
 * rewritten by the script — which reads the conversation before it — and the tool call the
 * agent then makes, one the chat would otherwise ask about, runs on the script's word.
 *
 * No real model is asked: `window.fetch` answers the fake provider's address alone with a
 * scripted OpenAI-style stream, as in `queuedSend.e2e.test.ts`. The script is written into the
 * scripts folder (set for the run only when none is), indexed, and removed with the chat.
 *
 * Requires Obsidian running with the development build — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  isObsidianRunning,
  hasTestApi,
  evalRaw,
  setBackgroundThrottling,
} from './helpers/obsidianCli'

const CHAT = 'AI/Chats/Abele interceptor probe.abchat'
const SCRIPT_NAME = 'Interceptor probe'

interface Report {
  requests: { role: string; text: string }[]
  scriptRuns: number
  plainBubble: string
  probeBubble: string
  probeNote: string
  toolStatus: string
  pendingAfter: number
  error: string
}

const script = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (fn()) return true
      await wait(50)
    }
    return false
  }
  const T = window.__abeleTest
  const chats = T.ChatService.getInstance()
  const scripts = T.ScriptService.getInstance()
  const cfg = T.AbeleConfig.getInstance().ai
  const CHAT = ${JSON.stringify(CHAT)}
  const NAME = ${JSON.stringify(SCRIPT_NAME)}
  const FAKE = 'http://abele-e2e-fake-provider.invalid/v1'
  const report = { requests: [], scriptRuns: 0, plainBubble: '', probeBubble: '', probeNote: '', toolStatus: '', pendingAfter: -1, error: '' }
  const createdDirs = []
  const realFetch = window.fetch
  const oldFolder = cfg.scriptsFolder
  if (!cfg.scriptsFolder) cfg.scriptsFolder = 'Scripts'
  const folder = cfg.scriptsFolder.replace(/\\/+$/, '')
  const scriptPath = folder + '/abele-interceptor-probe.js'
  const code = [
    '// @name ' + NAME,
    '// @interceptor 10',
    'const earlier = chat.messages.length',
    'return {',
    '  text: message.text.replace(/^\\\\/probe\\\\s*/, "PROBED: ") + " (earlier: " + earlier + ")",',
    // A function, which is shown the call: ls on the vault root reaches outside a chat's scope,
    // which a list of names never approves.
    '  approve: (call) => call.name === "ls",',
    '}',
  ].join('\\n')

  const sse = (chunks) => {
    const enc = new TextEncoder()
    return new ReadableStream({
      async start(controller) {
        for (const c of chunks) {
          await wait(10)
          controller.enqueue(enc.encode('data: ' + JSON.stringify(c) + '\\n\\n'))
        }
        controller.enqueue(enc.encode('data: [DONE]\\n\\n'))
        controller.close()
      },
    })
  }
  const text = (s, finish) => ({ choices: [{ delta: { content: s }, finish_reason: finish || null }] })
  const answers = [
    [text('Plain answer.'), text('', 'stop')],
    [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_probe', type: 'function', function: { name: 'ls', arguments: '{"path":"/"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ],
    [text('Listed.'), text('', 'stop')],
  ]

  window.fetch = async (url, init) => {
    if (typeof url !== 'string' || !url.startsWith(FAKE)) return realFetch(url, init)
    const body = JSON.parse(init.body)
    const last = body.messages[body.messages.length - 1]
    const content = typeof last.content === 'string' ? last.content : (last.content || []).map((p) => p.text || '').join('')
    report.requests.push({ role: last.role, text: content })
    const chunks = answers[report.requests.length - 1] || [text('Done.'), text('', 'stop')]
    return new Response(sse(chunks), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }

  let session = null
  try {
    for (const dir of ['AI', 'AI/Chats', folder]) {
      if (!app.vault.getAbstractFileByPath(dir)) { await app.vault.createFolder(dir); createdDirs.unshift(dir) }
    }
    const staleScript = app.vault.getAbstractFileByPath(scriptPath)
    if (staleScript) await app.vault.delete(staleScript)
    await app.vault.create(scriptPath, code)
    await scripts.discover()
    if (!scripts.getAll().some((s) => s.meta.name === NAME && s.meta.interceptor))
      throw new Error('the probe script was not indexed as an interceptor')

    const stale = app.vault.getAbstractFileByPath(CHAT)
    if (stale) await app.vault.delete(stale)
    const meta = { v: 2, k: 'meta', type: 'abele-chat', title: 'Interceptor probe', providerId: '', modelId: '', created: '2026-09-29' }
    const file = await app.vault.create(CHAT, JSON.stringify(meta) + '\\n')
    await chats.openChatFile(file)
    await chats.revealSidebar()
    session = chats.getSessionByFile(CHAT)
    if (!session) throw new Error('the probe chat did not open')

    session.resolveModel = () => ({
      id: 'fake', name: 'Fake', baseUrl: FAKE, apiKey: 'none',
      contextWindow: 100000, maxTokens: 1000, supportsReasoning: false,
    })
    // ls only reads, and would never be asked about; this chat asks about it, so that running it
    // without a pause is the script's doing.
    const askAbout = session.needsApproval.bind(session)
    session.needsApproval = (name, args) => name === 'ls' || askAbout(name, args)
    for (const k of ['generateTitle', 'generateSummary', 'generateRecap', 'autoCompactIfNeeded']) {
      session.summarizer[k] = async () => undefined
    }
    session.interceptor.script.value = NAME
    session.interceptor.pattern.value = '^/probe'

    const runsOf = () => T.ScriptRuns ? T.ScriptRuns.getInstance().runs.value.filter((r) => r.name === NAME).length : -1
    const runsBefore = runsOf()

    await session.sendMessage('hello plain')
    const users = () => session.allMessages.value.filter((m) => m.role === 'user')
    report.plainBubble = users()[0]?.content ?? ''

    await session.sendMessage('/probe list it')
    await until(() => report.requests.length >= 3 && !session.isStreaming.value, 8000)
    await wait(200)
    const probe = users()[1]
    report.probeBubble = probe?.content ?? ''
    report.probeNote = (probe?.interceptorChat || []).map((m) => m.content).join('\\n')
    report.toolStatus = session.allMessages.value.find((m) => m.toolCallId === 'call_probe')?.toolStatus ?? ''
    report.pendingAfter = session.pendingToolCalls.value.length
    report.scriptRuns = runsBefore === -1 ? -1 : runsOf() - runsBefore
  } catch (e) {
    report.error = String((e && e.message) || e)
  } finally {
    window.fetch = realFetch
    try {
      if (session) {
        session.abort()
        await chats.deleteChat(session.id)
      }
      const f = app.vault.getAbstractFileByPath(CHAT)
      if (f) await app.vault.delete(f)
      const s = app.vault.getAbstractFileByPath(scriptPath)
      if (s) await app.vault.delete(s)
      await scripts.discover()
      for (const dir of createdDirs) {
        const d = app.vault.getAbstractFileByPath(dir)
        if (d && d.children && !d.children.length) await app.vault.delete(d, true)
      }
      cfg.scriptsFolder = oldFolder
    } catch (e) {
      report.error = report.error || 'cleanup: ' + String((e && e.message) || e)
    }
  }
  return JSON.stringify(report)
})()`

const available = isObsidianRunning() && hasTestApi()

describe.runIf(available)('a script as the chat interceptor', () => {
  let report: Report

  beforeAll(() => {
    setBackgroundThrottling(false)
    report = JSON.parse(evalRaw(script, 60_000)) as Report
  }, 90_000)

  afterAll(() => {
    if (available) setBackgroundThrottling(true)
  })

  it('got through without an error of its own', () => {
    expect(report.error).toBe('')
  })

  it('lets a message that does not match its pattern through untouched', () => {
    expect(report.requests[0]).toEqual({ role: 'user', text: 'hello plain' })
    expect(report.plainBubble).toBe('hello plain')
  })

  it('rewrites one that matches, having read the conversation before it', () => {
    expect(report.requests[1].role).toBe('user')
    expect(report.requests[1].text).toContain('PROBED: list it (earlier: 2)')
    expect(report.probeBubble).toBe('PROBED: list it (earlier: 2)')
    expect(report.probeNote).toContain('/probe list it')
  })

  it('ran once, for the matching message only', () => {
    if (report.scriptRuns === -1) return
    expect(report.scriptRuns).toBe(1)
  })

  it('approves the tool call the agent then makes, without asking', () => {
    expect(report.requests[2].role).toBe('tool')
    expect(report.pendingAfter).toBe(0)
    expect(report.toolStatus).toBe('approved')
  })
})
