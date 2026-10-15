/**
 * Several interceptors in a row, in the running app.
 *
 * The agent's window lists them in the order they run — numbered, one switched off in its place,
 * one opened under its row, an empty list, a long one — and a chat's setup keeps a list of its
 * own. In the chat, three scripts read the person's message one after another, each given what
 * the one before returned, and three read the agent's answer: while they read, the turning glyph
 * by its time counts which one ("2/3"); replaced by two, the answer's one mark opens a version per
 * interceptor. A message whose second interceptor fails waits at "2 of 3" with the reason, the
 * first one's change kept: Retry runs the failed one again and the rest, Send as is sends it
 * without the rest.
 *
 * No real model is asked: `window.fetch` answers the fake provider's address alone, as in
 * `interceptorAnswer.e2e.test.ts`. Pictures of each step go to the `abele-interceptor-chain`
 * shots folder. Writes six scripts, two agents and one chat, and removes them; the first agent's
 * list is put back as it was.
 *
 * Requires Obsidian running with the development build — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  evalLong,
  hasTestApi,
  isObsidianRunning,
  setBackgroundThrottling,
} from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import { columnShot } from './helpers/columnShots'
import { SCRIPT_FIXTURE } from './helpers/scriptFixture'

targets('desktop', 'phone')

const SHOTS = shotDir('abele-interceptor-chain')
const device = onPhone() ? 'phone' : 'desktop'
const shot = (name: string) => columnShot(`${SHOTS}/${device}-${name}.png`)

const CHAT = 'AI/Chats/Abele interceptor chain probe.abchat'
const FOLDER = 'Sample chain scripts'

/** The scripts: what each is called, what it reads, and its body. */
const SCRIPTS: { file: string; name: string; body: string[] }[] = [
  {
    file: 'spelling',
    name: 'Sample spelling',
    body: ["return { text: message.text.replace('lanturn', 'lantern') }"],
  },
  {
    file: 'style',
    name: 'Sample style check',
    body: [
      "if (globalThis.__abeleChainBreak) throw new Error('the style guide could not be read')",
      "return { text: message.text.replace(/^where/, 'Where') }",
    ],
  },
  {
    file: 'signature',
    name: 'Sample signature',
    body: ["return { text: message.text + ' Thanks.' }"],
  },
  {
    file: 'facts',
    name: 'Sample fact checker',
    body: [
      'while (!globalThis.__abeleChainGate1) {',
      '  if (signal.aborted) return',
      '  await new Promise((r) => setTimeout(r, 50))',
      '}',
      "return { text: message.text.replace('lantern', 'lamp') }",
    ],
  },
  {
    file: 'plain',
    name: 'Sample plain language',
    body: [
      'while (!globalThis.__abeleChainGate2) {',
      '  if (signal.aborted) return',
      '  await new Promise((r) => setTimeout(r, 50))',
      '}',
      "return { text: message.text.replace('on the shelf.', 'on the high shelf, by the window.'), note: 'Said where on the shelf.' }",
    ],
  },
  { file: 'tone', name: 'Sample tone', body: ['return'] },
]

/** Shared by every step: the probe's state lives on the window between evaluations. */
const prelude = `
  ${SCRIPT_FIXTURE}
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms, what) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      const v = fn()
      if (v) return v
      await wait(50)
    }
    throw new Error('timed out waiting for ' + what)
  }
  const T = window.__abeleTest
  const chats = T.ChatService.getInstance()
  const registry = T.AgentRegistry.getInstance()
  const P = (window.__abeleChainProbe ||= { requests: [], createdDirs: [], scripts: [], agents: [] })
  const session = () => chats.getSessionByFile(${JSON.stringify(CHAT)})
  const qa = (sel, root = document) => [...root.querySelectorAll(sel)]
  const entry = (patch) => ({ id: 'ic-' + Math.random().toString(36).slice(2, 10), agentId: '', script: '', checks: 'message', pattern: '', replyOnly: false, contextDepth: 0, enabled: true, ...patch })
  // The close button first, then Escape, then the background: a phone's sheet answers one of them.
  const closeModals = async () => {
    const open = () => qa('.modal-container')
    for (const way of ['button', 'escape', 'background', 'button']) {
      const box = open().at(-1)
      if (!box) return
      if (way === 'button') box.querySelector('.modal-close-button')?.click()
      if (way === 'escape') box.querySelector('.modal')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      if (way === 'background') box.querySelector('.modal-bg')?.click()
      for (let i = 0; i < 30 && open().includes(box); i++) await wait(100)
    }
    if (open().length) throw new Error('the dialogs did not close')
  }
  const showList = async () => {
    const list = await until(() => document.querySelector('.modal .abele-interceptors'), 5000, 'the interceptor list')
    list.scrollIntoView({ block: 'start' })
    await wait(400)
    return list
  }
  const rows = () => qa('.modal .abele-interceptors__entry').map((r) => ({
    number: r.querySelector('.abele-interceptors__number')?.textContent.trim() ?? '',
    name: r.querySelector('.abele-interceptors__name')?.textContent.trim() ?? '',
    desc: r.querySelector('.setting-item-description')?.textContent.trim() ?? '',
  }))
`

const setup = `(async () => {
  ${prelude}
  const FAKE = 'https://abele-e2e-fake-provider.invalid/v1'
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
  P.realFetch = window.fetch
  window.fetch = async (url, init) => {
    if (typeof url !== 'string' || !url.startsWith(FAKE)) return P.realFetch(url, init)
    const body = JSON.parse(init.body)
    const last = body.messages[body.messages.length - 1]
    P.requests.push(typeof last.content === 'string' ? last.content : (last.content || []).map((p) => p.text || '').join(''))
    return new Response(sse([text('The lantern is on the shelf.'), text('', 'stop')]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }

  P.fixture = await saveScriptFixture()
  for (const dir of ['AI', 'AI/Chats', ${JSON.stringify(FOLDER)}]) {
    if (!app.vault.getAbstractFileByPath(dir)) { await app.vault.createFolder(dir); P.createdDirs.unshift(dir) }
  }
  const scripts = ${JSON.stringify(SCRIPTS)}
  for (const s of scripts) {
    const path = ${JSON.stringify(FOLDER)} + '/abele-chain-' + s.file + '.js'
    const code = ['// @name ' + s.name, '// @interceptor 60', ...s.body].join('\\n')
    const stale = app.vault.getAbstractFileByPath(path)
    if (stale) await app.vault.delete(stale)
    await app.vault.create(path, code)
    P.scripts.push({ path, code })
  }
  await enableScriptFixture(${JSON.stringify(FOLDER)})
  for (const s of P.scripts) await approveScriptFixture(s.path, s.code)
  const indexed = T.ScriptService.getInstance().getAll().filter((s) => s.meta.interceptor).map((s) => s.meta.name)
  for (const s of scripts) if (!indexed.includes(s.name)) throw new Error(s.name + ' was not indexed as an interceptor')

  // Two reviewing agents, with names long enough to be a test of the row.
  P.agents.push(registry.create({ name: 'Sample reviewer who reads every message twice before it goes', utility: true }).id)
  P.agents.push(registry.create({ name: 'Sample second reviewer', utility: true }).id)
  const first = registry.list()[0]
  P.firstAgent = first.id
  P.firstWas = { interceptors: first.interceptors ? JSON.parse(JSON.stringify(first.interceptors)) : undefined, interceptorAgentId: first.interceptorAgentId, interceptorScript: first.interceptorScript, interceptorPattern: first.interceptorPattern, interceptorChecks: first.interceptorChecks, interceptorReplyOnly: first.interceptorReplyOnly, interceptorContextDepth: first.interceptorContextDepth }
  T.AbeleConfig.getInstance().saveSettings = async () => {}
  return JSON.stringify({ indexed: indexed.length })
})()`

/** The agent's window with its list: three in their order, one switched off in its place. */
const agentList = `(async () => {
  ${prelude}
  registry.update(P.firstAgent, { interceptors: [
    entry({ script: 'Sample spelling' }),
    entry({ agentId: P.agents[1], checks: 'both', pattern: '^/fix' }),
    entry({ script: 'Sample fact checker', checks: 'answer', enabled: false }),
  ] })
  T.openDialog('agent-editor')
  await showList()
  return JSON.stringify({ rows: rows() })
})()`

const agentEmpty = `(async () => {
  ${prelude}
  registry.update(P.firstAgent, { interceptors: [] })
  await wait(300)
  const list = await showList()
  return JSON.stringify({ rows: rows().length, add: !!qa('button', list).find((b) => b.textContent.includes('Add interceptor')) })
})()`

/** Added from the empty list: it comes first, its settings open under it. */
const agentOpen = `(async () => {
  ${prelude}
  const list = await showList()
  qa('button', list).find((b) => b.textContent.includes('Add interceptor')).click()
  const settings = await until(() => document.querySelector('.modal .abele-interceptors__settings'), 5000, 'the new entry to open')
  settings.scrollIntoView({ block: 'center' })
  await wait(400)
  return JSON.stringify({ rows: rows(), stored: (registry.get(P.firstAgent).interceptors || []).length, fields: qa('.setting-item-name', settings).map((n) => n.textContent.trim()) })
})()`

const agentLong = `(async () => {
  ${prelude}
  registry.update(P.firstAgent, { interceptors: [
    entry({ script: 'Sample spelling' }),
    entry({ script: 'Sample style check', pattern: '^(where|what)\\\\b.*\\\\?$' }),
    entry({ agentId: P.agents[0], checks: 'both', replyOnly: true, contextDepth: 4 }),
    entry({ script: 'Sample signature', enabled: false }),
    entry({ script: 'Sample fact checker', checks: 'answer' }),
    entry({ agentId: P.agents[1], checks: 'answer' }),
    entry({ script: 'Sample plain language', checks: 'answer' }),
    entry({ script: 'Sample tone', checks: 'answer' }),
  ] })
  await wait(300)
  const list = await showList()
  const box = list.getBoundingClientRect()
  const over = qa('.abele-interceptors__entry', list).filter((r) => r.getBoundingClientRect().right > box.right + 0.5).length
  const result = { rows: rows(), over }
  await closeModals()
  return JSON.stringify(result)
})()`

/** The chat's own list in its setup, and the chat ready to run it. */
const chatOwn = `(async () => {
  ${prelude}
  const stale = app.vault.getAbstractFileByPath(${JSON.stringify(CHAT)})
  if (stale) await app.vault.delete(stale)
  const meta = { v: 2, k: 'meta', type: 'abele-chat', title: 'Interceptor chain probe', providerId: '', modelId: '', created: '2026-10-16' }
  const file = await app.vault.create(${JSON.stringify(CHAT)}, JSON.stringify(meta) + '\\n')
  await chats.openChatFile(file)
  await chats.revealSidebar()
  const s = await until(() => session(), 5000, 'the probe chat')
  s.resolveModel = () => ({ id: 'fake', name: 'Fake', baseUrl: 'https://abele-e2e-fake-provider.invalid/v1', apiKey: 'none', contextWindow: 100000, maxTokens: 1000, supportsReasoning: false })
  for (const k of ['generateTitle', 'generateSummary', 'generateRecap', 'autoCompactIfNeeded']) s.summarizer[k] = async () => undefined
  s.interceptor.setEntries([
    entry({ id: 'ic-spelling', script: 'Sample spelling' }),
    entry({ id: 'ic-style', script: 'Sample style check' }),
    entry({ id: 'ic-signature', script: 'Sample signature' }),
    entry({ id: 'ic-facts', script: 'Sample fact checker', checks: 'answer' }),
    entry({ id: 'ic-plain', script: 'Sample plain language', checks: 'answer' }),
    entry({ id: 'ic-tone', script: 'Sample tone', checks: 'answer' }),
  ])
  const chat = await until(() => document.querySelector('.abele-ai-chat'), 5000, 'the chat view')
  chat.querySelector('[aria-label="More chat actions"]').click()
  await wait(300)
  qa('.menu-item').find((item) => (item.querySelector('.menu-item-title')?.textContent ?? item.textContent).trim() === 'Access, tools and chat settings').click()
  await until(() => qa('.abele-chat-setup .abele-tabs__tab').length, 5000, 'chat setup')
  qa('.abele-chat-setup .abele-tabs__tab').find((tab) => tab.textContent.trim() === 'Chat').click()
  await showList()
  const mode = qa('.modal .setting-item').find((r) => r.querySelector('.setting-item-name')?.textContent === 'Interceptors')?.querySelector('select:not(.is-measuring)')?.value ?? ''
  return JSON.stringify({ rows: rows(), mode })
})()`

const closeSetup = `(async () => {
  ${prelude}
  await closeModals()
  await chats.revealSidebar()
  await wait(300)
  return JSON.stringify({ ok: true })
})()`

/** The person's message through three, then the answer read by three, the second reading now. */
const answerChecking = `(async () => {
  ${prelude}
  const s = session()
  globalThis.__abeleChainGate1 = false
  globalThis.__abeleChainGate2 = false
  P.first = s.sendMessage('where is the lanturn?')
  await until(() => s.answerCheck.value?.at === 1, 15000, 'the first answer check')
  globalThis.__abeleChainGate1 = true
  await until(() => s.answerCheck.value?.at === 2, 15000, 'the second answer check')
  const el = await until(() => qa('.abele-chat-msg_assistant').at(-1)?.querySelector('.abele-chat-msg__check-count'), 5000, 'the count')
  el.closest('.abele-chat-msg').scrollIntoView({ block: 'end' })
  await wait(400)
  return JSON.stringify({
    asked: P.requests[0] ?? '',
    sent: s.messages.value.find((m) => m.role === 'user')?.content ?? '',
    count: el.textContent.trim(),
    glyph: el.closest('.abele-chat-msg').querySelector('.abele-chat-msg__checking')?.getAttribute('aria-label') ?? '',
  })
})()`

const answerVersions = `(async () => {
  ${prelude}
  const s = session()
  globalThis.__abeleChainGate2 = true
  await P.first
  await until(() => !s.answerCheck.value, 15000, 'the checks to end')
  const answer = s.messages.value.filter((m) => m.role === 'assistant').at(-1)
  const el = document.querySelector('[data-message-id="' + answer.id + '"]') ?? qa('.abele-chat-msg_assistant').at(-1)
  el.scrollIntoView({ block: 'center' })
  const mark = el.querySelector('.abele-chat-msg__replaced')
  mark.click()
  const modal = await until(() => document.querySelector('.abele-reply-original'), 5000, 'the versions')
  await wait(400)
  return JSON.stringify({
    content: answer.content,
    authors: (answer.revisions || []).map((r) => r.author),
    tabs: qa('.abele-tabs__tab', modal.closest('.modal')).map((t) => t.textContent.trim()),
    said: modal.querySelector('.abele-reply-original__said')?.textContent.trim() ?? '',
  })
})()`

/** The second of three fails: the message waits there, the first one's change kept. */
const messageStopped = `(async () => {
  ${prelude}
  await closeModals()
  const s = session()
  globalThis.__abeleChainBreak = true
  P.requestsBefore = P.requests.length
  await s.sendMessage('where did the lanturn go?')
  const held = await until(() => s.messages.value.find((m) => m.draft && m.interceptorWait?.error), 15000, 'the message to stop')
  const el = await until(() => document.querySelector('[data-message-id="' + held.id + '"]') ?? qa('.abele-chat-msg_user').at(-1), 5000, 'the held message')
  el.scrollIntoView({ block: 'end' })
  await wait(400)
  return JSON.stringify({
    content: held.content,
    wait: held.interceptorWait,
    step: el.querySelector('.abele-chat-msg__interceptor-step')?.textContent.trim() ?? '',
    error: el.querySelector('.abele-chat-msg__interceptor-error')?.textContent.trim() ?? '',
    send: el.querySelector('.abele-chat-msg__draft-btn--send')?.textContent.trim() ?? '',
    asked: P.requests.length - P.requestsBefore,
  })
})()`

/** Retry, the style guide back: the failed one runs again and the one after it, then the agent. */
const retried = `(async () => {
  ${prelude}
  const s = session()
  globalThis.__abeleChainBreak = false
  const el = qa('.abele-chat-msg_user').at(-1)
  el.querySelector('.abele-chat-msg__interceptor-error button').click()
  await until(() => P.requests.length > P.requestsBefore && !s.isStreaming.value && !s.answerCheck.value, 20000, 'the retried turn')
  return JSON.stringify({ asked: P.requests.at(-1), held: s.messages.value.some((m) => m.draft) })
})()`

/** Stopped again, Send as is sends it as the failed one was given it, without the rest. */
const sentAsIs = `(async () => {
  ${prelude}
  const s = session()
  globalThis.__abeleChainBreak = true
  P.requestsBefore = P.requests.length
  await s.sendMessage('where is the lanturn now?')
  const held = await until(() => s.messages.value.find((m) => m.draft && m.interceptorWait?.error), 15000, 'the message to stop')
  const el = await until(() => document.querySelector('[data-message-id="' + held.id + '"]') ?? qa('.abele-chat-msg_user').at(-1), 5000, 'the held message')
  el.querySelector('.abele-chat-msg__draft-btn--send').click()
  await until(() => P.requests.length > P.requestsBefore && !s.isStreaming.value && !s.answerCheck.value, 20000, 'the turn')
  globalThis.__abeleChainBreak = false
  return JSON.stringify({ asked: P.requests.at(-1), held: s.messages.value.some((m) => m.draft) })
})()`

const cleanup = `(async () => {
  ${prelude}
  globalThis.__abeleChainGate1 = globalThis.__abeleChainGate2 = true
  globalThis.__abeleChainBreak = false
  const errors = []
  try {
    for (const button of qa('.modal .modal-close-button').reverse()) button.click()
    if (P.realFetch) window.fetch = P.realFetch
    const s = session()
    if (s) { s.abort(); await chats.deleteChat(s.id) }
    const f = app.vault.getAbstractFileByPath(${JSON.stringify(CHAT)})
    if (f) await app.vault.delete(f)
    if (P.firstAgent && P.firstWas) {
      const agent = registry.get(P.firstAgent)
      if (agent) {
        if (P.firstWas.interceptors === undefined) delete agent.interceptors
        const { interceptors, ...single } = P.firstWas
        Object.assign(agent, interceptors ? { interceptors } : {}, single)
      }
    }
    for (const id of P.agents) registry.remove(id)
    for (const sc of P.scripts) {
      const file = app.vault.getAbstractFileByPath(sc.path)
      if (file) await app.vault.delete(file)
    }
    await T.ScriptService.getInstance().discover()
    for (const dir of P.createdDirs) {
      const d = app.vault.getAbstractFileByPath(dir)
      if (d && d.children && !d.children.length) await app.vault.delete(d, true)
    }
  } catch (e) { errors.push(String((e && e.message) || e)) }
  try { if (P.fixture) await restoreScriptFixture(P.fixture) } catch (e) { errors.push(String((e && e.message) || e)) }
  delete window.__abeleChainProbe
  return errors.join('; ') || 'ok'
})()`

const run = async <T>(code: string): Promise<T> => JSON.parse(await evalLong(code, 90_000)) as T

const available = isObsidianRunning() && hasTestApi()

type Row = { number: string; name: string; desc: string }

describe.runIf(available)('several interceptors in a row', () => {
  beforeAll(async () => {
    if (!onPhone()) setBackgroundThrottling(false)
    const ready = await run<{ indexed: number }>(setup)
    expect(ready.indexed).toBeGreaterThanOrEqual(SCRIPTS.length)
  }, 120_000)

  afterAll(async () => {
    const left = await evalLong(cleanup, 90_000)
    if (!onPhone()) setBackgroundThrottling(true)
    expect(left).toBe('ok')
  }, 120_000)

  it('lists the agent’s interceptors numbered in their order, a switched-off one in its place', async () => {
    const report = await run<{ rows: Row[] }>(agentList)
    shot('1-list')
    expect(report.rows.map((r) => r.number)).toEqual(['1', '2', '3'])
    expect(report.rows.map((r) => r.name)).toEqual([
      'Script: Sample spelling',
      'Sample second reviewer',
      'Script: Sample fact checker',
    ])
    expect(report.rows[1].desc).toBe('Both · matching ^/fix')
    expect(report.rows[2].desc).toBe('Off')
  }, 120_000)

  it('shows an empty list as its description and Add interceptor', async () => {
    const report = await run<{ rows: number; add: boolean }>(agentEmpty)
    shot('2-empty')
    expect(report.rows).toBe(0)
    expect(report.add).toBe(true)
  }, 120_000)

  it('adds one and opens its settings under it', async () => {
    const report = await run<{ rows: Row[]; stored: number; fields: string[] }>(agentOpen)
    shot('3-open')
    expect(report.rows).toHaveLength(1)
    expect(report.stored).toBe(1)
    expect(report.fields).toEqual(expect.arrayContaining(['Interceptor', 'Checks']))
  }, 120_000)

  it('keeps a long list with long names, a script and a switched-off one inside the window', async () => {
    const report = await run<{ rows: Row[]; over: number }>(agentLong)
    shot('4-long')
    expect(report.rows).toHaveLength(8)
    expect(report.rows[3].desc).toBe('Off')
    expect(report.over).toBe(0)
  }, 120_000)

  it('keeps a list of the chat’s own in its setup', async () => {
    const report = await run<{ rows: Row[]; mode: string }>(chatOwn)
    shot('5-chat-own')
    await run(closeSetup)
    expect(report.mode).toBe(':own')
    expect(report.rows.map((r) => r.number)).toEqual(['1', '2', '3', '4', '5', '6'])
  }, 120_000)

  it('runs the message through three in order and counts which reads the answer', async () => {
    const report = await run<{ asked: string; sent: string; count: string; glyph: string }>(
      answerChecking
    )
    shot('6-answer-checking')
    expect(report.asked).toBe('Where is the lantern? Thanks.')
    expect(report.sent).toBe('Where is the lantern? Thanks.')
    expect(report.count).toBe('2/3')
    expect(report.glyph).toBe('Sample plain language is checking this answer · 2 of 3')
  }, 120_000)

  it('opens the answer replaced by two as a version per interceptor', async () => {
    const report = await run<{ content: string; authors: string[]; tabs: string[]; said: string }>(
      answerVersions
    )
    shot('7-answer-versions')
    expect(report.content).toBe('The lamp is on the high shelf, by the window.')
    expect(report.authors).toEqual(['Sample fact checker', 'Sample plain language'])
    expect(report.tabs).toEqual([
      'Original',
      '1 · Sample fact checker',
      '2 · Sample plain language',
    ])
    expect(report.said).toBe('Said where on the shelf.')
  }, 120_000)

  it('stops a message at the one that fails, keeping the work before it', async () => {
    const report = await run<{
      content: string
      wait: { entry: string; at: number; of: number; error: string }
      step: string
      error: string
      send: string
      asked: number
    }>(messageStopped)
    shot('8-message-stopped')
    expect(report.content).toBe('where did the lantern go?')
    expect(report.wait).toMatchObject({ entry: 'ic-style', at: 2, of: 3 })
    expect(report.step).toBe('2 of 3: Sample style check')
    expect(report.error).toContain('Sample style check, 2 of 3: the style guide could not be read')
    expect(report.error).toContain('Retry')
    expect(report.send).toBe('Send as is')
    expect(report.asked).toBe(0)
  }, 120_000)

  it('Retry runs the failed one again and the rest, then the agent', async () => {
    const report = await run<{ asked: string; held: boolean }>(retried)
    expect(report.asked).toBe('Where did the lantern go? Thanks.')
    expect(report.held).toBe(false)
  }, 120_000)

  it('Send as is sends it without the ones after the failed one', async () => {
    const report = await run<{ asked: string; held: boolean }>(sentAsIs)
    expect(report.asked).toBe('where is the lantern now?')
    expect(report.held).toBe(false)
  }, 120_000)
})
