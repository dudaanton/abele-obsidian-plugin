/**
 * Replying to the agent's words in the running app, on a computer and under `emulateMobile` at
 * 390×844: Reply puts a card for the place on a line of its own in the composer where the cursor
 * is, several with the person's words between them; the sent question draws each card in the
 * same place, the way back to its words; a card whose message is on another branch is faint. The
 * agent is given links over the words, never its own words again.
 *
 * The chat is synthetic and no model is asked: the session's turn is replaced by one that does
 * nothing, after the question and what the agent would be given are recorded. Pictures go to
 * `abele-reply/<screen>-*.png`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  evalJson,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  phoneEntry,
  reloadApp,
  runCli,
} from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'

targets('desktop')
const available = isObsidianRunning() && hasTestApi()
const CHAT = 'AI/Chats/Abele reply probe.abchat'
const PHONE = { width: 390, height: 844 }
const SHOTS = shotDir('abele-reply')

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

interface Report {
  error?: string
  /** The question already in the chat: its cards' words, which is faint, the words around them. */
  sent: { cards: string[]; gone: boolean[]; line: string[] }
  /** Pressing its first card flashed the words it replies to. */
  revealed: boolean
  /** The composer's cards after each reply: the whole answer, its words, the same place again. */
  composer: number[]
  /** The composer's text with the cards drawn: none of the token shows. */
  composerText: string
  question?: { content: string; replyTo: { messageId: string; at: number; start?: number }[] }
  /** What the agent is given for the new question. */
  given: string
  /** The new question as drawn: its cards' words and the words around them. */
  drawn: { cards: string[]; text: string }
  leftBehind: boolean
}

const script = (screen: 'desktop' | 'phone') => `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 8000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v } catch {} await wait(50) }
    return null
  }
  const phone = ${JSON.stringify(screen)} === 'phone'
  const shoot = async (name) => {
    await wait(300)
    const img = await Promise.race([require('@electron/remote').getCurrentWebContents().capturePage(), wait(8000).then(() => null)])
    if (img) { require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true }); require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/' + ${JSON.stringify(screen)} + '-' + name + '.png', img.toPNG()) }
  }
  const cdp = require('@electron/remote').getCurrentWebContents().debugger
  const tap = async (el) => {
    const r = el.getBoundingClientRect()
    const touch = (type) => cdp.sendCommand('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }] })
    await touch('touchStart'); await wait(60); await touch('touchEnd')
  }
  const chats = window.__abeleTest.ChatService.getInstance()
  const CHAT = ${JSON.stringify(CHAT)}
  const report = { sent: { cards: [], gone: [], line: [] }, revealed: false, composer: [], composerText: '', given: '', drawn: { cards: [], text: '' }, leftBehind: true }
  const pane = () => [...document.querySelectorAll('.abele-ai-chat')].find((el) => el.getBoundingClientRect().width)
  const message = (id) => pane()?.querySelector('[data-message-id="' + id + '"]')
  const words = (id) => message(id)?.querySelector('[data-find-part="content"]')
  const cardsIn = (el) => [...(el?.querySelectorAll('.abele-chat-reply-card') ?? [])]
  const composerCards = () => cardsIn(pane()?.querySelector('.abele-chat-input'))
  const select = (id, from, to) => {
    const md = words(id)
    const walker = document.createTreeWalker(md, NodeFilter.SHOW_TEXT)
    let node; while ((node = walker.nextNode()) && !node.nodeValue.includes(from));
    const r = document.createRange()
    r.setStart(node, node.nodeValue.indexOf(from)); r.setEnd(node, node.nodeValue.indexOf(to) + to.length)
    const s = document.getSelection(); s.removeAllRanges(); s.addRange(r)
    return { md, r }
  }
  const type = (words) => {
    const composer = window.__abeleTest.composer()
    const view = window.__abeleTest.noteFieldView(composer.field)
    const end = view.state.doc.length
    view.dispatch({ changes: { from: end, insert: words }, selection: { anchor: end + words.length }, userEvent: 'input.type' })
  }
  // Reply to words selected in an answer: its menu on a computer, the bar under them on a phone.
  const replyToWords = async (id, from, to) => {
    const { md, r } = select(id, from, to)
    if (phone) {
      const end = r.getBoundingClientRect()
      const touch = (type) => cdp.sendCommand('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(end.left + 2), y: Math.round((end.top + end.bottom) / 2) }] })
      await touch('touchStart'); await wait(400); select(id, from, to); await touch('touchEnd')
      const bar = await until(() => document.querySelector('.abele-chat-selection.abele-chat-selection_placed button[aria-label="Reply"]'), 4000)
      if (!bar) throw new Error('no Reply in the bar under the words')
      await tap(bar)
    } else {
      const box = r.getBoundingClientRect()
      md.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: box.left + 2, clientY: box.top + 2 }))
      const item = await until(() => [...document.querySelectorAll('.menu .menu-item')].find((i) => i.textContent.trim() === 'Reply'), 3000)
      if (!item) throw new Error('no Reply in the menu of the words')
      item.click()
    }
    document.getSelection().removeAllRanges()
    await wait(300)
  }
  // Reply to a whole answer: from its line on a computer, from its ⋯ on a phone.
  const replyToAll = async (id) => {
    if (phone) {
      message(id).querySelector('button[aria-label="More message actions"]').click()
      const item = await until(() => [...document.querySelectorAll('.menu .menu-item')].find((i) => i.textContent.trim() === 'Reply'), 3000)
      if (!item) throw new Error('no Reply in the message menu')
      item.click()
    } else message(id).querySelector('button[aria-label="Reply to this"]').click()
    await wait(300)
  }

  try {
    for (const dir of ['AI', 'AI/Chats']) if (!app.vault.getAbstractFileByPath(dir)) await app.vault.createFolder(dir)
    const stale = app.vault.getAbstractFileByPath(CHAT)
    if (stale) await app.vault.delete(stale)
    const at = 1790000000000
    const train = 'Take the night train from the capital: it leaves late, arrives in the morning, and the station is a short walk from the old town.'
    const records = [
      { v: 2, k: 'meta', type: 'abele-chat', title: 'Reply probe', providerId: '', modelId: '', created: '2026-10-15', activeLeafId: 'a2' },
      { k: 'msg', id: 'u1', role: 'user', content: 'How do I get to the coast?', timestamp: at },
      { k: 'msg', id: 'a0', parentId: 'u1', role: 'assistant', content: 'An older answer on another branch: go by bus.', timestamp: at + 500 },
      { k: 'msg', id: 'a1', parentId: 'u1', role: 'assistant', content: train, timestamp: at + 1000 },
      { k: 'msg', id: 'u2', parentId: 'a1', role: 'user', content: 'Why so late?\\nAnd the bus?', timestamp: at + 2000,
        replyTo: [
          { messageId: 'a1', quote: 'it leaves late', start: train.indexOf('it leaves late'), at: 0 },
          { messageId: 'a0', quote: 'An older answer on another branch: go by bus.', at: 13 },
        ] },
      { k: 'msg', id: 'a2', parentId: 'u2', role: 'assistant', content: 'The late train is the only one that is direct. The bus takes longer and changes twice.', timestamp: at + 3000 },
    ]
    const file = await app.vault.create(CHAT, records.map((r) => JSON.stringify(r)).join('\\n') + '\\n')
    await chats.openChatFile(file)
    await chats.revealSidebar()
    if (!(await until(() => words('a2') && cardsIn(message('u2')).length === 2))) throw new Error('the chat is not on screen')
    await wait(600)
    const session = chats.activeSession.value

    // The question already sent: its cards where they were put, one faint.
    const sent = cardsIn(message('u2'))
    report.sent.cards = sent.map((c) => c.textContent.trim())
    report.sent.gone = sent.map((c) => c.classList.contains('abele-chat-reply-card_gone'))
    const holder = sent[0].closest('.abele-chat-reply-inline').parentElement
    report.sent.line = [...holder.childNodes].map((n) => n.nodeType === 3 ? n.nodeValue.trim() : n.classList?.contains('abele-chat-reply-inline') ? '[card]' : n.textContent.trim()).filter(Boolean)
    message('u2').scrollIntoView({ block: 'center' })
    await shoot('gone')
    sent[0].click()
    report.revealed = !!(await until(() => words('a1')?.querySelector('.abele-footnote-flash'), 3000))

    // Replying: the whole last answer, words of the first, the same whole answer again.
    await replyToAll('a2')
    report.composer.push(composerCards().length)
    await shoot('one-card')
    type('Is that the only way?')
    await replyToWords('a1', 'arrives', 'morning')
    report.composer.push(composerCards().length)
    type('Early enough?')
    await replyToWords('a2', 'changes', 'twice')
    report.composer.push(composerCards().length)
    type('Where?')
    await replyToAll('a2')
    report.composer.push(composerCards().length)
    report.composerText = window.__abeleTest.composer().field.querySelector('.cm-content')?.textContent ?? ''
    await shoot('three-cards')

    // Sent: recorded, and no model asked.
    session.runAgentLoop = async () => {}
    session.afterTurn = async () => {}
    const before = session.allChatMessages.length
    pane().querySelector('.abele-chat-input__send').click()
    const question = await until(() => session.allChatMessages.length > before && session.allChatMessages.at(-1))
    if (!question) throw new Error('the question was not sent')
    report.question = { content: question.content, replyTo: question.replyTo ?? [] }
    const given = await until(() => session.allInternalMessages.find((m) => m.chatMessageId === question.id), 4000)
    report.given = typeof given?.content === 'string' ? given.content : (given?.content ?? []).map((p) => p.text ?? '').join('')
    await until(() => cardsIn(message(question.id)).length === 3, 4000)
    report.drawn = { cards: cardsIn(message(question.id)).map((c) => c.textContent.trim()), text: words(question.id)?.textContent ?? '' }
    message(question.id).scrollIntoView({ block: 'center' })
    await shoot('sent')
  } catch (e) {
    report.error = String((e && e.stack) || e)
  } finally {
    try {
      document.getSelection().removeAllRanges()
      const chat = chats.getSessionByFile(CHAT)
      if (chat) await chats.deleteChat(chat.id)
      const f = app.vault.getAbstractFileByPath(CHAT)
      if (f) await app.vault.delete(f)
      report.leftBehind = !!app.vault.getAbstractFileByPath(CHAT)
    } catch (e) {
      report.error = report.error || 'cleanup: ' + String((e && e.message) || e)
    }
  }
  return JSON.stringify(report)
})()`

const checks = (screen: 'desktop' | 'phone', get: () => Report) => {
  it(`${screen}: got through without an error of its own`, () => {
    expect(get().error).toBeUndefined()
  })

  it(`${screen}: draws a sent question's cards in their places, one from another branch faint`, () => {
    const { sent, revealed } = get()
    expect(sent.cards).toEqual(['it leaves late', 'An older answer on another branch: go by bus.'])
    expect(sent.gone).toEqual([false, true])
    expect(sent.line).toEqual(['[card]', 'Why so late?', '[card]', 'And the bus?'])
    expect(revealed).toBe(true)
  })

  it(`${screen}: puts a card in the composer for each place, the same place once`, () => {
    expect(get().composer).toEqual([1, 2, 3, 3])
    expect(get().composerText).not.toMatch(/[]/)
    expect(get().composerText).toContain('Early enough?')
  })

  it(`${screen}: sends the words with each place where it stood`, () => {
    const q = get().question!
    expect(q.content).toBe('\nIs that the only way?\n\nEarly enough?\n\nWhere?')
    expect(q.replyTo.map((to) => [to.messageId, to.at, to.start !== undefined])).toEqual([
      ['a2', 0, false],
      ['a1', 23, true],
      ['a2', 38, true],
    ])
  })

  it(`${screen}: gives the agent links over the words, not its words again`, () => {
    const given = get().given
    expect(given.startsWith('<reply-links>\n')).toBe(true)
    expect(given).toMatch(/\[reply 1\] message a2, the whole message, begins: The late train is/)
    expect(given).toMatch(
      /\[reply 2\] message a1, characters \d+-\d+, begins: arrives in the morning/
    )
    expect(given).not.toContain('changes twice. ')
    expect(given).not.toContain('short walk')
  })

  it(`${screen}: draws the sent question's cards among its words, and leaves nothing behind`, () => {
    const { drawn, leftBehind } = get()
    expect(drawn.cards).toHaveLength(3)
    expect(drawn.text).toContain('Early enough?')
    expect(drawn.text).not.toMatch(/[]/)
    expect(leftBehind).toBe(false)
  })
}

describe.runIf(available)('replying to the agent’s words', () => {
  let desktop: Report
  let phone: Report
  let size: [number, number] = [0, 0]

  beforeAll(async () => {
    size = windowSize()
    desktop = evalAsync<Report>(script('desktop'), 120_000)
    await reload(phoneEntry(PHONE.width, PHONE.height))
    phone = evalAsync<Report>(script('phone'), 120_000)
  }, 360_000)

  afterAll(async () => {
    if (evalJson<boolean>('app.isMobile')) await reload('app.emulateMobile(false)')
    if (size[0]) await setWindowSize(size[0], size[1])
  }, 180_000)

  checks('desktop', () => desktop)
  checks('phone', () => phone)
})
