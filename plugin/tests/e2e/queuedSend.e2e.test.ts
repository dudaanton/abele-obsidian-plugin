/**
 * A message typed while the agent is answering goes out when the answer ends, in the running app.
 *
 * The agent asks to run a tool, the person refuses it, and while the agent answers the refusal
 * the person types into the chat's own input and sends. The answer ends with nothing to call —
 * the agent has said its piece. The message has to go out then, on its own turn; it used to
 * sit above the input until something else was typed by hand.
 *
 * No real model is asked. The chat's model points at an address nothing answers, and
 * `window.fetch` answers that address alone with a scripted stream, in the shape an
 * OpenAI-compatible provider sends — so everything past the network, the request built from
 * the history included, is the bundle's own. Title, summary and compaction are switched off on
 * this one chat, since they would ask the real utility model. The chat is deleted afterwards.
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

const CHAT = 'AI/Chats/Abele queued send probe.abchat'
const QUEUED = 'and one more thing, please'

interface Report {
  /** What each request to the model ended with: the role of its last message, and its text. */
  requests: { role: string; text: string }[]
  /** What the input's queue held while the agent was still answering. */
  queuedWhileAnswering: string[]
  /** What it held once the chat had gone quiet. */
  queuedAfter: string[]
  /** The person's messages in the conversation, in order. */
  bubbles: string[]
  streamingAfter: boolean
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
  const chats = window.__abeleTest.ChatService.getInstance()
  const CHAT = ${JSON.stringify(CHAT)}
  const FAKE = 'http://abele-e2e-fake-provider.invalid/v1'
  const report = { requests: [], queuedWhileAnswering: [], queuedAfter: [], bubbles: [], streamingAfter: true, error: '' }
  const createdDirs = []
  const realFetch = window.fetch

  const sse = (chunks, gap) => {
    const enc = new TextEncoder()
    return new ReadableStream({
      async start(controller) {
        for (const c of chunks) {
          await wait(gap)
          controller.enqueue(enc.encode('data: ' + JSON.stringify(c) + '\\n\\n'))
        }
        controller.enqueue(enc.encode('data: [DONE]\\n\\n'))
        controller.close()
      },
    })
  }
  const text = (s, finish) => ({ choices: [{ delta: { content: s }, finish_reason: finish || null }] })
  const answers = [
    // First: a call to a tool the chat is told to ask about.
    [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_probe', type: 'function', function: { name: 'ls', arguments: '{"path":"/"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ],
    // Second, after the refusal: an answer slow enough to type into, with nothing to call.
    [text('Understood, '), text('I will '), text('leave it '), text('there.'), text('', 'stop')],
  ]

  window.fetch = async (url, init) => {
    if (typeof url !== 'string' || !url.startsWith(FAKE)) return realFetch(url, init)
    const body = JSON.parse(init.body)
    const last = body.messages[body.messages.length - 1]
    const content = typeof last.content === 'string' ? last.content : (last.content || []).map((p) => p.text || '').join('')
    report.requests.push({ role: last.role, text: content })
    const chunks = answers[report.requests.length - 1] || [text('Got it.'), text('', 'stop')]
    return new Response(sse(chunks, report.requests.length === 2 ? 400 : 20), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }

  let session = null
  try {
    for (const dir of ['AI', 'AI/Chats']) {
      if (!app.vault.getAbstractFileByPath(dir)) { await app.vault.createFolder(dir); createdDirs.unshift(dir) }
    }
    const stale = app.vault.getAbstractFileByPath(CHAT)
    if (stale) await app.vault.delete(stale)
    const meta = { v: 2, k: 'meta', type: 'abele-chat', title: 'Queued send probe', providerId: '', modelId: '', created: '2026-09-25' }
    const file = await app.vault.create(CHAT, JSON.stringify(meta) + '\\n')
    await chats.openChatFile(file)
    await chats.revealSidebar()
    session = chats.getSessionByFile(CHAT)
    if (!session) throw new Error('the probe chat did not open')

    session.resolveModel = () => ({
      id: 'fake', name: 'Fake', baseUrl: FAKE, apiKey: 'none',
      contextWindow: 100000, maxTokens: 1000, supportsReasoning: false,
    })
    const askAbout = session.needsApproval.bind(session)
    session.needsApproval = (name, args) => name === 'ls' || askAbout(name, args)
    for (const k of ['generateTitle', 'generateSummary', 'generateRecap', 'autoCompactIfNeeded']) {
      session.summarizer[k] = async () => undefined
    }

    await session.sendMessage('list the root')
    if (!session.pendingToolCalls.value.length) throw new Error('the tool call was not held for approval')

    const refused = session.rejectToolCall()
    if (!(await until(() => report.requests.length === 2 && session.isStreaming.value, 5000)))
      throw new Error('the answer to the refusal never started')

    // Typed into the chat's own input and sent the way a keyboard does.
    const inputs = [...document.querySelectorAll('.abele-ai-chat .abele-chat-input__textarea')]
      .filter((el) => el.getClientRects().length)
    const input = inputs[inputs.length - 1]
    if (!input) throw new Error('no chat input on screen')
    input.focus()
    input.value = ${JSON.stringify(QUEUED)}
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))
    await wait(50)
    report.queuedWhileAnswering = session.queuedMessages.value.map((q) => q.content)

    await refused
    await until(() => report.requests.length >= 3 && !session.isStreaming.value, 8000)
    await wait(300)
    report.queuedAfter = session.queuedMessages.value.map((q) => q.content)
    report.bubbles = session.allMessages.value.filter((m) => m.role === 'user').map((m) => m.content)
    report.streamingAfter = session.isStreaming.value
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
      for (const dir of createdDirs) {
        const d = app.vault.getAbstractFileByPath(dir)
        if (d && d.children && !d.children.length) await app.vault.delete(d, true)
      }
    } catch (e) {
      report.error = report.error || 'cleanup: ' + String((e && e.message) || e)
    }
  }
  return JSON.stringify(report)
})()`

const available = isObsidianRunning() && hasTestApi()

describe.runIf(available)('a message typed while the agent answers', () => {
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

  it('waited above the input while the agent was answering', () => {
    expect(report.queuedWhileAnswering).toEqual([QUEUED])
  })

  it('went out on a turn of its own once the answer ended', () => {
    expect(report.requests.map((r) => r.role)).toEqual(['user', 'tool', 'user'])
    expect(report.requests[2].text).toContain(QUEUED)
    expect(report.queuedAfter).toEqual([])
    expect(report.bubbles).toEqual(['list the root', QUEUED])
    expect(report.streamingAfter).toBe(false)
  })
})
