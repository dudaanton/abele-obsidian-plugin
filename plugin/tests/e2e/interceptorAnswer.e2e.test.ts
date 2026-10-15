/**
 * The interceptor checking the agent's finished answer, in the running app.
 *
 * A script marked `@interceptor` is the chat's interceptor with Checks set to the agent's
 * answers. The script waits for a gate the test opens, so the answer can be seen while it is
 * checked: muted, a turning glyph by its time, Stop in the composer, and a message typed then
 * waiting above the field. Opened to replace, the answer takes the script's text by itself, with
 * the edited-reply pencil naming the interceptor; the queued message's turn reads the
 * replacement; the pencil, there only under the pointer on a computer and always on a phone as
 * the rest of the message's bar, opens the agent's own words with Undo. Opened to fail, the answer stays
 * with the reason under it; Stop during a check keeps it too.
 *
 * No real model is asked: `window.fetch` answers the fake provider's address alone with a
 * scripted OpenAI-style stream, as in `interceptorScript.e2e.test.ts`. Pictures of each state go
 * to the `abele-interceptor-answer` shots folder. Writes one script and one chat and removes them.
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

const SHOTS = shotDir('abele-interceptor-answer')
const device = onPhone() ? 'phone' : 'desktop'
const shot = (name: string) => columnShot(`${SHOTS}/${device}-${name}.png`)

const CHAT = 'AI/Chats/Abele answer check probe.abchat'
const NAME = 'Answer probe'
const FOLDER = 'Sample answer scripts'

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
  const P = (window.__abeleAnswerProbe ||= { requests: [], createdDirs: [] })
  const session = () => chats.getSessionByFile(${JSON.stringify(CHAT)})
  const answers = () => session().messages.value.filter((m) => m.role === 'assistant')
  const qa = (sel) => [...document.querySelectorAll(sel)]
  const lastAnswerEl = () => qa('.abele-chat-msg_assistant').at(-1)
  // Moves the window's own pointer onto an element's middle, or to the window's corner for null.
  const pointAt = async (target) => {
    const r = target?.getBoundingClientRect()
    const x = r ? Math.round(r.left + r.width / 2) : 1, y = r ? Math.round(r.top + r.height / 2) : 1
    require('@electron/remote').getCurrentWebContents().sendInputEvent({ type: 'mouseMove', x, y })
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
  }
`

const setup = `(async () => {
  ${prelude}
  const FAKE = 'https://abele-e2e-fake-provider.invalid/v1'
  const scriptPath = ${JSON.stringify(FOLDER)} + '/abele-answer-probe.js'
  P.scriptPath = scriptPath
  const code = [
    '// @name ' + ${JSON.stringify(NAME)},
    '// @interceptor 60',
    "if (message.kind !== 'answer') return",
    'while (!globalThis.__abeleAnswerGate) {',
    '  if (signal.aborted) return',
    '  await new Promise((r) => setTimeout(r, 50))',
    '}',
    "if (globalThis.__abeleAnswerGate === 'fail') throw new Error('Sample check failure')",
    "return { text: message.text.replace('lantern', 'lamp') }",
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
  const replies = [
    'The lantern is on the shelf, beside the sample jar. ' + 'It has been there since the sample move. '.repeat(3),
    'Second answer.',
    'The lantern is lit.',
    'The lantern is out.',
  ]
  P.realFetch = window.fetch
  window.fetch = async (url, init) => {
    if (typeof url !== 'string' || !url.startsWith(FAKE)) return P.realFetch(url, init)
    const body = JSON.parse(init.body)
    P.requests.push(body.messages.map((m) => ({ role: m.role, text: typeof m.content === 'string' ? m.content : (m.content || []).map((p) => p.text || '').join('') })))
    const reply = replies[P.requests.length - 1] || 'Done.'
    return new Response(sse([text(reply), text('', 'stop')]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }

  P.fixture = await saveScriptFixture()
  for (const dir of ['AI', 'AI/Chats', ${JSON.stringify(FOLDER)}]) {
    if (!app.vault.getAbstractFileByPath(dir)) { await app.vault.createFolder(dir); P.createdDirs.unshift(dir) }
  }
  const staleScript = app.vault.getAbstractFileByPath(scriptPath)
  if (staleScript) await app.vault.delete(staleScript)
  await app.vault.create(scriptPath, code)
  await enableScriptFixture(${JSON.stringify(FOLDER)})
  await approveScriptFixture(scriptPath, code)
  const scripts = T.ScriptService.getInstance()
  if (!scripts.getAll().some((s) => s.meta.name === ${JSON.stringify(NAME)} && s.meta.interceptor))
    throw new Error('the probe script was not indexed as an interceptor')

  const stale = app.vault.getAbstractFileByPath(${JSON.stringify(CHAT)})
  if (stale) await app.vault.delete(stale)
  const meta = { v: 2, k: 'meta', type: 'abele-chat', title: 'Answer check probe', providerId: '', modelId: '', created: '2026-10-15' }
  const file = await app.vault.create(${JSON.stringify(CHAT)}, JSON.stringify(meta) + '\\n')
  await chats.openChatFile(file)
  await chats.revealSidebar()
  const s = session()
  if (!s) throw new Error('the probe chat did not open')
  s.resolveModel = () => ({ id: 'fake', name: 'Fake', baseUrl: FAKE, apiKey: 'none', contextWindow: 100000, maxTokens: 1000, supportsReasoning: false })
  for (const k of ['generateTitle', 'generateSummary', 'generateRecap', 'autoCompactIfNeeded']) s.summarizer[k] = async () => undefined
  s.interceptor.script.value = ${JSON.stringify(NAME)}
  s.interceptor.checks.value = 'answer'
  globalThis.__abeleAnswerGate = null

  // The chat's own settings: the Checks row under the interceptor.
  const chat = await until(() => document.querySelector('.abele-ai-chat'), 5000, 'the chat view')
  chat.querySelector('[aria-label="More chat actions"]').click()
  await wait(300)
  qa('.menu-item').find((item) => (item.querySelector('.menu-item-title')?.textContent ?? item.textContent).trim() === 'Access, tools and chat settings').click()
  await until(() => qa('.abele-chat-setup .abele-tabs__tab').length, 5000, 'chat setup')
  qa('.abele-chat-setup .abele-tabs__tab').find((tab) => tab.textContent.trim() === 'Chat').click()
  await wait(400)
  const row = await until(() => qa('.setting-item').find((r) => r.querySelector('.setting-item-name')?.textContent === 'Checks'), 5000, 'the Checks row')
  row.scrollIntoView({ block: 'center' })
  await wait(400)
  return JSON.stringify({
    checks: row.querySelector('select:not(.is-measuring)')?.value ?? '',
    desc: row.querySelector('.setting-item-description')?.textContent ?? '',
    replyOnlyShown: qa('.setting-item-name').some((n) => n.textContent === 'Reply only'),
  })
})()`

const closeSetup = `(async () => {
  ${prelude}
  const open = () => qa('.modal-container').filter((c) => c.querySelector('.abele-chat-setup'))
  const tried = []
  for (const way of ['button', 'escape', 'background']) {
    const box = open()[0]
    if (!box) break
    tried.push(way)
    if (way === 'button') box.querySelector('.modal-close-button')?.click()
    if (way === 'escape') box.querySelector('.modal')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    if (way === 'background') box.querySelector('.modal-bg')?.click()
    for (let i = 0; i < 30 && open().length; i++) await wait(100)
  }
  if (open().length) throw new Error('the chat settings did not close; tried ' + tried.join(', '))
  await chats.revealSidebar()
  await wait(400)
  return JSON.stringify({ tried })
})()`

const checking = `(async () => {
  ${prelude}
  const s = session()
  P.first = s.sendMessage('Where is the lantern?')
  await until(() => s.answerCheck.value && lastAnswerEl()?.classList.contains('abele-chat-msg_checking'), 10000, 'the check to start')
  await s.sendMessage('And the key?')
  await wait(300)
  lastAnswerEl().scrollIntoView({ block: 'end' })
  await wait(300)
  const el = lastAnswerEl()
  return JSON.stringify({
    muted: el.classList.contains('abele-chat-msg_checking'),
    glyph: el.querySelector('.abele-chat-msg__checking')?.getAttribute('aria-label') ?? '',
    stop: !!document.querySelector('.abele-chat-input__stop'),
    queued: qa('.abele-ai-chat__queued-item').length,
    requests: P.requests.length,
  })
})()`

const replaced = `(async () => {
  ${prelude}
  const s = session()
  globalThis.__abeleAnswerGate = 'replace'
  await until(() => P.requests.length >= 2 && answers().length >= 2 && !s.answerCheck.value && !s.isStreaming.value, 15000, 'the queued turn')
  await P.first
  globalThis.__abeleAnswerGate = null
  const first = answers()[0]
  const el = document.querySelector('[data-message-id="' + first.id + '"]') ?? qa('.abele-chat-msg_assistant')[0]
  el.scrollIntoView({ block: 'center' })
  ${onPhone() ? '' : 'await pointAt(null)'}
  await wait(400)
  const second = P.requests[1]
  const file = app.vault.getAbstractFileByPath(${JSON.stringify(CHAT)})
  const disk = await app.vault.read(file)
  return JSON.stringify({
    content: first.content,
    original: first.revisions?.[0]?.before ?? '',
    by: first.revisions?.[0]?.by ?? '',
    pencil: el.querySelector('.abele-chat-msg__edited')?.getAttribute('aria-label') ?? '',
    pencilOpacity: getComputedStyle(el.querySelector('.abele-chat-msg__edited')).opacity,
    muted: qa('.abele-chat-msg_checking').length,
    nextTurnSaw: second.filter((m) => m.role === 'assistant').map((m) => m.text),
    secondKept: answers()[1].content,
    onDisk: disk.includes('The lamp is on the shelf') && disk.includes('"by":"interceptor"'),
  })
})()`

/** The real pointer over the replaced answer's middle (a computer only): a hover, not a class. */
const hovered = `(async () => {
  ${prelude}
  const el = document.querySelector('[data-message-id="' + answers()[0].id + '"]') ?? qa('.abele-chat-msg_assistant')[0]
  await pointAt(el)
  await wait(300)
  return JSON.stringify({
    hover: el.matches(':hover'),
    pencilOpacity: getComputedStyle(el.querySelector('.abele-chat-msg__edited')).opacity,
  })
})()`

const pointerAway = `(async () => {
  ${prelude}
  await pointAt(null)
  return JSON.stringify({ ok: true })
})()`

const original = `(async () => {
  ${prelude}
  const first = answers()[0]
  const el = document.querySelector('[data-message-id="' + first.id + '"]') ?? qa('.abele-chat-msg_assistant')[0]
  el.querySelector('.abele-chat-msg__edited').click()
  const modal = await until(() => document.querySelector('.abele-reply-original'), 5000, 'the original reply window')
  await wait(400)
  const shown = modal.closest('.modal')?.textContent ?? ''
  return JSON.stringify({
    title: shown.includes('Original reply'),
    undo: qa('.modal button').some((b) => b.textContent.trim() === 'Undo last change'),
  })
})()`

const undo = `(async () => {
  ${prelude}
  qa('.modal button').find((b) => b.textContent.trim() === 'Undo last change').click()
  await until(() => !document.querySelector('.abele-reply-original'), 5000, 'the window to close')
  await until(() => answers()[0].content.includes('lantern'), 5000, 'the undo')
  return JSON.stringify({ content: answers()[0].content })
})()`

const failed = `(async () => {
  ${prelude}
  const s = session()
  globalThis.__abeleAnswerGate = 'fail'
  await s.sendMessage('Is it lit?')
  globalThis.__abeleAnswerGate = null
  const el = lastAnswerEl()
  el.scrollIntoView({ block: 'end' })
  await wait(400)
  return JSON.stringify({
    content: answers().at(-1).content,
    note: el.querySelector('.abele-chat-msg__interceptor')?.textContent ?? '',
  })
})()`

const stopped = `(async () => {
  ${prelude}
  const s = session()
  const sent = s.sendMessage('Is it out?')
  await until(() => s.answerCheck.value && document.querySelector('.abele-chat-input__stop'), 10000, 'the check to start')
  document.querySelector('.abele-chat-input__stop').click()
  await sent
  await wait(400)
  const el = lastAnswerEl()
  return JSON.stringify({
    content: answers().at(-1).content,
    note: el.querySelector('.abele-chat-msg__interceptor')?.textContent ?? '',
    busy: !!s.answerCheck.value,
  })
})()`

const cleanup = `(async () => {
  ${prelude}
  globalThis.__abeleAnswerGate = null
  const errors = []
  try {
    for (const button of [...document.querySelectorAll('.modal .modal-close-button')].reverse()) button.click()
    if (P.realFetch) window.fetch = P.realFetch
    const s = session()
    if (s) { s.abort(); await chats.deleteChat(s.id) }
    const f = app.vault.getAbstractFileByPath(${JSON.stringify(CHAT)})
    if (f) await app.vault.delete(f)
    const sc = P.scriptPath && app.vault.getAbstractFileByPath(P.scriptPath)
    if (sc) await app.vault.delete(sc)
    await T.ScriptService.getInstance().discover()
    for (const dir of P.createdDirs) {
      const d = app.vault.getAbstractFileByPath(dir)
      if (d && d.children && !d.children.length) await app.vault.delete(d, true)
    }
  } catch (e) { errors.push(String((e && e.message) || e)) }
  try { if (P.fixture) await restoreScriptFixture(P.fixture) } catch (e) { errors.push(String((e && e.message) || e)) }
  delete window.__abeleAnswerProbe
  return errors.join('; ') || 'ok'
})()`

const run = async <T>(code: string): Promise<T> => JSON.parse(await evalLong(code, 60_000)) as T

const available = isObsidianRunning() && hasTestApi()

describe.runIf(available)('the interceptor checking the agent’s answer', () => {
  beforeAll(() => {
    if (!onPhone()) setBackgroundThrottling(false)
  })

  afterAll(async () => {
    const left = await evalLong(cleanup, 60_000)
    if (!onPhone()) setBackgroundThrottling(true)
    expect(left).toBe('ok')
  }, 90_000)

  it('offers what it checks in the chat’s settings, without Reply only for answers', async () => {
    const report = await run<{ checks: string; desc: string; replyOnlyShown: boolean }>(setup)
    shot('setting')
    const closed = await run<{ tried: string[] }>(closeSetup)
    console.debug('[interceptorAnswer e2e] settings closed by', closed.tried)
    expect(report.checks).toBe('answer')
    expect(report.desc).toContain("The agent's answers")
    expect(report.replyOnlyShown).toBe(false)
  }, 90_000)

  it('mutes the answer while it is checked, with Stop on and a typed message waiting', async () => {
    const report = await run<{
      muted: boolean
      glyph: string
      stop: boolean
      queued: number
      requests: number
    }>(checking)
    shot('checking')
    expect(report.muted).toBe(true)
    expect(report.glyph).toBe(`${NAME} is checking this answer`)
    expect(report.stop).toBe(true)
    expect(report.queued).toBe(1)
    expect(report.requests).toBe(1)
  }, 90_000)

  it('puts the script’s text in place by itself, and the next turn reads it', async () => {
    const report = await run<{
      content: string
      original: string
      by: string
      pencil: string
      pencilOpacity: string
      muted: number
      nextTurnSaw: string[]
      secondKept: string
      onDisk: boolean
    }>(replaced)
    shot('replaced')
    // The pencil is one of the bar's hover-only things: away from the pointer on a computer it is
    // hidden; a phone, which cannot point, keeps it like the time.
    expect(report.pencilOpacity).toBe(onPhone() ? '1' : '0')
    if (!onPhone()) {
      const over = await run<{ hover: boolean; pencilOpacity: string }>(hovered)
      shot('replaced-hover')
      await run(pointerAway)
      expect(over.hover).toBe(true)
      expect(over.pencilOpacity).toBe('1')
    }
    expect(report.content).toMatch(/^The lamp is on the shelf/)
    expect(report.original).toMatch(/^The lantern is on the shelf/)
    expect(report.by).toBe('interceptor')
    expect(report.pencil).toMatch(new RegExp(`^Replaced by ${NAME} · `))
    expect(report.muted).toBe(0)
    expect(report.nextTurnSaw).toHaveLength(1)
    expect(report.nextTurnSaw[0]).toMatch(/^The lamp is on the shelf/)
    expect(report.secondKept).toBe('Second answer.')
    expect(report.onDisk).toBe(true)
  }, 90_000)

  it('opens the agent’s own words from the pencil, and Undo puts them back', async () => {
    const report = await run<{ title: boolean; undo: boolean }>(original)
    shot('original')
    expect(report.title).toBe(true)
    expect(report.undo).toBe(true)
    const undone = await run<{ content: string }>(undo)
    expect(undone.content).toMatch(/^The lantern is on the shelf/)
  }, 90_000)

  it('keeps the answer and says why when the check fails', async () => {
    const report = await run<{ content: string; note: string }>(failed)
    shot('failure')
    expect(report.content).toBe('The lantern is lit.')
    expect(report.note).toContain('Sample check failure')
    expect(report.note).toContain('The answer stays as it was.')
  }, 90_000)

  it('keeps the answer when Stop is pressed during the check', async () => {
    const report = await run<{ content: string; note: string; busy: boolean }>(stopped)
    shot('stopped')
    expect(report.content).toBe('The lantern is out.')
    expect(report.note).toMatch(/stopped/)
    expect(report.busy).toBe(false)
  }, 90_000)
})
