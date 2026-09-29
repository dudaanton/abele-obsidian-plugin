/**
 * Reading an answer while it is still being written, in the running app, on a desktop and under
 * `emulateMobile` at 390×844.
 *
 * A scripted model streams a long reply with a diagram and a chart in it. Partway through, the
 * reader scrolls up to a paragraph below both and stays there. That paragraph has to stay where
 * the reader put it: while the rest of the reply streams in under it, and when the reply ends and
 * becomes an ordinary message. It used to shake while the answer was written and, once it ended,
 * throw the reader to the bottom of the chat.
 *
 * The same run watches the chart: while its block is still being written the reply shows a quiet
 * placeholder rather than a chart drawn from half a block, with its errors; once the block is
 * closed the chart is drawn.
 *
 * No real model is asked. The chat's model points at an address nothing answers, and
 * `window.fetch` answers that address alone with a scripted stream in the shape an
 * OpenAI-compatible provider sends. The chat is deleted afterwards.
 *
 * Requires Obsidian running with the development build — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  evalJson,
  evalLong,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
  runCli,
  setBackgroundThrottling,
} from './helpers/obsidianCli'

const available = isObsidianRunning() && hasTestApi()
const CHAT = 'AI/Chats/Abele stream scroll probe.abchat'
const PHONE = { width: 390, height: 844 }
/** Where the reader puts the paragraph they read, below the top of the messages. */
const READ_AT = 40

interface Report {
  error?: string
  /** How far the paragraph read strayed from where the reader put it, while the reply streamed. */
  driftWhileStreaming: number
  /** And once the reply had ended and settled as a message. */
  driftAfter: number
  /** Whether the chat was at its end once the reply ended: it was thrown there. */
  atEndAfter: boolean
  /** How many samples were taken while streaming, so a probe that saw nothing does not pass. */
  samples: number
  /** Chart errors on screen at any moment while the reply was being written. */
  chartErrors: number
  /** Samples where the chart's unfinished block was on screen as a placeholder. */
  placeholders: number
  /** What the finished reply holds. */
  chartsAfter: number
  placeholdersAfter: number
}

const paragraph = (n: number) =>
  `Paragraph ${n} of the sample garden plan. The beds along the fence get the tall plants, the ` +
  `middle rows the herbs, and the path keeps a hand's width of gravel on each side so the ` +
  `watering can fits between them without brushing the leaves on the way through.`

const REPLY = [
  'Here is the sample garden plan, bed by bed.',
  paragraph(1),
  paragraph(2),
  '```mermaid\ngraph TD\n  Seed --> Sprout\n  Sprout --> Leaf\n  Leaf --> Flower\n  Flower --> Seed\n```',
  paragraph(3),
  '```abele-chart\ntype: bar\nheight: 220\ntitle: Rows per bed\nxLabels: [North, East, South, West]\nseries:\n  - name: Rows\n    data: [3, 5, 2, 6]\n```',
  'The reading point sits here, under the diagram and the chart, and the reader stays on it.',
  ...Array.from({ length: 24 }, (_, i) => paragraph(i + 4)),
].join('\n\n')

const script = (phone: boolean) => `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      const v = fn()
      if (v) return v
      await wait(30)
    }
    return null
  }
  const chats = window.__abeleTest.ChatService.getInstance()
  const CHAT = ${JSON.stringify(CHAT)}
  const REPLY = ${JSON.stringify(REPLY)}
  const READ_AT = ${READ_AT}
  const FAKE = 'http://abele-e2e-fake-provider.invalid/v1'
  const report = { driftWhileStreaming: 0, driftAfter: 0, atEndAfter: false, samples: 0, chartErrors: 0, placeholders: 0, chartsAfter: 0, placeholdersAfter: 0 }
  const createdDirs = []
  const realFetch = window.fetch

  const cut = (text) => {
    const out = []
    for (let i = 0; i < text.length; i += 24) out.push(text.slice(i, i + 24))
    return out
  }
  const THINKING = 'Working out which beds get the most sun before writing the plan out. '.repeat(18)
  const MORE = Array.from({ length: 10 }, (_, i) => 'A closing note ' + (i + 1) + ' on keeping the rows weeded through the summer, one short pass every few days rather than a long one every few weeks.').join('\\n\\n')
  const chunk = (delta, finish) => ({ choices: [{ delta, finish_reason: finish || null }] })
  // The first answer thinks, writes the reply and asks for a tool; the second writes more.
  const answers = [
    [
      ...cut(THINKING).map((p) => chunk({ reasoning_content: p })),
      ...cut(REPLY).map((p) => chunk({ content: p })),
      chunk({ tool_calls: [{ index: 0, id: 'call_probe', type: 'function', function: { name: 'ls', arguments: '{"path":"/"}' } }] }),
      chunk({}, 'tool_calls'),
    ],
    [...cut(MORE).map((p) => chunk({ content: p })), chunk({}, 'stop')],
  ]
  let requests = 0
  let sent = 0
  let finished = false
  const sse = (chunks, last) => {
    const enc = new TextEncoder()
    return new ReadableStream({
      async start(controller) {
        for (const c of chunks) {
          await wait(18)
          controller.enqueue(enc.encode('data: ' + JSON.stringify(c) + '\\n\\n'))
          if (c.choices[0].delta.content) sent += c.choices[0].delta.content.length
        }
        controller.enqueue(enc.encode('data: [DONE]\\n\\n'))
        controller.close()
        if (last) finished = true
      },
    })
  }
  window.fetch = async (url, init) => {
    if (typeof url !== 'string' || !url.startsWith(FAKE)) return realFetch(url, init)
    const chunks = answers[requests] || [chunk({ content: 'Done.' }), chunk({}, 'stop')]
    requests++
    return new Response(sse(chunks, requests >= answers.length), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }

  const box = () => [...document.querySelectorAll('.abele-ai-chat__messages')].find((el) => el.getClientRects().length)
  const reading = (el) => [...el.querySelectorAll('p')].find((p) => p.textContent.includes('The reading point sits here'))
  const offset = (el, p) => p.getBoundingClientRect().top - el.getBoundingClientRect().top

  let session = null
  try {
    for (const dir of ['AI', 'AI/Chats']) {
      if (!app.vault.getAbstractFileByPath(dir)) { await app.vault.createFolder(dir); createdDirs.unshift(dir) }
    }
    const stale = app.vault.getAbstractFileByPath(CHAT)
    if (stale) await app.vault.delete(stale)
    const meta = { v: 2, k: 'meta', type: 'abele-chat', title: 'Stream scroll probe', providerId: '', modelId: '', created: '2026-09-29' }
    const file = await app.vault.create(CHAT, JSON.stringify(meta) + '\\n')
    await chats.openChatFile(file)
    await chats.revealSidebar()
    session = chats.getSessionByFile(CHAT)
    if (!session) throw new Error('the probe chat did not open')
    session.resolveModel = () => ({
      id: 'fake', name: 'Fake', baseUrl: FAKE, apiKey: 'none',
      contextWindow: 100000, maxTokens: 4000, supportsReasoning: true,
    })
    // The one tool it asks for runs without asking: nobody is there to approve it.
    session.needsApproval = () => false
    for (const k of ['generateTitle', 'generateSummary', 'generateRecap', 'autoCompactIfNeeded']) {
      session.summarizer[k] = async () => undefined
    }

    const answered = session.sendMessage('plan the sample garden')
    // The chart is watched from the start: its block is written before the reader scrolls.
    let watching = true
    void (async () => {
      while (watching) {
        await new Promise((r) => { requestAnimationFrame(() => r()); setTimeout(r, 40) })
        const s = document.querySelector('.abele-ai-chat__streaming-content')
        if (!s) continue
        report.chartErrors += s.querySelectorAll('.abele-chart-error, .abele-mermaid_error').length
        if (s.querySelector('.abele-md-pending')) report.placeholders++
      }
    })()

    // Far enough in that there is plenty under the paragraph to be read, and plenty still to come.
    const at = REPLY.indexOf('Paragraph 9 of')
    if (!(await until(() => sent > at, 20000))) throw new Error('the reply never got going')
    const el = box()
    const p = await until(() => el && reading(el), 5000)
    if (!p) throw new Error('the paragraph to read is not on screen')
    await wait(200)

    // The reader takes over and scrolls the paragraph to near the top.
    el.dispatchEvent(new ${phone ? "Event('touchstart'" : "WheelEvent('wheel'"}, { bubbles: true, deltaY: -120 }))
    el.scrollTop = el.scrollTop + offset(el, reading(el)) - READ_AT
    // No scroll event is waited for: the wheel or the finger has said it, and a piece of the
    // reply landing before the frame used to put the reader back at the end.
    ${phone ? "await wait(60); el.dispatchEvent(new Event('touchend', { bubbles: true }))" : ''}
    await wait(120)
    const start = offset(el, reading(el))
    if (Math.abs(start - READ_AT) > 2) throw new Error('could not scroll to the paragraph: it is at ' + start)

    const sample = () => {
      const q = reading(el)
      if (!q) return null
      return Math.abs(offset(el, q) - start)
    }
    while (!finished || session.isStreaming.value) {
      await new Promise((r) => { requestAnimationFrame(() => r()); setTimeout(r, 40) })
      const d = sample()
      if (d !== null) report.driftWhileStreaming = Math.max(report.driftWhileStreaming, d)
      report.samples++
    }
    watching = false
    await answered
    const endAt = Date.now()
    while (Date.now() - endAt < 1500) {
      await new Promise((r) => { requestAnimationFrame(() => r()); setTimeout(r, 40) })
      const d = sample()
      report.driftAfter = Math.max(report.driftAfter, d === null ? 9999 : d)
    }
    report.atEndAfter = el.scrollHeight - el.scrollTop - el.clientHeight < 4
    const last = [...el.querySelectorAll('[data-message-id]')].find((m) => m.textContent.includes('The reading point sits here'))
    report.chartsAfter = last ? last.querySelectorAll('.abele-chart-container').length : 0
    report.placeholdersAfter = last ? last.querySelectorAll('.abele-md-pending').length : 0
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

const run = async (phone: boolean): Promise<Report> =>
  JSON.parse(await evalLong(script(phone), 120_000)) as Report

const expectSteady = (get: () => Report) => {
  it('got through without an error of its own', () => {
    expect(get().error).toBeUndefined()
    expect(get().samples).toBeGreaterThan(20)
  })

  it('keeps the paragraph being read in place while the reply streams in under it', () => {
    expect(get().driftWhileStreaming).toBeLessThanOrEqual(2)
  })

  it('keeps it there when the reply ends, rather than throwing the reader to the end', () => {
    expect(get().driftAfter).toBeLessThanOrEqual(2)
    expect(get().atEndAfter).toBe(false)
  })

  it('shows the chart as a placeholder while its block is written, never its errors', () => {
    expect(get().chartErrors).toBe(0)
    expect(get().placeholders).toBeGreaterThan(0)
  })

  it('draws the chart once the reply is done', () => {
    expect(get().chartsAfter).toBe(1)
    expect(get().placeholdersAfter).toBe(0)
  })
}

describe.runIf(available)('reading an answer while it streams, on a desktop', () => {
  let report: Report

  beforeAll(async () => {
    setBackgroundThrottling(false)
    report = await run(false)
    console.log('desktop', JSON.stringify(report))
  }, 150_000)

  afterAll(() => {
    if (available) setBackgroundThrottling(true)
  })

  expectSteady(() => report)
})

describe.runIf(available)('reading an answer while it streams, on a phone', () => {
  let report: Report
  let size: [number, number] = [0, 0]

  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  const windowSize = (): [number, number] =>
    evalJson<[number, number]>(`require('@electron/remote').getCurrentWindow().getContentSize()`)
  const setWindowSize = async (width: number, height: number): Promise<void> => {
    evalRaw(
      `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${width}, ${height}); return 'ok' })()`,
      30_000
    )
    await pause(1500)
  }
  const reload = async (how: string): Promise<void> => {
    await reloadApp(how)
    runCli(['dev:debug', 'on'], 30_000)
  }

  beforeAll(async () => {
    size = windowSize()
    await reload('app.emulateMobile(true)')
    await setWindowSize(PHONE.width, PHONE.height)
    await reload('window.location.reload()')
    report = await run(true)
    console.log('phone', JSON.stringify(report))
  }, 300_000)

  afterAll(async () => {
    if (evalJson<boolean>('app.isMobile')) await reload('app.emulateMobile(false)')
    if (size[0]) await setWindowSize(size[0], size[1])
  }, 180_000)

  expectSteady(() => report)
})
