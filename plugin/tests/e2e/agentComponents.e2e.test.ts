/**
 * What a note can show, an agent can show — in a chat reply and in a script view.
 *
 * A reply, `show()` and a view's `Markdown` go through the note renderer with the plugin's
 * post-processors on, so a gallery, a Mermaid diagram, a chart, a map, a callout, math, a
 * coloured highlight and embeds of a note and a base should draw in a reply exactly as in a
 * note. Only the running app can say whether they do: the unit tier has no renderer, no
 * layout, no WebGL. The chart was the one that did not — its block never started while the
 * window was throttled, and never let go of its chart once it had.
 *
 * The reply is the chat's own, from a real session: the model points at an address nothing
 * answers and `window.fetch` answers that one address with the reply, in the shape an
 * OpenAI-compatible provider streams, so everything past the network is the bundle's. The view
 * is a real script run through the script service. Pictures of both, on the desktop and in a
 * phone's layout (`app.emulateMobile(true)` at 390×844), go to `/tmp/abele-agent-components/`
 * — look at them: a count says a canvas is there, not that the chart on it is right.
 *
 * Everything is made in a folder for the run and removed after it, the chat and the script
 * with it; the vault's answer to Obsidian's "allow diagrams?" question is set for the run and
 * put back. Desktop Obsidian only: the capture and the window size are Electron's. Requires
 * the development build — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  activeVaultName,
  evalJson,
  evalLong,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
} from './helpers/obsidianCli'
import { onPhone } from './helpers/target'

const SHOTS = '/tmp/abele-agent-components'
const PHONE = { width: 390, height: 844 }
const DIR = 'Agent components e2e'
const CHAT = 'AI/Chats/Agent components e2e.abchat'
const SCRIPT_NAME = 'E2E Agent components'

/** Every block a reply is expected to draw, in the order a person reads them. */
const REPLY = [
  'Here is what I found.',
  '',
  '::abele-gallery::',
  '![[ace-red.png]]',
  '![[ace-blue.png|Blue]]',
  '![[ace-green.png]]',
  '',
  '```mermaid',
  'graph LR',
  '  Idea --> Draft --> Done',
  '```',
  '',
  '```abele-chart',
  'type: bar',
  'xLabels: [Mon, Tue, Wed]',
  'series:',
  '  - name: Hours',
  '    data: [3, 5, 2]',
  '```',
  '',
  '```abele-map',
  'height: 240',
  'interactive: false',
  'points:',
  '  - coordinates: 56.9496, 24.1052',
  '    label: Old Town',
  '```',
  '',
  '> [!tip] Worth knowing',
  '> A callout, $e^{i\\pi} + 1 = 0$ and =={green} a coloured highlight==.',
  '',
  '![[ACE Note]]',
  '',
  '![[ACE.base]]',
  '',
  'Open [[ACE Note]] for more.',
].join('\n')

const SCRIPT = `// @name ${SCRIPT_NAME}
// @description Every note block, from data
const v = view({ title: '${SCRIPT_NAME}', icon: 'shapes' })
v.body = [
  Markdown.gallery(['ace-red.png', { src: 'ace-blue.png', caption: 'Blue' }, 'ace-green.png'], { id: 'gallery' }),
  Markdown.mermaid('graph LR\\n  Idea --> Draft --> Done'),
  Markdown.chart({ type: 'bar', xLabels: ['Mon', 'Tue', 'Wed'], series: [{ name: 'Hours', data: [3, 5, 2] }] }),
  Markdown.map({ height: 240, interactive: false, points: [{ coordinates: '56.9496, 24.1052', label: 'Old Town' }] }),
]
await v.open()
`

/** What one rendered surface holds. */
interface Drawn {
  gallery: number
  galleryPictures: number
  diagram: number
  chart: number
  map: number
  callout: number
  math: number
  highlight: string
  noteEmbed: string
  baseEmbed: number
  link: number
  /** Rows the gallery's three pictures take up, and its height over its width. */
  galleryRows: number
  galleryAspect: number
  /** Pixels of the diagram's frame a control covers, on screen. */
  controlsOverDiagram: number
}

interface Report {
  error: string
  chat: Drawn | null
  /** Where pressing the link in the reply took the person. */
  opened: string
  /** Charts and maps still in the document once the chat was gone. */
  leftAfterChat: number
  view: Drawn | null
  leftAfterView: number
  shots: string[]
}

/** Runs in the app. `label` names the pictures: `desktop` or `phone`. */
const probe = (label: string) => `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { if (fn()) return true; await wait(100) }
    return false
  }
  const fs = require('fs')
  const t = window.__abeleTest
  const chats = t.ChatService.getInstance()
  const get = (p) => app.vault.getAbstractFileByPath(p)
  const DIR = ${JSON.stringify(DIR)}
  const CHAT = ${JSON.stringify(CHAT)}
  const FAKE = 'http://abele-e2e-fake-provider.invalid/v1'
  const report = { error: '', chat: null, opened: '', leftAfterChat: -1, view: null, leftAfterView: -1, shots: [] }
  const createdDirs = []
  const realFetch = window.fetch
  const trust = app.loadLocalStorage('mermaid-vault-trust')
  const win = require('@electron/remote').getCurrentWindow()
  fs.mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })

  // Scrolled by hand in its own scroller: \`scrollIntoView\` also moves the chat's outer panes.
  const reveal = (el) => {
    let box = el && el.parentElement
    while (box && !(box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement
    if (box) box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - 8
  }
  const shoot = async (name, el) => {
    if (el) reveal(el)
    await wait(400)
    let img
    try { img = await win.webContents.capturePage() } catch (e) {
      // Electron occasionally refuses the first capture after a resize; the next one works.
      await wait(300)
      img = await win.webContents.capturePage()
    }
    const path = ${JSON.stringify(SHOTS)} + '/' + ${JSON.stringify(label)} + '-' + name + '.png'
    fs.writeFileSync(path, img.toPNG())
    report.shots.push(path)
  }

  const drawn = (el) => {
    const q = (s) => el.querySelectorAll(s).length
    const mark = el.querySelector('mark.abele-highlight')
    return {
      gallery: q('.abele-gallery-widget-container'),
      galleryPictures: [...el.querySelectorAll('.abele-gallery-widget-container img')].filter((i) => i.naturalWidth > 0).length,
      diagram: q('.abele-mermaid__canvas svg'),
      chart: q('.abele-chart-container canvas'),
      map: q('.abele-map canvas'),
      callout: q('.callout'),
      math: q('mjx-container'),
      highlight: mark ? mark.className + ' ' + mark.textContent : '',
      noteEmbed: el.querySelector('.internal-embed.markdown-embed .markdown-embed-content')?.textContent.trim() || '',
      baseEmbed: q('.internal-embed.bases-embed'),
      link: q('a.internal-link[data-href="ACE Note"]'),
      ...measure(el),
    }
  }
  const measure = (el) => {
    const g = el.querySelector('.abele-gallery-widget-container')
    const tops = new Set([...(g ? g.querySelectorAll('.abele-gallery__item') : [])].map((i) => Math.round(i.getBoundingClientRect().top)))
    const gr = g ? g.getBoundingClientRect() : null
    const frame = el.querySelector('.abele-mermaid__frame')
    let covered = 0
    if (frame) {
      const f = frame.getBoundingClientRect()
      for (const c of el.querySelectorAll('.abele-mermaid__controls')) {
        if (Number(getComputedStyle(c).opacity) === 0) continue
        const r = c.getBoundingClientRect()
        const w = Math.min(r.right, f.right) - Math.max(r.left, f.left)
        const h = Math.min(r.bottom, f.bottom) - Math.max(r.top, f.top)
        if (w > 0 && h > 0) covered += Math.round(w * h)
      }
    }
    return {
      galleryRows: tops.size,
      galleryAspect: gr && gr.width ? Math.round((gr.height / gr.width) * 100) / 100 : 0,
      controlsOverDiagram: covered,
    }
  }
  const settled = (el) => {
    const d = drawn(el)
    return d.galleryPictures === 3 && d.chart > 0 && d.map > 0
  }
  // A diagram is drawn when it first comes into view, as in a note: bring it there and wait.
  const diagramDrawn = async (el) => {
    reveal(el.querySelector('.abele-mermaid'))
    await until(() => drawn(el).diagram > 0, 10000)
  }
  const png = async (colour) => {
    const c = document.createElement('canvas')
    c.width = 320; c.height = 200
    const g = c.getContext('2d')
    g.fillStyle = colour; g.fillRect(0, 0, 320, 200)
    return await (await new Promise((r) => c.toBlob(r))).arrayBuffer()
  }

  let session = null
  try {
    app.saveLocalStorage('mermaid-vault-trust', true)
    if (get(DIR)) await app.vault.delete(get(DIR), true)
    await app.vault.createFolder(DIR)
    for (const [name, colour] of [['ace-red', '#d9534f'], ['ace-blue', '#3b7dd8'], ['ace-green', '#3fa66b']])
      await app.vault.createBinary(DIR + '/' + name + '.png', await png(colour))
    await app.vault.create(DIR + '/ACE Note.md', '# A note\\n\\nEmbedded in a reply.')
    await app.vault.create(DIR + '/ACE.base',
      'filters:\\n  and:\\n    - file.inFolder("' + DIR + '")\\nviews:\\n  - type: table\\n    name: Files\\n')
    await wait(500)

    // ── the chat ──
    window.fetch = async (url, init) => {
      if (typeof url !== 'string' || !url.startsWith(FAKE)) return realFetch(url, init)
      const enc = new TextEncoder()
      const chunks = [{ choices: [{ delta: { content: ${JSON.stringify(REPLY)} } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]
      return new Response(new ReadableStream({ start(c) {
        for (const x of chunks) c.enqueue(enc.encode('data: ' + JSON.stringify(x) + '\\n\\n'))
        c.enqueue(enc.encode('data: [DONE]\\n\\n'))
        c.close()
      } }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }
    for (const d of ['AI', 'AI/Chats']) if (!get(d)) { await app.vault.createFolder(d); createdDirs.unshift(d) }
    if (get(CHAT)) await app.vault.delete(get(CHAT))
    const meta = { v: 2, k: 'meta', type: 'abele-chat', title: 'Agent components', providerId: '', modelId: '', created: '2026-09-27' }
    await chats.openChatFile(await app.vault.create(CHAT, JSON.stringify(meta) + '\\n'))
    await chats.revealSidebar()
    session = chats.getSessionByFile(CHAT)
    if (!session) throw new Error('the chat did not open')
    session.resolveModel = () => ({ id: 'fake', name: 'Fake', baseUrl: FAKE, apiKey: 'none', contextWindow: 100000, maxTokens: 1000, supportsReasoning: false })
    for (const k of ['generateTitle', 'generateSummary', 'generateRecap', 'autoCompactIfNeeded']) session.summarizer[k] = async () => undefined
    await session.sendMessage('show me what you have')
    await until(() => !session.isStreaming.value, 10000)

    const reply = () => [...document.querySelectorAll('.abele-chat-msg_assistant')].filter((e) => e.getClientRects().length).pop()
    await until(() => reply() && settled(reply()), 20000)
    const el = reply()
    if (!el) throw new Error('no reply on screen')
    await diagramDrawn(el)
    await wait(800)
    report.chat = drawn(el)
    await shoot('chat-top', el.querySelector('.abele-gallery-widget-container') || el)
    await shoot('chat-diagram', el.querySelector('.abele-mermaid') || el)
    await shoot('chat-chart', el.querySelector('.block-language-abele-chart') || el)
    await shoot('chat-bottom', el.querySelector('.callout') || el)

    // A link in the reply opens the note it names.
    el.querySelector('a.internal-link[data-href="ACE Note"]')?.click()
    await until(() => app.workspace.getActiveFile()?.path === DIR + '/ACE Note.md', 5000)
    report.opened = app.workspace.getActiveFile()?.path || ''
    for (const leaf of app.workspace.getLeavesOfType('markdown'))
      if (leaf.view.file?.path === DIR + '/ACE Note.md') leaf.detach()

    session.abort()
    await chats.deleteChat(session.id)
    session = null
    await wait(500)
    report.leftAfterChat = document.querySelectorAll('.abele-chat-msg .abele-chart-container, .abele-chat-msg .abele-map').length

    // ── the script view ──
    const folder = t.AbeleConfig.getInstance().ai.scriptsFolder
    const path = folder + '/' + ${JSON.stringify(SCRIPT_NAME)} + '.js'
    if (!get(folder)) { await app.vault.createFolder(folder); createdDirs.unshift(folder) }
    if (get(path)) await app.vault.delete(get(path))
    await app.vault.create(path, ${JSON.stringify(SCRIPT)})
    await t.ScriptService.getInstance().discover()
    const script = t.ScriptService.getInstance().getAll().find((s) => s.meta.name === ${JSON.stringify(SCRIPT_NAME)})
    if (!script) throw new Error('the script was not discovered')
    await t.ScriptService.getInstance().execute(script.path, {}, { source: 'command' })
    const live = () => document.querySelector('.abele-script-view_live')
    await until(() => live() && settled(live()), 20000)
    if (!live()) throw new Error('the script view did not open')
    await diagramDrawn(live())
    await wait(800)
    report.view = drawn(live())
    await shoot('view-top', live().querySelector('.abele-gallery-widget-container'))
    await shoot('view-bottom', live().querySelector('.block-language-abele-chart'))
    for (const leaf of app.workspace.getLeavesOfType('abele-script-view')) leaf.detach()
    await wait(500)
    report.leftAfterView = document.querySelectorAll('.abele-chart-container, .abele-map').length
    await app.vault.delete(get(path))
  } catch (e) {
    report.error = String((e && e.stack) || e)
  } finally {
    window.fetch = realFetch
    try {
      if (session) { session.abort(); await chats.deleteChat(session.id) }
      if (get(CHAT)) await app.vault.delete(get(CHAT))
      if (get(DIR)) await app.vault.delete(get(DIR), true)
      for (const d of createdDirs) {
        const f = get(d)
        if (f && f.children && !f.children.length) await app.vault.delete(f, true)
      }
    } catch (e) {
      report.error = report.error || 'cleanup: ' + String((e && e.message) || e)
    }
    app.saveLocalStorage('mermaid-vault-trust', trust ?? null)
  }
  return JSON.stringify(report)
})()`

const windowSize = (): [number, number] =>
  evalJson<[number, number]>(
    `require('@electron/remote').getCurrentWindow().getContentSize()`,
    30_000
  )

const setWindowSize = async (width: number, height: number): Promise<void> => {
  evalRaw(
    `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${width}, ${height}); return 'ok' })()`,
    30_000
  )
  await new Promise((resolve) => setTimeout(resolve, 1500))
}

const available = isObsidianRunning() && hasTestApi() && !onPhone()

/** The same checks for the desktop and the phone's layout. */
function expectEverythingDrawn(get: () => Report) {
  it('got through without an error of its own', () => {
    expect(get().error).toBe('')
  })

  it('draws a gallery, a diagram, a chart and a map in the chat reply', () => {
    expect(get().chat).toMatchObject({
      gallery: 1,
      galleryPictures: 3,
      diagram: 1,
      chart: 1,
      map: 1,
    })
  })

  it('draws a callout, math, a coloured highlight and embeds of a note and a base in it', () => {
    const chat = get().chat!
    expect(chat.callout).toBe(1)
    expect(chat.math).toBeGreaterThan(0)
    expect(chat.highlight).toBe('abele-highlight abele-highlight--green a coloured highlight')
    expect(chat.noteEmbed).toContain('Embedded in a reply.')
    expect(chat.baseEmbed).toBe(1)
  })

  it('opens the note a link in the reply names', () => {
    expect(get().chat!.link).toBe(1)
    expect(get().opened).toBe('Agent components e2e/ACE Note.md')
  })

  it('draws the same four in a script view built with the Markdown factories', () => {
    expect(get().view).toMatchObject({
      gallery: 1,
      galleryPictures: 3,
      diagram: 1,
      chart: 1,
      map: 1,
    })
  })

  it('lays three pictures side by side in a narrow chat, not one under another', () => {
    expect(get().chat!.galleryRows).toBe(1)
    expect(get().chat!.galleryAspect).toBeLessThan(0.5)
  })

  it('puts no control over the diagram where they are always shown', () => {
    // On a computer they show on hover only, which the probe never does.
    expect(get().chat!.controlsOverDiagram).toBe(0)
    expect(get().view!.controlsOverDiagram).toBe(0)
  })

  it('leaves no chart or map behind once the chat and the view are closed', () => {
    expect(get().leftAfterChat).toBe(0)
    expect(get().leftAfterView).toBe(0)
  })
}

describe.skipIf(!available)('what a note shows, in an agent reply and a script view', () => {
  describe('on the desktop', () => {
    let report: Report

    beforeAll(async () => {
      report = JSON.parse(await evalLong(probe('desktop'), 120_000)) as Report
      console.info(
        `\n  vault ...................... ${activeVaultName()}\n  ${report.shots.join('\n  ')}\n  ${JSON.stringify({ ...report, shots: undefined })}\n`
      )
    }, 150_000)

    expectEverythingDrawn(() => report)
  })

  describe('in a phone’s layout', () => {
    let report: Report
    let size: [number, number] = [0, 0]

    beforeAll(async () => {
      size = windowSize()
      await reloadApp('app.emulateMobile(true)')
      await setWindowSize(PHONE.width, PHONE.height)
      report = JSON.parse(await evalLong(probe('phone'), 150_000)) as Report
      console.info(
        `\n  ${report.shots.join('\n  ')}\n  ${JSON.stringify({ ...report, shots: undefined })}\n`
      )
    }, 300_000)

    afterAll(async () => {
      if (!available) return
      // The window first: leaving emulation reloads the app and takes the viewport from the
      // window at that moment, so the other order leaves every later file at a phone's size.
      if (size[0]) await setWindowSize(size[0], size[1])
      await reloadApp('app.emulateMobile(false)')
    }, 120_000)

    expectEverythingDrawn(() => report)
  })
})
