/**
 * "Ask here" inside a comment, in the running app, three levels down and back.
 *
 * A chat with one exchange is written into the vault and opened in the sidebar. Words of its
 * answer are selected and asked about through the message's own action row, the way a phone
 * reaches it; the comment that opens gets a line kept as a note (no model is called — a note is
 * the person's own message, which "Ask here" works on too); words of that line are asked about
 * in turn, and once more inside that. At every level the trail over the messages is read, and
 * the files are read for what they say about each other. Then the trail is used to go back up
 * one level, where the passage has to be marked, and its icon has to bring the child back.
 *
 * Everything the run writes is deleted by deleting the chat, which is also the check that the
 * whole tree goes with it. Requires Obsidian running on a vault with the development build —
 * see docs/Testing.md.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { isObsidianRunning, hasTestApi, evalRaw } from './helpers/obsidianCli'

const CHAT = 'AI/Chats/Abele nested ask probe.abchat'
const SHOTS = '/tmp/abele-nested'

interface Level {
  id: string
  anchorNote: string
  quote: string
  /** The trail's levels as drawn over the messages, outermost first. */
  trail: string[]
  /** The ids the comment's own file lists as asked on its messages, read after the next level. */
  listed: string[]
}

interface Report {
  levels: Level[]
  /** After pressing the second level of the trail: which comment the tab holds. */
  backTo: string
  /** The passage marked in that comment's message, and the ids its icon carries. */
  markedQuote: string
  markerIds: string
  /** After pressing that icon: which comment the tab holds. */
  reopened: string
  /** The comment files still there after the chat was deleted. */
  leftBehind: string[]
  shots: string[]
  error: string
}

const script = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (fn()) return true
      await wait(100)
    }
    return false
  }
  const fs = require('fs')
  const win = require('@electron/remote').getCurrentWindow()
  fs.mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
  const chats = window.__abeleTest.ChatService.getInstance()
  const service = window.__abeleTest.CommentService.getInstance()
  const CHAT = ${JSON.stringify(CHAT)}
  const report = { levels: [], backTo: '', markedQuote: '', markerIds: '', reopened: '', leftBehind: [], shots: [], error: '' }
  const made = []
  const createdDirs = []

  const shoot = async (label) => {
    await wait(300)
    const img = await win.webContents.capturePage()
    const path = ${JSON.stringify(SHOTS)} + '/' + label + '.png'
    fs.writeFileSync(path, img.toPNG())
    report.shots.push(path)
  }

  const row = (id) => document.querySelector('.abele-ai-chat [data-message-id="' + id + '"]')
  const trail = () =>
    [...document.querySelectorAll('.abele-ai-chat .abele-breadcrumbs__item')].map((el) => el.textContent.trim())

  /** Selects the words in a rendered message and presses "Ask here" in its action row. */
  const askOn = async (messageId, words) => {
    if (!(await until(() => row(messageId) && row(messageId).querySelector('.abele-markdown'), 5000)))
      throw new Error('message ' + messageId + ' is not on screen')
    const el = row(messageId)
    const md = el.querySelector('.abele-markdown')
    const walker = document.createTreeWalker(md, NodeFilter.SHOW_TEXT)
    let node = null
    while (walker.nextNode()) {
      if (walker.currentNode.nodeValue.indexOf(words) !== -1) { node = walker.currentNode; break }
    }
    if (!node) throw new Error('no "' + words + '" in message ' + messageId)
    const at = node.nodeValue.indexOf(words)
    const range = document.createRange()
    range.setStart(node, at)
    range.setEnd(node, at + words.length)
    const selection = document.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)

    const icon = el.querySelector('.abele-chat-msg__icon')
    icon.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    icon.click()
    await wait(200)
    const action = [...el.querySelectorAll('.abele-chat-msg__branch-action')].find((a) => a.textContent.trim() === 'Ask here')
    if (!action) throw new Error('no Ask here on message ' + messageId)
    action.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    const before = chats.activeSession.value
    action.click()
    if (!(await until(() => chats.activeSession.value !== before && chats.activeSession.value.kind === 'comment', 8000)))
      throw new Error('Ask here on ' + messageId + ' opened nothing')
    const session = chats.activeSession.value
    made.push(session.commentId)
    return session
  }

  /** Keeps a line in the comment as the person's own message, which is what the next level asks about. */
  const say = async (session, text) => {
    await session.addUserNote(text)
    const msg = session.messages.value.find((m) => m.role === 'user' && m.content === text)
    if (!msg) throw new Error('the note was not kept')
    return msg.id
  }

  const level = async (session, depth) => {
    await until(() => trail().length === depth, 5000)
    const anchor = session.anchor.value
    return { id: session.commentId, anchorNote: anchor.note, quote: anchor.quote || '', trail: trail(), listed: [] }
  }

  const listed = async (id) => {
    const file = app.vault.getAbstractFileByPath(service.commentPath(id))
    if (!file) return []
    const lines = (await app.vault.read(file)).split('\\n').filter((l) => l.includes('"k":"meta"'))
    const meta = JSON.parse(lines[lines.length - 1])
    return (meta.comments || []).map((c) => c.id)
  }

  try {
    for (const dir of ['AI', 'AI/Chats']) {
      if (!app.vault.getAbstractFileByPath(dir)) { await app.vault.createFolder(dir); createdDirs.unshift(dir) }
    }
    const commentDirs = service.commentPath('x').split('/').slice(0, -1)
    for (let i = 1; i <= commentDirs.length; i++) {
      const dir = commentDirs.slice(0, i).join('/')
      if (!app.vault.getAbstractFileByPath(dir)) createdDirs.unshift(dir)
    }
    const stale = app.vault.getAbstractFileByPath(CHAT)
    if (stale) await app.vault.delete(stale)
    const meta = { v: 2, k: 'meta', type: 'abele-chat', title: 'Nested ask probe', providerId: '', modelId: '', created: '2026-09-25' }
    const u1 = { k: 'msg', id: 'u1', role: 'user', content: 'How do I get to Riga?', timestamp: 1790000000000 }
    const a1 = { k: 'msg', id: 'a1', role: 'assistant', parentId: 'u1', content: 'Take the night train from Vilnius, it arrives in the morning.', timestamp: 1790000001000 }
    const file = await app.vault.create(CHAT, [meta, u1, a1].map((r) => JSON.stringify(r)).join('\\n') + '\\n')

    await chats.openChatFile(file)
    await chats.revealSidebar()

    const first = await askOn('a1', 'night train')
    report.levels.push(await level(first, 2))
    const firstLine = await say(first, 'Which train exactly leaves at night?')

    const second = await askOn(firstLine, 'Which train')
    report.levels.push(await level(second, 3))
    const secondLine = await say(second, 'Is there a sleeping car on it?')

    const third = await askOn(secondLine, 'sleeping car')
    report.levels.push(await level(third, 4))
    await shoot('desktop-level3')

    for (const l of report.levels) l.listed = await listed(l.id)

    // Back up one level through the trail: chat, first, second, third — the third item.
    const crumbs = [...document.querySelectorAll('.abele-ai-chat .abele-breadcrumbs__item')]
    crumbs[2].click()
    await until(() => chats.activeSession.value && chats.activeSession.value.commentId === second.commentId, 5000)
    report.backTo = chats.activeSession.value ? chats.activeSession.value.commentId : ''
    await until(() => row(secondLine) && row(secondLine).querySelector('.abele-comment__quote'), 5000)
    const r = row(secondLine)
    report.markedQuote = r ? [...r.querySelectorAll('.abele-comment__quote')].map((q) => q.textContent).join('') : ''
    const marker = r && r.querySelector('.abele-comment-marker')
    report.markerIds = marker ? marker.getAttribute('data-comment-ids') : ''
    await shoot('desktop-back-to-level2')

    if (marker) {
      marker.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await until(() => chats.activeSession.value && chats.activeSession.value.commentId === third.commentId, 5000)
      report.reopened = chats.activeSession.value ? chats.activeSession.value.commentId : ''
    }
  } catch (e) {
    report.error = String((e && e.message) || e)
  } finally {
    try {
      const chat = chats.getSessionByFile(CHAT)
      if (chat) await chats.deleteChat(chat.id)
      else {
        await service.removeCommentsOn(CHAT)
        const f = app.vault.getAbstractFileByPath(CHAT)
        if (f) await app.vault.delete(f)
      }
      report.leftBehind = made.filter((id) => id && app.vault.getAbstractFileByPath(service.commentPath(id)))
      for (const id of report.leftBehind) {
        const f = app.vault.getAbstractFileByPath(service.commentPath(id))
        if (f) await app.vault.delete(f)
      }
      for (const dir of createdDirs) {
        const d = app.vault.getAbstractFileByPath(dir)
        if (d && d.children && !d.children.length) await app.vault.delete(d, true)
      }
    } catch (e) {
      report.error = report.error || 'cleanup: ' + String((e && e.message) || e)
    }
  }
  return report
})()`

const available = isObsidianRunning() && hasTestApi()

describe.runIf(available)('asking inside a comment, three levels down', () => {
  let report: Report

  beforeAll(() => {
    report = JSON.parse(evalRaw(script, 120_000)) as Report
    console.info(`\n  shots: ${report.shots.join(', ')}\n`)
  }, 180_000)

  it('got through without an error of its own', () => {
    expect(report.error).toBe('')
  })

  it('opened a comment at every level, each hung on the one above', () => {
    const [first, second, third] = report.levels
    expect(report.levels).toHaveLength(3)
    expect(first.anchorNote).toBe(CHAT)
    expect(first.quote).toBe('night train')
    expect(second.anchorNote).toMatch(new RegExp(`/${first.id}\\.abchat$`))
    expect(second.quote).toBe('Which train')
    expect(third.anchorNote).toMatch(new RegExp(`/${second.id}\\.abchat$`))
  })

  it('wrote each child into its parent’s own file', () => {
    const [first, second, third] = report.levels
    expect(first.listed).toEqual([second.id])
    expect(second.listed).toEqual([third.id])
    expect(third.listed).toEqual([])
  })

  it('drew the trail one level longer at every depth', () => {
    const [first, second, third] = report.levels
    expect(first.trail).toEqual(['Nested ask probe', 'night train'])
    expect(second.trail).toEqual([
      'Nested ask probe',
      'Which train exactly leaves at night?',
      'Which train',
    ])
    expect(third.trail).toHaveLength(4)
    expect(third.trail[0]).toBe('Nested ask probe')
  })

  it('goes back a level through the trail, the passage marked there', () => {
    expect(report.backTo).toBe(report.levels[1].id)
    expect(report.markedQuote).toBe('sleeping car')
    expect(report.markerIds).toBe(report.levels[2].id)
  })

  it('brings the child back when the marked passage’s icon is pressed', () => {
    expect(report.reopened).toBe(report.levels[2].id)
  })

  it('took the whole tree with the chat when it was deleted', () => {
    expect(report.leftBehind).toEqual([])
  })
})
