/**
 * Every dialog of the chat, and the icon picker, on a phone.
 *
 * The 1.18.0 settings dialog shipped with its tab strip on two rows, the skills list a box in
 * the top half of an otherwise empty sheet, and a width rule reaching the dialog from inside
 * one of its tabs. Every one of those had been looked at — on a desktop, at a desktop width.
 * Nothing had asked the question at the size a phone asks it, and happy-dom cannot: it computes
 * no layout at all.
 *
 * So the question is asked here, geometrically, of the running app in the layout Obsidian
 * gives a phone (`app.emulateMobile(true)`) in a phone-sized window (390×844, an iPhone's
 * points). For every screen:
 *
 * - nothing reaches past the right edge of the screen it is on;
 * - at most one thing scrolls inside the body — nested scrollers are the sign of a box that was
 *   sized for a small window and is now standing inside a sheet the height of the screen;
 * - whatever does scroll reaches the bottom of the body rather than leaving a blank half-screen
 *   under it, which is what a `max-height` written for a desktop dialog looks like on a phone;
 * - a sheet stands the height of the screen.
 *
 * And a picture of each screen is written to `/tmp/abele-phone/`, because a measurement says
 * that nothing is broken in the ways listed and a person looking at the picture says whether
 * it is right. Look at them before a release. They are never committed.
 *
 * `emulateMobile` reloads the app, which takes any JS state with it, so the run is separate
 * `eval` calls: switch, resize, probe, restore. See `commentChats.e2e.test.ts` for the same
 * shape and why. Requires Obsidian running on a vault with the development build — see
 * docs/Testing.md.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  activeVaultName,
  evalJson,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
} from './helpers/obsidianCli'

const PHONE = { width: 390, height: 844 }
const SHOTS = '/tmp/abele-phone'

interface Screen {
  /** Class names of elements past the right edge of the root, with how far past. */
  over: string[]
  /** Everything inside the body that scrolls, with the space left blank under it. */
  scrollers: { name: string; height: number; spare: number }[]
  /** Scrolling boxes with a fixed ceiling lower than the body they stand in. */
  capped: string[]
  /** Cards whose actions were pushed onto a row of their own, below the title. */
  stranded: string[]
  /** Ancestors that cut the focus ring of the field the screen focused, with how much of it. */
  clipped: string[]
  /** The root's height as a share of the window's. */
  fill: number
  /** Where the picture went. */
  shot: string
  error: string
}

type Report = Record<string, Screen>

/** `evalRaw` for a script that resolves to a JSON-serializable value, parsed directly. */
const evalAsync = <T>(script: string, timeoutMs: number): T =>
  JSON.parse(evalRaw(script, timeoutMs)) as T

const probeScript = `(async () => {
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

  const name = (el) => ((el.className || el.tagName) + '').split(' ')[0].slice(0, 48)

  const measure = (root, body) => {
    const box = root.getBoundingClientRect()
    const edge = Math.min(box.right, window.innerWidth)
    const over = []
    const walk = (el) => {
      const s = getComputedStyle(el)
      if (s.visibility === 'hidden' || s.display === 'none' || s.position === 'absolute') return
      if (el.classList.contains('is-measuring')) return
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.right > edge + 1) over.push(name(el) + ' +' + Math.round(r.right - edge))
      // What a row that scrolls sideways holds is meant to reach past its edge; the row is not.
      if (s.overflowX === 'auto' || s.overflowX === 'scroll') return
      for (const c of el.children) walk(c)
    }
    for (const c of root.children) walk(c)

    const host = body || root
    const hostBox = host.getBoundingClientRect()
    const scrollers = []
    const capped = []
    for (const el of host.querySelectorAll('*')) {
      const s = getComputedStyle(el)
      if (s.overflowY !== 'auto' && s.overflowY !== 'scroll') continue
      // A scrolling box with a fixed ceiling lower than the sheet was sized for another
      // dialog; on a phone it is the list in the top half of an empty screen.
      const ceiling = parseFloat(s.maxHeight)
      if (s.maxHeight.endsWith('px') && ceiling < hostBox.height - 1) capped.push(name(el) + ' ' + Math.round(ceiling) + 'px')
      if (el.scrollHeight <= el.clientHeight + 1) continue
      const r = el.getBoundingClientRect()
      if (r.height === 0) continue
      scrollers.push({ name: name(el), height: Math.round(r.height), spare: Math.round(hostBox.bottom - r.bottom) })
    }

    // A card's actions belong on the row of its title. A title long enough to wrap took the
    // whole row and pushed the delete icon onto a line of its own, between title and summary.
    const stranded = []
    for (const actions of root.querySelectorAll('.abele-card__actions')) {
      const title = actions.parentElement && actions.parentElement.querySelector('.abele-card__title')
      if (!title) continue
      if (actions.getBoundingClientRect().top >= title.getBoundingClientRect().bottom - 1) {
        stranded.push(title.textContent.trim().slice(0, 40))
      }
    }

    return { over, scrollers, capped, stranded, fill: Math.round((box.height / window.innerHeight) * 100) / 100 }
  }

  /**
   * The ancestors that cut a focused field's ring. The ring is a box-shadow drawn outside the
   * field's box, so every ancestor that clips has to leave room for its blur and spread; the
   * dialog's mount point did not, and the search field lost 2px off each side on a phone.
   */
  const ringClipped = (field) => {
    const nums = (getComputedStyle(field).boxShadow.match(/-?\\d+(\\.\\d+)?px/g) || []).map(parseFloat)
    const reach = nums.length >= 4 ? Math.max(0, nums[2]) + Math.max(0, nums[3]) : 0
    const r = field.getBoundingClientRect()
    const ring = { left: r.left - reach, right: r.right + reach, top: r.top - reach, bottom: r.bottom + reach }
    const cut = []
    for (let el = field.parentElement; el && el !== document.documentElement; el = el.parentElement) {
      const cs = getComputedStyle(el)
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue
      const b = el.getBoundingClientRect()
      const left = b.left + el.clientLeft, top = b.top + el.clientTop
      const box = { left, top, right: left + el.clientWidth, bottom: top + el.clientHeight }
      // The sides only: a scrolling body may legitimately have a field below its fold.
      const by = Math.max(box.left - ring.left, ring.right - box.right)
      if (by > 0.5) cut.push(name(el) + ' ' + Math.round(by) + 'px')
    }
    return cut
  }

  const shoot = async (label) => {
    // A hidden or backgrounded window runs no animations: a dialog measured mid-slide-in reads
    // where it started from. Nothing here waits on one.
    for (const el of document.querySelectorAll('.modal, .modal-container')) el.style.transition = 'none'
    await wait(400)
    let img
    try {
      img = await win.webContents.capturePage()
    } catch (error) {
      // Electron occasionally answers the first capture after a resize with UnknownVizError;
      // every later dialog capture succeeds. Retry the same screen rather than losing it.
      if (!String(error && error.message).includes('UnknownVizError')) throw error
      await wait(300)
      img = await win.webContents.capturePage()
    }
    const path = ${JSON.stringify(SHOTS)} + '/' + label.replace(/[^a-z0-9]+/gi, '-') + '.png'
    fs.writeFileSync(path, img.toPNG())
    return path
  }

  const report = {}
  const screen = async (label, root, body) => {
    const entry = { over: [], scrollers: [], capped: [], stranded: [], clipped: [], fill: 0, shot: '', error: '' }
    try {
      if (!root) throw new Error('nothing to measure')
      entry.shot = await shoot(label)
      Object.assign(entry, measure(root, body))
    } catch (e) {
      entry.error = String((e && e.message) || e)
    }
    report[label] = entry
  }

  // Obsidian draws no .modal-close-button on a phone; Escape closes a dialog everywhere. A
  // picker is a \`.prompt\` in a modal container rather than a \`.modal\`, and a menu neither.
  const closeDialog = async () => {
    if (!document.querySelector('.modal, .modal-container .prompt, .menu')) return
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })
    )
    await until(() => !document.querySelector('.modal, .modal-container .prompt, .menu'), 3000)
  }

  // Lists worth measuring: a vault with two skills shows nothing about how a list of twenty
  // stands in a sheet. These are written for the run and removed after it.
  const SEEDED = []
  const SEEDED_DIRS = []
  // An MCP server with a few tools, in memory only: the chat's tools tab shows its group and
  // switch, and the settings' MCP tab has a card to open. Put back as it was by \`unseed\`.
  const mcpConfig = window.__abeleTest.AbeleConfig.getInstance()
  const MCP_BEFORE = mcpConfig.ai.mcpServers
  const seed = async () => {
    const lorem = 'Reads a page of the documentation for a library and returns it as markdown, with the examples kept whole.'
    mcpConfig.ai = { ...mcpConfig.ai, mcpServers: [{
      id: 'phone-probe', name: 'context7', url: 'https://mcp.context7.com/mcp', enabled: true,
      keyId: '', headers: { 'X-Team': 'docs' }, fetchedAt: new Date().toISOString(),
      tools: ['resolve-library-id', 'get-library-docs', 'search'].map((name) => ({
        name, description: lorem, inputSchema: { type: 'object', properties: {} },
      })),
    }] }
    const folder = 'Phone probe'
    if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder)
    for (let i = 1; i <= 12; i++) {
      const path = folder + '/probe-skill-' + i + '.md'
      const body = '---\\ntype: abele-skill\\nname: probe-skill-' + i +
        '\\ndescription: A skill written by the phone layout probe, number ' + i +
        ', with a description long enough to wrap onto a second line on a phone.\\n---\\n'
      await app.vault.create(path, body)
      SEEDED.push(path)
    }
    for (let i = 1; i <= 8; i++) {
      const path = folder + '/Probe prompt ' + i + '.md'
      const body = '---\\ntype: abele-prompt\\ndescription: A prompt written by the phone layout probe, number ' + i + '.\\n---\\nAsk about {{topic}}.\\n'
      await app.vault.create(path, body)
      SEEDED.push(path)
    }
    // A chat whose title wraps on a phone, for the history's cards.
    for (const dir of ['AI', 'AI/Chats']) {
      if (!app.vault.getAbstractFileByPath(dir)) {
        await app.vault.createFolder(dir)
        SEEDED_DIRS.unshift(dir)
      }
    }
    const title = 'Phone probe chat with a title long enough to wrap onto a second and third line'
    const chatPath = 'AI/Chats/' + title + '.abchat'
    const meta = { v: 2, k: 'meta', type: 'abele-chat', created: '2026-09-20T10:00:00Z', title,
      summary: 'A summary under the title, as the history shows it.' }
    const msg = { k: 'msg', id: 'p0', role: 'user', content: 'Hello', timestamp: 1790000000000 }
    await app.vault.create(chatPath, JSON.stringify(meta) + '\\n' + JSON.stringify(msg) + '\\n')
    SEEDED.push(chatPath)
    // Until the metadata cache has read the last of them, or the picker lists nothing new.
    await until(() => {
      const last = app.vault.getAbstractFileByPath(SEEDED[SEEDED.length - 2])
      return !!(last && app.metadataCache.getFileCache(last)?.frontmatter)
    }, 10000)
    // A comment asked inside a comment on a chat's answer, for the trail over its messages: the
    // levels carry long questions, which is what a phone has to wrap. After the wait above,
    // which counts from the end of the list.
    const comments = window.__abeleTest.CommentService.getInstance()
    const commentDir = comments.commentPath('x').split('/').slice(0, -1)
    for (let i = 1; i <= commentDir.length; i++) {
      const dir = commentDir.slice(0, i).join('/')
      if (!app.vault.getAbstractFileByPath(dir)) {
        await app.vault.createFolder(dir)
        SEEDED_DIRS.unshift(dir)
      }
    }
    const line = (r) => JSON.stringify(r)
    const nestedChat = 'AI/Chats/Phone probe nested ask.abchat'
    await app.vault.create(nestedChat, [
      line({ v: 2, k: 'meta', type: 'abele-chat', created: '2026-09-25', title: 'Getting from Vilnius to Riga by train',
        comments: [{ id: 'pnest1', message: 'na1', quote: 'night train', start: 9 }] }),
      line({ k: 'msg', id: 'nu1', role: 'user', content: 'How do I get to Riga?', timestamp: 1790000000000 }),
      line({ k: 'msg', id: 'na1', role: 'assistant', parentId: 'nu1', content: 'Take the night train from Vilnius.', timestamp: 1790000001000 }),
    ].join('\\n') + '\\n')
    SEEDED.push(nestedChat)
    const first = comments.commentPath('pnest1')
    await app.vault.create(first, [
      line({ v: 2, k: 'meta', type: 'abele-chat', kind: 'comment', created: '2026-09-25',
        anchor: { note: nestedChat, quote: 'night train', message: 'na1' },
        comments: [{ id: 'pnest2', message: 'p1a', quote: 'couchette', start: 25 }] }),
      line({ k: 'msg', id: 'p1u', role: 'user', content: 'Which train exactly, and does it have sleeping cars?', timestamp: 1790000002000 }),
      line({ k: 'msg', id: 'p1a', role: 'assistant', parentId: 'p1u', content: 'The Baltic Express, with couchette and sleeper cars.', timestamp: 1790000003000 }),
    ].join('\\n') + '\\n')
    SEEDED.push(first)
    const second = comments.commentPath('pnest2')
    await app.vault.create(second, [
      line({ v: 2, k: 'meta', type: 'abele-chat', kind: 'comment', created: '2026-09-25',
        anchor: { note: first, quote: 'couchette', message: 'p1a' },
        comments: [{ id: 'pnest3', message: 'p2a', quote: 'proper beds', start: 70 }] }),
      line({ k: 'msg', id: 'p2u', role: 'user', content: 'What is the difference between a couchette and a sleeper?', timestamp: 1790000004000 }),
      line({ k: 'msg', id: 'p2a', role: 'assistant', parentId: 'p2u', content: 'A couchette sleeps four to six on simple bunks; a sleeper has one to three proper beds.', timestamp: 1790000005000 }),
    ].join('\\n') + '\\n')
    SEEDED.push(second)
    // A fourth level, so the trail is deep enough to fold.
    const third = comments.commentPath('pnest3')
    await app.vault.create(third, [
      line({ v: 2, k: 'meta', type: 'abele-chat', kind: 'comment', created: '2026-09-25',
        anchor: { note: second, quote: 'proper beds', message: 'p2a' } }),
      line({ k: 'msg', id: 'p3u', role: 'user', content: 'How much more does a proper bed cost than a couchette?', timestamp: 1790000006000 }),
    ].join('\\n') + '\\n')
    SEEDED.push(third)
  }
  const unseed = async () => {
    mcpConfig.ai = { ...mcpConfig.ai, mcpServers: MCP_BEFORE }
    for (const path of SEEDED) {
      const file = app.vault.getAbstractFileByPath(path)
      if (file) await app.vault.delete(file)
    }
    const folder = app.vault.getAbstractFileByPath('Phone probe')
    if (folder) await app.vault.delete(folder, true)
    for (const dir of SEEDED_DIRS) {
      const made = app.vault.getAbstractFileByPath(dir)
      if (made && made.children && !made.children.length) await app.vault.delete(made, true)
    }
  }

  try {
    await closeDialog()
    await seed()
    app.commands.executeCommandById('abele:show-ai-sidebar')
    await until(() => {
      const chat = document.querySelector('.abele-ai-chat')
      return chat && chat.getBoundingClientRect().height > 0
    }, 8000)
    await wait(500)

    const chat = document.querySelector('.abele-ai-chat')
    await screen('chat', chat, chat)

    // The one dialog everything about a chat lives in, tab by tab.
    const setup = chat && chat.querySelector('.lucide-sliders-horizontal')
    if (setup) {
      setup.closest('.abele-icon, .clickable-icon, div').click()
      await until(() => document.querySelector('.modal .abele-chat-setup'), 5000)
      await wait(300)
      const tabs = [...document.querySelectorAll('.modal .abele-chat-setup .abele-tabs__tab')]
      for (const tab of tabs) {
        tab.click()
        await wait(400)
        const modal = document.querySelector('.modal')
        const label = tab.textContent.trim().toLowerCase()
        // The picker takes focus itself; the picture is of the ring that comes with it, which
        // a scrolling box clips unless it is given room. Blurred before measuring.
        // Every focusable thing on the tab is focused and its ring measured, not only the
        // search field: a dropdown's wrapper and the dialog's content element each cut one.
        const clipped = []
        if (modal) {
          for (const f of modal.querySelectorAll('input, textarea, select, button, [tabindex="0"]')) {
            const s = getComputedStyle(f)
            if (s.display === 'none' || s.visibility === 'hidden') continue
            if (f.getBoundingClientRect().width === 0) continue
            f.focus()
            for (const cut of ringClipped(f)) clipped.push(name(f) + ': ' + cut)
            f.blur()
          }
        }
        const field = modal && modal.querySelector('.abele-sp-picker input')
        if (field) {
          field.focus()
          await wait(200)
          await shoot('setup ' + label + ' focused')
          field.blur()
        }
        await screen('setup ' + label, modal, modal && modal.querySelector('.abele-modal__body'))
        report['setup ' + label].clipped = clipped
      }
      await closeDialog()
    } else {
      report['setup'] = { over: [], scrollers: [], capped: [], clipped: [], fill: 0, shot: '', error: 'no setup button' }
    }

    const history = chat && chat.querySelector('.lucide-history')
    if (history) {
      history.closest('.abele-icon, .clickable-icon, div').click()
      await until(() => document.querySelector('.modal .abele-chat-history'), 5000)
      await wait(300)
      const modal = document.querySelector('.modal')
      await screen('history', modal, modal && modal.querySelector('.abele-modal__body'))
      await closeDialog()
    }

    // A comment asked inside a comment: the trail over its messages, on a phone's width.
    {
      const comments = window.__abeleTest.CommentService.getInstance()
      await comments.showInSidebar('pnest2')
      await until(() => document.querySelector('.abele-ai-chat .abele-breadcrumbs'), 5000)
      await wait(400)
      const nested = document.querySelector('.abele-ai-chat')
      await screen('nested comment', nested, nested)
      // Four levels: folded to one row, then opened by its ellipsis.
      await comments.showInSidebar('pnest3')
      await until(() => document.querySelector('.abele-ai-chat .abele-breadcrumbs__more'), 5000)
      await wait(400)
      const deep = document.querySelector('.abele-ai-chat')
      await screen('nested comment folded', deep, deep)
      const trail = deep.querySelector('.abele-breadcrumbs')
      // By the middle of each piece: a glyph and a word on one row do not share a top.
      const rows = new Set([...trail.children].map((c) => { const r = c.getBoundingClientRect(); return Math.round((r.top + r.bottom) / 2) }))
      report['nested comment folded'].rows = rows.size
      deep.querySelector('.abele-breadcrumbs__more').click()
      await wait(400)
      await screen('nested comment opened', deep, deep)
      await comments.hideFromSidebar('pnest3')
    }
    // Attaching a chat to a note: the link button's menu, and the two pickers — a note for a
    // chat, and a chat for a note. Obsidian's own menu and prompt, with the plugin's items in
    // them; pictured so a person can see they read right on a phone.
    const probeChat = app.vault.getAbstractFileByPath(SEEDED.find((p) => p.endsWith('.abchat')))
    const chats = window.__abeleTest.ChatService.getInstance()
    await window.__abeleTest.ChatStorage.getInstance().refreshHistory()
    await chats.openChatFile(probeChat)
    const link = () => document.querySelector('.abele-ai-chat .abele-ai-chat__notes')
    await until(() => link() && !link().classList.contains('abele-obsidian-icon_disabled'), 5000)
    if (link()) {
      link().click()
      await until(() => document.querySelector('.menu'), 3000)
      await wait(300)
      const menu = document.querySelector('.menu')
      await screen('chat notes menu', menu, menu)
      const pick = [...document.querySelectorAll('.menu .menu-item')].find(
        (el) => el.textContent.trim() === 'Attach to a note…'
      )
      if (pick) pick.click()
      else document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      if (await until(() => document.querySelector('.modal-container .prompt'), 3000)) {
        await wait(300)
        const prompt = document.querySelector('.modal-container .prompt')
        await screen('note picker', prompt, prompt)
      } else {
        report['note picker'] = { over: [], scrollers: [], capped: [], clipped: [], fill: 0, shot: '', error: 'note picker did not open' }
      }
      await closeDialog()
    } else {
      report['chat notes menu'] = { over: [], scrollers: [], capped: [], clipped: [], fill: 0, shot: '', error: 'no link button' }
    }
    // From a note's end: the command for the note in front, which picks a chat.
    const probeNote = app.vault.getAbstractFileByPath(SEEDED[0])
    await app.workspace.getLeaf(false).openFile(probeNote)
    await wait(500)
    app.commands.executeCommandById('abele:attach-chat-to-current-note')
    if (await until(() => document.querySelector('.modal-container .prompt'), 3000)) {
      await wait(300)
      const prompt = document.querySelector('.modal-container .prompt')
      await screen('chat picker', prompt, prompt)
    } else {
      report['chat picker'] = { over: [], scrollers: [], capped: [], clipped: [], fill: 0, shot: '', error: 'chat picker did not open' }
    }
    await closeDialog()
    const probeSession = chats.getSessionByFile(probeChat.path)
    if (probeSession) chats.closeTab(probeSession.id)

    // A script's form with a note field, Obsidian's editor in it, beside a plain question.
    window.__abeleTest.showFormModal([
      { name: 'title', label: 'Title', type: 'text' },
      { name: 'body', label: 'Description', type: 'note', default: 'A [[link]] and a list:\\n- one\\n- two' },
    ])
    if (await until(() => document.querySelector('.modal .abele-note-editor-field .cm-editor'), 5000)) {
      await wait(300)
      const modal = document.querySelector('.modal')
      await screen('script form', modal, modal.querySelector('.abele-modal__body'))
      await closeDialog()
    } else {
      report['script form'] = { over: [], scrollers: [], capped: [], clipped: [], fill: 0, shot: '', error: 'the script form did not open with its note field' }
      await closeDialog()
    }

    // A script's form with note pickers: chosen notes as pills over the search field, one
    // field taking several, one taking one. The list itself is Obsidian's suggester.
    window.__abeleTest.showFormModal([
      { name: 'with', label: 'With', type: 'note-picker', multiple: true, default: SEEDED.slice(0, 3) },
      { name: 'wallet', label: 'Wallet', type: 'note-picker', default: SEEDED[8] },
    ])
    if (await until(() => document.querySelector('.modal .abele-note-picker__pill'), 5000)) {
      await wait(300)
      const modal = document.querySelector('.modal')
      await screen('script form picker', modal, modal.querySelector('.abele-modal__body'))
      await closeDialog()
    } else {
      report['script form picker'] = { over: [], scrollers: [], capped: [], clipped: [], fill: 0, shot: '', error: 'the note pickers did not show their notes' }
      await closeDialog()
    }

    // The icon picker of a header button's form: a grid of every icon, a search field above.
    // Pictured before its fields are focused one by one: focusing the button at the foot of
    // the grid scrolls the grid down to it, away from the current icon.
    window.__abeleTest.openIconPicker('calendar')
    if (
      await until(
        () => document.querySelector('.modal .abele-icon-picker .abele-icon-picker__icon'),
        5000
      )
    ) {
      await wait(300)
      const modal = document.querySelector('.modal')
      await screen('icon picker', modal, modal.querySelector('.abele-modal__body'))
      const clipped = []
      for (const f of modal.querySelectorAll('input, button')) {
        if (f.getBoundingClientRect().width === 0) continue
        f.focus()
        for (const cut of ringClipped(f)) clipped.push(name(f) + ': ' + cut)
        f.blur()
      }
      report['icon picker'].clipped = clipped
      const field = modal.querySelector('.abele-icon-picker input')
      field.value = 'arrow'
      field.dispatchEvent(new Event('input', { bubbles: true }))
      await wait(400)
      await screen('icon picker search', modal, modal.querySelector('.abele-modal__body'))
      await closeDialog()
    } else {
      report['icon picker'] = { over: [], scrollers: [], capped: [], clipped: [], fill: 0, shot: '', error: 'icon picker did not open' }
    }

    // The MCP settings as a phone shows them: the tab with the seeded server, then its dialog.
    try {
      app.setting.open()
      app.setting.openTabById('abele')
      await until(() => document.querySelector('.abele-settings__nav .abele-tabs__tab'), 5000)
      ;[...document.querySelectorAll('.abele-settings__nav .abele-tabs__tab')]
        .find((t) => t.textContent.includes('AI Agent'))?.click()
      await wait(300)
      ;[...document.querySelectorAll('.abele-ai-settings__tabs .abele-tabs__tab')]
        .find((t) => t.textContent.trim() === 'MCP')?.click()
      await until(() => document.querySelector('.abele-settings__content .abele-card'), 5000)
      const card = document.querySelector('.abele-settings__content .abele-card')
      const settingsModal = document.querySelector('.modal.mod-settings') || document.querySelector('.modal')
      await screen('settings mcp', settingsModal, settingsModal && settingsModal.querySelector('.vertical-tab-content'))
      if (card) {
        card.click()
        await until(() => document.querySelector('.abele-mcp-server'), 5000)
        await wait(300)
        const form = document.querySelector('.abele-mcp-server')
        const dialog = form && form.closest('.modal')
        await screen('mcp server', dialog, dialog && dialog.querySelector('.abele-modal__body'))
        const clipped = []
        if (dialog) {
          for (const f of dialog.querySelectorAll('input, textarea, button, [tabindex="0"]')) {
            if (f.getBoundingClientRect().width === 0) continue
            f.focus()
            for (const cut of ringClipped(f)) clipped.push(name(f) + ': ' + cut)
            f.blur()
          }
        }
        if (report['mcp server']) report['mcp server'].clipped = clipped
        // Save stands under the body, on screen before anything is scrolled.
        const footer = dialog && dialog.querySelector('.abele-modal__footer')
        if (report['mcp server']) report['mcp server'].onScreen = footer
          ? [...footer.querySelectorAll('button')]
              .filter((b) => { const r = b.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight })
              .map((b) => b.textContent.trim())
          : []
      }
    } finally {
      await closeDialog()
      // The AI page goes back to its first tab, where the keys the next screens look at are.
      ;[...document.querySelectorAll('.abele-ai-settings__tabs .abele-tabs__tab')]
        .find((t) => t.textContent.trim() === 'General')?.click()
      try { app.setting.close() } catch {}
      await closeDialog()
    }

    // The rewind dialog, over two changes made the way an agent's turn makes them: a skill note
    // rewritten and a note made. The rewritten one is opened to its difference.
    try {
      const edited = SEEDED.find((p) => p.endsWith('/probe-skill-1.md'))
      const made = 'Phone probe/Rewind probe new.md'
      await window.__abeleTest.openRewind(edited, made)
      SEEDED.push(made)
      if (await until(() => document.querySelector('.modal .abele-rewind .tree-item-self'), 5000)) {
        const row = document.querySelector('.modal .abele-rewind .tree-item-self[data-path="' + edited + '"]')
        if (row) row.click()
        await until(() => document.querySelector('.modal .abele-rewind .abele-diff .cm-editor'), 3000)
        await wait(300)
        const dialog = document.querySelector('.modal .abele-rewind').closest('.modal')
        await screen('rewind', dialog, dialog.querySelector('.abele-modal__body'))
        const clipped = []
        for (const f of dialog.querySelectorAll('select, button, [tabindex="0"]')) {
          if (f.getBoundingClientRect().width === 0) continue
          f.focus()
          for (const cut of ringClipped(f)) clipped.push(name(f) + ': ' + cut)
          f.blur()
        }
        report['rewind'].clipped = clipped
        const footer = dialog.querySelector('.abele-modal__footer')
        report['rewind'].onScreen = footer
          ? [...footer.querySelectorAll('button')]
              .filter((b) => { const r = b.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight })
              .map((b) => b.textContent.trim())
          : []
      } else {
        report['rewind'] = { over: [], scrollers: [], capped: [], clipped: [], fill: 0, shot: '', error: 'the rewind dialog did not open' }
      }
    } finally {
      await closeDialog()
    }

    // The list of keys, with two fake ones set so its rows carry their show and copy icons.
    // Whatever the keychain held under those ids is put back exactly, absent included.
    const keychain = app.secretStorage
    const FAKE_KEYS = { 'abele-firefly-token': 'fake-probe-value-1', 'abele-openrouter': 'fake-probe-value-2' }
    // The first AI provider's key too, when the vault has one: its field is the first on the
    // AI page, and the one a person reaches for.
    const provider = (window.__abeleTest.AbeleConfig.getInstance().ai.providers || [])[0]
    if (provider && provider.apiKeyId) FAKE_KEYS[provider.apiKeyId] = 'fake-probe-value-3-long-enough-to-wrap-on-a-phone-0123456789'
    const held = {}
    for (const id of Object.keys(FAKE_KEYS)) held[id] = keychain.getSecret(id)
    try {
      for (const [id, value] of Object.entries(FAKE_KEYS)) keychain.setSecret(id, value)
      window.__abeleTest.openSecretsList()
      if (await until(() => document.querySelector('.modal .abele-secrets-list .abele-card'), 5000)) {
        await wait(300)
        const modal = document.querySelector('.modal')
        await screen('secrets list', modal, modal.querySelector('.abele-modal__body'))
        const clipped = []
        for (const f of modal.querySelectorAll('input, button')) {
          if (f.getBoundingClientRect().width === 0) continue
          f.focus()
          for (const cut of ringClipped(f)) clipped.push(name(f) + ': ' + cut)
          f.blur()
        }
        report['secrets list'].clipped = clipped
        await closeDialog()
      } else {
        report['secrets list'] = { over: [], scrollers: [], capped: [], clipped: [], fill: 0, shot: '', error: 'the list of keys did not open' }
      }

      // The settings pages whose fields hold keys, as a phone shows them: each stored key
      // masked with its show and copy icons beside it, the first one shown in full.
      app.setting.open()
      app.setting.openTabById('abele')
      await until(() => document.querySelector('.abele-settings__nav .abele-tabs__tab'), 5000)
      const PAGES = [['settings ai keys', 'AI Agent'], ['settings finance keys', 'Finance']]
      for (const [label, page] of PAGES) {
        const tab = [...document.querySelectorAll('.abele-settings__nav .abele-tabs__tab')].find(
          (t) => t.textContent.trim() === page
        )
        if (!tab) {
          report[label] = { over: [], scrollers: [], capped: [], clipped: [], fill: 0, shot: '', error: 'no page ' + page }
          continue
        }
        tab.click()
        if (!(await until(() => document.querySelector('.abele-secret-field__stored'), 5000))) {
          report[label] = { over: [], scrollers: [], capped: [], clipped: [], fill: 0, shot: '', error: 'no stored key on ' + page }
        } else {
          const first = document.querySelector('.abele-secret-field')
          first.querySelector('.abele-secret-field__stored .abele-obsidian-icon').click()
          first.scrollIntoView({ block: 'center' })
          await wait(400)
          const modal = document.querySelector('.modal')
          await screen(label, modal, modal.querySelector('.vertical-tab-content-container') || modal)
          // The show and copy icons belong on the row of the key, not on a line of their own.
          const stranded = []
          for (const row of modal.querySelectorAll('.abele-secret-field__stored')) {
            const value = row.querySelector('.abele-secret-field__value').getBoundingClientRect()
            for (const icon of row.querySelectorAll('.abele-obsidian-icon')) {
              if (icon.getBoundingClientRect().top >= value.bottom - 1) stranded.push(row.textContent.trim().slice(0, 24))
            }
          }
          report[label].stranded = stranded
          const clipped = []
          for (const f of modal.querySelectorAll('.abele-secret-field input')) {
            if (f.getBoundingClientRect().width === 0) continue
            f.focus()
            for (const cut of ringClipped(f)) clipped.push(name(f) + ': ' + cut)
            f.blur()
          }
          report[label].clipped = clipped
        }
        const back = document.querySelector('.modal-setting-back-button')
        if (back) back.click()
        await until(() => document.querySelector('.abele-settings__nav .abele-tabs__tab'), 3000)
      }
      app.setting.close()
    } finally {
      for (const [id, value] of Object.entries(held)) {
        if (value) keychain.setSecret(id, value)
        else if (keychain.deleteSecret) keychain.deleteSecret(id)
        else keychain.setSecret(id, '')
      }
    }

    // The documentation, a tab rather than a dialog: its text keeps a note's margins, and the
    // end of a page and of the contents can be scrolled out from under the floating bottom bar.
    // The last screen is a search result just opened, taken while its place still flashes.
    app.commands.executeCommandById('abele:open-documentation')
    const docsLeaf = () => app.workspace.getLeavesOfType('abele-user-docs')[0]
    if (await until(() => docsLeaf() && docsLeaf().view.contentEl.querySelector('.abele-user-docs__page p'), 8000)) {
      const content = docsLeaf().view.contentEl
      const navbar = document.querySelector('.mobile-navbar')
      // How far the last line of a scroller, scrolled to its end, still sits under the bar.
      const covered = (scroller) => {
        scroller.scrollTop = scroller.scrollHeight
        const last = [...scroller.querySelectorAll('p, li, .abele-tree-item__self')].pop()
        if (!last || !navbar || navbar.getBoundingClientRect().height === 0) return 0
        return Math.max(0, Math.round(last.getBoundingClientRect().bottom - navbar.getBoundingClientRect().top))
      }
      const marginsOf = () => {
        const text = content.querySelector('.abele-user-docs__page p').getBoundingClientRect()
        return [Math.round(text.left), Math.round(window.innerWidth - text.right)]
      }
      const article = content.querySelector('.abele-user-docs__article')
      const docsCovered = covered(article)
      await wait(300)
      await screen('docs page', content)
      report['docs page'].covered = docsCovered
      report['docs page'].margins = marginsOf()
      report['docs page'].fileMargin = Math.round(parseFloat(getComputedStyle(content).getPropertyValue('--file-margins-x')) || 0)

      content.querySelector('.abele-user-docs__menu').click()
      await until(() => content.querySelector('.abele-user-docs__contents'), 3000)
      const nav = content.querySelector('.abele-user-docs__nav')
      const navCovered = covered(nav)
      await wait(300)
      await screen('docs contents', content)
      report['docs contents'].covered = navCovered

      nav.scrollTop = 0
      const input = nav.querySelector('input')
      input.value = 'passphrase'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await until(() => content.querySelector('.abele-user-docs__hit'), 3000)
      content.querySelector('.abele-user-docs__hit').click()
      await until(() => content.querySelector('.abele-line-flash'), 5000)
      await screen('docs search result', content)
      const lit = content.querySelector('.abele-line-flash')
      const box = content.querySelector('.abele-user-docs__article').getBoundingClientRect()
      const at = lit && lit.getBoundingClientRect()
      report['docs search result'].landed = !!at && at.top >= box.top && at.bottom <= box.bottom
      docsLeaf().detach()
    } else {
      report['docs page'] = { over: [], scrollers: [], capped: [], clipped: [], fill: 0, shot: '', error: 'the documentation did not open' }
    }
  } catch (e) {
    report['run'] = { over: [], scrollers: [], capped: [], clipped: [], fill: 0, shot: '', error: String((e && e.message) || e) }
  } finally {
    await closeDialog()
    await unseed()
  }

  return report
})()`

/** Closes anything standing over the note and switches emulation, letting the reload settle. */
const setMobile = async (on: boolean): Promise<void> => {
  evalRaw(
    `(() => {
      const close = document.querySelector('.modal-close-button')
      if (close) close.click()
      return 'ok'
    })()`,
    30_000
  )
  await reloadApp(`app.emulateMobile(${on})`)
}

const windowSize = (): [number, number] =>
  evalJson<[number, number]>(
    `require('@electron/remote').getCurrentWindow().getContentSize()`,
    30_000
  )

const setWindowSize = async (width: number, height: number): Promise<void> => {
  evalRaw(
    `(() => {
      require('@electron/remote').getCurrentWindow().setContentSize(${width}, ${height})
      return 'ok'
    })()`,
    30_000
  )
  await new Promise((resolve) => setTimeout(resolve, 1500))
}

const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)('the chat dialogs on a phone', () => {
  let report: Report = {}
  let size: [number, number] = [0, 0]

  beforeAll(async () => {
    size = windowSize()
    await setMobile(true)
    await setWindowSize(PHONE.width, PHONE.height)
    report = evalAsync<Report>(probeScript, 120_000)

    const lines = Object.entries(report).map(
      ([label, s]) => `  ${label.padEnd(20)} ${s.shot || s.error}`
    )
    console.info(`\n  vault ...................... ${activeVaultName()}\n${lines.join('\n')}\n`)
  }, 300_000)

  afterAll(async () => {
    if (!available) return
    // Restore the window before leaving emulation: `emulateMobile(false)` reloads the app and
    // takes the viewport size from the window at that moment. The opposite order left every
    // later desktop e2e test running in a phone-sized viewport.
    if (size[0]) await setWindowSize(size[0], size[1])
    await setMobile(false)
  }, 120_000)

  const screens = [
    'chat',
    'setup scope',
    'setup skills',
    'setup prompts',
    'setup tools',
    'setup settings',
    'setup debug',
    'history',
    'nested comment',
    'nested comment folded',
    'nested comment opened',
    'chat notes menu',
    'note picker',
    'chat picker',
    'icon picker',
    'icon picker search',
    'secrets list',
    'settings ai keys',
    'settings finance keys',
    'settings mcp',
    'mcp server',
    'rewind',
    'script form',
    'docs page',
    'docs contents',
    'docs search result',
    'script form picker',
  ]

  /** Dialogs with fields, whose focus rings are measured, and which stand as a full sheet. */
  const sheets = screens.filter(
    (s) =>
      s.startsWith('setup') ||
      s === 'icon picker' ||
      s === 'secrets list' ||
      s === 'mcp server' ||
      s === 'rewind'
  )

  it('reaches every screen', () => {
    expect(report.run?.error ?? '').toBe('')
    for (const label of screens) {
      expect(report[label], label).toBeDefined()
      expect(report[label].error, label).toBe('')
    }
  })

  it.each(screens)('%s: nothing reaches past the edge of the screen', (label) => {
    expect(report[label]?.over ?? ['no report']).toEqual([])
  })

  /**
   * Obsidian's own prompt, which the pickers are: on a phone it puts the search field *under*
   * the list, so its list stops a field's height above the bottom by design. Only the count of
   * scrollers is asked of it.
   */
  const prompts = new Set(['note picker', 'chat picker'])

  it.each(screens)('%s: one thing scrolls inside the body, and it reaches the bottom', (label) => {
    // A settings page's prompt editors are fields that scroll their own text, by design.
    const scrollers = (report[label]?.scrollers ?? []).filter(
      (s) => !(label.startsWith('settings') && s.name === 'abele-obsidian-input')
    )
    expect(scrollers.length, JSON.stringify(scrollers)).toBeLessThanOrEqual(1)
    if (prompts.has(label)) return
    for (const s of scrollers)
      expect(s.spare, `${s.name} leaves ${s.spare}px blank under it`).toBeLessThanOrEqual(24)
  })

  it.each(sheets)('%s: nothing cuts the focus ring off any field', (label) => {
    expect(report[label]?.clipped ?? ['no report']).toEqual([])
  })

  it('nested comment folded: a trail of four levels keeps to one row', () => {
    expect((report['nested comment folded'] as Screen & { rows?: number })?.rows).toBe(1)
  })

  it('history: every card keeps its delete icon on the row of its title', () => {
    expect(report['history']?.stranded ?? ['no report']).toEqual([])
  })

  it('mcp server: Save stands on screen without scrolling', () => {
    expect((report['mcp server'] as Screen & { onScreen?: string[] })?.onScreen).toContain('Save')
  })

  it('rewind: its three buttons stand on screen without scrolling', () => {
    expect((report['rewind'] as Screen & { onScreen?: string[] })?.onScreen).toEqual([
      'Conversation only',
      'Files only',
      'Files and conversation',
    ])
  })

  it('secrets list: every key keeps its show and copy icons on the row of its name', () => {
    expect(report['secrets list']?.stranded ?? ['no report']).toEqual([])
  })

  it.each(['settings ai keys', 'settings finance keys'])(
    '%s: every stored key keeps its show and copy icons on its own row, and no field loses its focus ring',
    (label) => {
      expect(report[label]?.stranded ?? ['no report']).toEqual([])
      expect(report[label]?.clipped ?? ['no report']).toEqual([])
    }
  )

  type Docs = Screen & {
    covered?: number
    margins?: number[]
    fileMargin?: number
    landed?: boolean
  }

  it.each(['docs page', 'docs contents'])(
    '%s: the last line scrolls out from under the bottom bar',
    (label) => {
      expect((report[label] as Docs)?.covered).toBe(0)
    }
  )

  it("docs page: the text keeps a note's margins", () => {
    const docs = report['docs page'] as Docs
    expect(docs?.fileMargin).toBeGreaterThan(0)
    for (const side of docs?.margins ?? [0, 0])
      expect(side).toBeGreaterThanOrEqual(docs.fileMargin! - 1)
  })

  it('docs search result: lands on the place it found, lit up and in view', () => {
    expect((report['docs search result'] as Docs)?.landed).toBe(true)
  })

  it.each(screens)('%s: no box is capped below the height of the sheet', (label) => {
    expect(report[label]?.capped ?? ['no report']).toEqual([])
  })

  it.each(sheets)('%s: the sheet stands the height of the screen', (label) => {
    expect(report[label]?.fill ?? 0).toBeGreaterThanOrEqual(0.85)
  })
})
