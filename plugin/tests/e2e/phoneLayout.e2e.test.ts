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
import { openBasePicker, basePickerGeometry } from './helpers/githubBasePicker'
import { PRELUDE as BASE_PRELUDE, startFakeGithub, enableGithub, restoreGithub, evalAsync as evalBase, type FakeGithub } from './helpers/githubLive'
import { BASE_SHA } from './helpers/fakeGithubRepo'
import {
  activeVaultName,
  evalJson,
  evalLong,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
} from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import {
  SELECTION_MENUS_SETUP,
  SELECTION_MENUS_OPEN,
  SELECTION_MENUS_CLEANUP,
} from './helpers/selectionMenus'
import { sampleDocx } from '../fixtures/docx/sampleDocx'
import { CATALOGUE_PROBE } from './helpers/designCatalogueProbe'
import { outwardBoxShadowReach } from '../helpers/focusRingPaint'
import {
  recipientRowFailures,
  RECIPIENT_ROWS,
  type RecipientLayoutReport,
  type RecipientAction,
} from '../helpers/keyDestinationLayout'
import { recipientLayoutProbe } from '../helpers/keyDestinationLayoutProbe'
import {
  PUBLICATION_SETUP,
  PUBLICATION_PRELUDE,
  PUBLICATION_CLEANUP,
  publicationFault,
} from './helpers/canvasPublicationReview'
import { MESSAGE_ACTIONS_SETUP, MESSAGE_ACTIONS_CLEANUP } from './helpers/messageActions'
import { SELECTION_PICKER_OPEN, SELECTION_PICKER_CLOSE } from './helpers/selectionScriptPicker'
const CANVAS_SCREENS = ['canvas publication review', 'canvas publication confirmation']
const WORD_SAMPLE = Buffer.from(sampleDocx()).toString('base64')

// Adapted for a real phone, not yet green there: see docs/Testing.md, "On a real phone".
targets('desktop')

import { publicationQuestion } from '../helpers/publicationQuestion'

const PHONE = { width: 390, height: 844 }
const SHOTS = shotDir('abele-phone')

/**
 * Every dialog `openDialog` opens by name (src/testing/openDialog.ts). Listed here as well, so a
 * dialog added there is added to the checks below by name — the probe fails while the two lists
 * differ.
 */
const DIALOGS = [
  'chat-artifacts-empty',
  'chat-artifacts',
  'chat-artifacts-long',
  'text-comment-create',
  'text-comment-list',
  'text-comment-orphan',
  'text-comment-edit',
  'text-comment-delete',
  'chat-navigation',
  'agents',
  'agents-tabs',
  'node-pairing',
  'node-pairing-waiting',
  'node-pairing-recovery',
  'node-pairing-endpoint',
  'node-question',
  'node-question-input',
  'node-workspaces',
  'node-delegation-grants',
  'node-delegation-card',
  'node-files',
  'node-edit',
  'node-edit-conflict',
  'node-edit-unknown',
  'node-edit-binary',
  'node-edit-large',
  'node-edit-shared',
  'node-diffs',
  'node-review',
  'node-history',
  'template-review',
  'template-review-change',
  'slide-network',
  'selection-source',
  'selection-history',
  'selection-unresolved',
  'reply-revision',
  'reply-original',
  'key-destinations',
  'key-destinations-new',
  'saved-key-request',
  'confirm',
  'date',
  'recurrence',
  'date-range',
  'book-comment',
  'book-forms',
  'model',
  'image-model',
  'template-select',
  'template-variables',
  'find-replace',
  'import-files',
  'save-media',
  'unused-media',
  'dedup-media',
  'migrate-dataview-fields',
  'migrate-dataview',
  'migrate-firefly',
  'migrate-toggl',
  'transfer-send',
  'transfer-preview',
  'transfer-scan',
  'github-connection-approval',
  'github-agent-access',
  'github-connections',
  'github-connection',
  'agent-editor',
  'lint-rule',
  'ask-name',
  'confirm-action',
  'discussion-remove',
  'book-repair-one',
  'book-repair-many',
].map((name) => `dialog ${name}`)

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
  /** Horizontal tab strips: row count and tabs taller than their strip. */
  tabs?: { name: string; count: number; rows: number; clipped: string[] }[]
  /** Focus a tab outside the visible strip, then measure its ring without pre-scrolling it. */
  tabFocus?: { label: string; level: string; outside: boolean; clipped: string[] }[]
  /** The root's height as a share of the window's. */
  fill: number
  handles?: number[][]
  stageTop?: number[]
  canvasFits?: boolean
  ids?: string[]
  /** Direct and overflow header actions, measured while the native menu is open. */
  header?: { direct: string[]; overflow: string[]; unreachable: string[]; clipped: string[]; findOpened: boolean }
  /** Where the picture went. */
  shot: string
  error: string
}

type Report = Record<string, Screen>

type RecipientScreen = Screen &
  RecipientLayoutReport & {
    pinnedActions: string[]
    primary: RecipientAction & { pinned: boolean; summary: string }
  }

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
  // On a real phone the harness's host takes the pictures (see phone.ts); there is no Electron.
  const host = window.__e2eHost
  const fs = host ? null : require('fs')
  const win = host ? null : require('@electron/remote').getCurrentWindow()
  if (fs) fs.mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })

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
      // Except the chat's composer: under the conversation it stops growing at a few lines on
      // purpose, and its own button opens it out over the whole chat.
      const composer = el.closest('.abele-chat-input:not(.abele-chat-input--expanded)')
      if (!composer && s.maxHeight.endsWith('px') && ceiling < hostBox.height - 1) capped.push(name(el) + ' ' + Math.round(ceiling) + 'px')
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

    // Horizontal navigation is one scrolling row, not a wrapped second row. Right-edge
    // overflow cannot catch wrapping: every tab still fits inside the sheet.
    const tabs = [...root.querySelectorAll('.abele-tabs:not(.abele-tabs_vertical)')]
      .filter((strip) => strip.getBoundingClientRect().width > 0 && getComputedStyle(strip).visibility !== 'hidden')
      .map((strip) => {
        const bounds = strip.getBoundingClientRect()
        const items = [...strip.querySelectorAll('.abele-tabs__tab')].filter((tab) => tab.getBoundingClientRect().width > 0)
        const rows = new Set(items.map((tab) => Math.round(tab.getBoundingClientRect().top)))
        const clipped = items.filter((tab) => {
          const r = tab.getBoundingClientRect()
          return r.top < bounds.top - 1 || r.bottom > bounds.bottom + 1
        }).map((tab) => tab.textContent.trim())
        return { name: name(strip), count: items.length, rows: rows.size, clipped }
      })

    return { over, scrollers, capped, stranded, tabs, fill: Math.round((box.height / window.innerHeight) * 100) / 100 }
  }

  /**
   * The ancestors that cut a focused field's ring. The ring is a box-shadow drawn outside the
   * field's box, so every ancestor that clips has to leave room for its blur and spread; the
   * dialog's mount point did not, and the search field lost 2px off each side on a phone.
   */
  const ringClipped = (field) => {
    const reach = (${outwardBoxShadowReach.toString()})(getComputedStyle(field).boxShadow)
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
    const path = ${JSON.stringify(SHOTS)} + '/' + label.replace(/[^a-z0-9]+/gi, '-') + '.png'
    if (host) return host.shot(path)
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
    fs.writeFileSync(path, img.toPNG())
    return path
  }

  ${recipientLayoutProbe}

  const report = {}
  const screen = async (label, root, body) => {
    const entry = { over: [], scrollers: [], capped: [], stranded: [], clipped: [], fill: 0, shot: '', error: '' }
    try {
      if (!root) throw new Error('nothing to measure')
      entry.shot = await shoot(label)
      Object.assign(entry, measure(root, body))
      entry.tabFocus = []
      for (const strip of root.querySelectorAll('.abele-tabs:not(.abele-tabs_vertical)')) {
        if (strip.scrollWidth <= strip.clientWidth + 1) continue
        const tabs = [...strip.querySelectorAll('.abele-tabs__tab')]
        const previous = strip.scrollLeft
        const level = strip.classList.contains('abele-tabs_primary') ? 'primary' : 'secondary'
        for (const [tab, start] of [[tabs.at(-1), 0], [tabs[0], strip.scrollWidth]]) {
          if (!tab || !tab.getBoundingClientRect().width) continue
          document.activeElement?.blur()
          strip.scrollLeft = start
          const bounds = strip.getBoundingClientRect()
          const box = tab.getBoundingClientRect()
          const outside = box.left >= bounds.right || box.right <= bounds.left
          // The same unforced focus a keyboard or script gives. Do not scroll into view in the
          // probe: the component itself must reveal the focused tab and its whole focus ring.
          tab.focus()
          entry.tabFocus.push({ label: tab.textContent.trim(), level, outside, clipped: ringClipped(tab) })
          tab.blur()
        }
        strip.scrollLeft = previous
      }
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

  const headerActions = async (label, root) => {
    const entry = { direct: [], overflow: [], unreachable: [], clipped: [], findOpened: false }
    const reachable = (el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= window.innerWidth &&
        r.top >= 0 && r.bottom <= window.innerHeight
    }
    for (const button of root.querySelectorAll('.abele-ai-chat__header-actions button')) {
      if (!button.getBoundingClientRect().width) continue
      const label = button.getAttribute('aria-label').split(' · ')[0]
      entry.direct.push(label)
      if (!reachable(button)) entry.unreachable.push(label)
      button.focus(); entry.clipped.push(...ringClipped(button)); button.blur()
    }
    const more = root.querySelector('[aria-label="More chat actions"]')
    if (!more || !reachable(more)) throw new Error('no reachable header overflow')
    more.click()
    await until(() => document.querySelector('.menu'), 3000)
    const menu = document.querySelector('.menu')
    await screen(label + ' header menu', menu, menu)
    for (const item of menu.querySelectorAll('.menu-item')) {
      const title = item.querySelector('.menu-item-title')?.textContent.trim()
      entry.overflow.push(title)
      if (!reachable(item)) entry.unreachable.push(title)
    }
    // Execute an overflow action rather than sending Escape to the document: that also
    // dismisses the mobile sidebar and would leave later pictures on the underlying pane.
    const findItem = [...menu.querySelectorAll('.menu-item')].find(item =>
      item.querySelector('.menu-item-title')?.textContent.trim() === 'Find in this chat')
    findItem.click()
    entry.findOpened = await until(() => root.querySelector('.abele-chat-find'), 3000)
    root.querySelector('[aria-label="Close the find bar (Esc)"]')?.click()
    await wait(300)
    report[label].header = entry
  }

  // Lists worth measuring: a vault with two skills shows nothing about how a list of twenty
  // stands in a sheet. These are written for the run and removed after it.
  const SEEDED = []
  const SEEDED_DIRS = []
  let replyReviewer = null
  // An MCP server with a few tools, in memory only: the chat's tools tab shows its group and
  // switch, and the settings' MCP tab has a card to open. Put back as it was by \`unseed\`.
  const mcpConfig = window.__abeleTest.AbeleConfig.getInstance()
  const MCP_BEFORE = mcpConfig.ai.mcpServers
  const seed = async () => {
    replyReviewer = window.__abeleTest.AgentRegistry.getInstance().create({ name: 'Sample reply reviewer', utility: true })
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
    if (replyReviewer) window.__abeleTest.AgentRegistry.getInstance().remove(replyReviewer.id)
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
    await headerActions('chat', chat)

    // An unsent picture and the same preview used by sent pictures, with every action visible.
    {
      const scope = window.__abeleTest.ChatService.getInstance().activeSession.value?.scopeResolver
      const scopeBefore = scope?.entries.value.slice()
      try {
      const canvas = document.createElement('canvas')
      canvas.width = 96; canvas.height = 64
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#e08020'; ctx.fillRect(0, 0, 96, 64)
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'))
      const path = 'Phone probe/sample-image.png'
      await app.vault.createBinary(path, await blob.arrayBuffer())
      SEEDED.push(path)
      window.__abeleTest.ChatService.getInstance().pendingInput.value = { text: '', attachments: [path] }
      await until(() => chat.querySelector('.abele-chat-picture img'), 5000)
      await wait(300)
      await screen('chat attachment', chat, chat)
      const deferredSession = window.__abeleTest.ChatService.getInstance().activeSession.value
      const wasStreaming = deferredSession.isStreaming.value
      const hadFile = !!deferredSession.currentChatFile.value
      try {
        deferredSession.isStreaming.value = true
        await deferredSession.sendMessage('Describe the attached sample picture', [path])
        await wait(300)
        // The conversation scrolls above the composer, not through its attachment controls.
        await screen('chat deferred media', chat, chat.querySelector('.abele-ai-chat__messages'))
        report['chat deferred media'].attach = !!chat.querySelector('.lucide-paperclip')
        report['chat deferred media'].voice = !!chat.querySelector('.lucide-mic')
        report['chat deferred media'].edit = !!chat.querySelector('.abele-ai-chat__queued-edit')
        report['chat deferred media'].attachment = chat.querySelector('.abele-ai-chat__queued-item')?.textContent.includes('sample-image.png')
      } finally {
        deferredSession.takeQueuedMessages()
        deferredSession.isStreaming.value = wasStreaming
        await deferredSession.flush()
        if (!hadFile && deferredSession.currentChatFile.value)
          SEEDED.push(deferredSession.currentChatFile.value.path)
      }
      chat.querySelector('.abele-chat-picture img').click()
      await until(() => document.querySelector('.abele-gallery-viewer'), 5000)
      await wait(300)
      const preview = document.querySelector('.abele-gallery-viewer')
      await screen('chat image preview', preview, preview)
      // Absolutely positioned actions are deliberately ignored by the general walker;
      // measure the toolbar's full box too, so a centred strip cannot hide either end.
      const toolbar = preview.querySelector('.abele-gallery-viewer__toolbar').getBoundingClientRect()
      if (toolbar.left < 0 || toolbar.right > window.innerWidth) report['chat image preview'].over.push('toolbar')
      preview.querySelector('.abele-gallery-viewer__close').click()
      chat.querySelector('.abele-chat-input__attachment-remove').click()
      } finally {
        if (scope && scopeBefore) scope.entries.value = scopeBefore
        document.querySelector('.abele-gallery-viewer__close')?.click()
      }
    }

    // The one dialog everything about a chat lives in, tab by tab. The chat is given an
    // interceptor script for the while, so its Settings tab shows the script and the pattern
    // field too; it follows its agent again afterwards.
    const guardedChat = window.__abeleTest.ChatService.getInstance().activeSession.value
    if (guardedChat) {
      guardedChat.interceptor.script.value = 'Phone probe guard'
      guardedChat.interceptor.pattern.value = '^/todo'
    }
    chat?.querySelector('[aria-label="More chat actions"]')?.click()
    await until(() => document.querySelector('.menu'), 3000)
    const setup = [...document.querySelectorAll('.menu-item')].find(item =>
      item.querySelector('.menu-item-title')?.textContent.trim() === 'Scope, skills, prompts, permissions and settings')
    if (setup) {
      setup.click()
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
        if (label === 'settings' && modal) {
          report['setup settings'].pattern = !!modal.querySelector('input[placeholder="Every message"]')
          const replyRow = () => [...modal.querySelectorAll('.setting-item')].find(r => r.querySelector('.setting-item-name')?.textContent.trim() === 'Reply only')
          report['setup settings'].replyToggle = !!replyRow()?.querySelector('.checkbox-container')
          guardedChat.interceptor.agentId.value = replyReviewer.id
          await until(() => replyRow(), 3000)
          const row = replyRow()
          if (row) row.scrollIntoView({ block: 'center' })
          await screen('setup settings reply only', modal, modal.querySelector('.abele-modal__body'))
          report['setup settings reply only'].replyToggle = !!row?.querySelector('.checkbox-container')
        }
      }
      await closeDialog()
      if (guardedChat) guardedChat.interceptor.followAgent()
    } else {
      report['setup'] = { over: [], scrollers: [], capped: [], clipped: [], fill: 0, shot: '', error: 'no setup menu item' }
    }

    const history = chat && chat.querySelector('.lucide-history')
    if (history) {
      history.closest('.abele-icon, .clickable-icon, div').click()
      await until(() => document.querySelector('.modal .abele-chat-history'), 5000)
      await wait(300)
      const modal = document.querySelector('.modal')
      await screen('history', modal, modal && modal.querySelector('.abele-modal__body'))
      const scope = modal.querySelector('.abele-chat-history [role="switch"]')
      const searchField = modal.querySelector('.abele-chat-history__search')
      const sr = scope?.getBoundingClientRect()
      const fr = searchField?.getBoundingClientRect()
      report['history'].contentScope = {
        label: scope?.getAttribute('aria-labelledby') && document.getElementById(scope.getAttribute('aria-labelledby'))?.textContent.trim(),
        visible: !!sr && sr.width > 0 && sr.height > 0,
        besideSearch: !!sr && !!fr && sr.left >= fr.right && sr.top < fr.bottom && sr.bottom > fr.top,
        searchWidth: fr?.width ?? 0,
      }
      if (scope) { scope.focus(); report['history'].clipped.push(...ringClipped(scope)) }
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
      await headerActions('nested comment', nested)
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
    // Attaching a chat to a note: Artifacts and the two pickers — a note for a
    // chat, and a chat for a note. Keep the attachment choices reachable from the new view.
    const probeChat = app.vault.getAbstractFileByPath(SEEDED.find((p) => p.endsWith('.abchat')))
    const chats = window.__abeleTest.ChatService.getInstance()
    await window.__abeleTest.ChatStorage.getInstance().refreshHistory()
    await chats.openChatFile(probeChat)
    const link = () => document.querySelector('.abele-ai-chat .abele-ai-chat__artifacts')
    await until(() => link() && !link().classList.contains('abele-obsidian-icon_disabled'), 5000)
    if (link()) {
      link().click()
      await until(() => document.querySelector('.abele-chat-artifacts'), 3000)
      await wait(300)
      const modal = document.querySelector('.abele-chat-artifacts').closest('.modal')
      await screen('chat artifacts', modal, modal.querySelector('.abele-modal__body'))
      const pick = [...modal.querySelectorAll('button')].find(
        (el) => el.textContent.trim() === 'Attach to a note…' && !el.disabled
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
      await closeDialog()
    } else {
      report['chat artifacts'] = { over: [], scrollers: [], capped: [], clipped: [], fill: 0, shot: '', error: 'no artifacts button' }
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
    {
      ${SELECTION_PICKER_OPEN}
      await screen('selection script picker', selectionPrompt, selectionPrompt.querySelector('.prompt-results'))
      report['selection script picker'].pins = [...selectionPrompt.querySelectorAll('.abele-selection-script-choice')].filter(row => row.getBoundingClientRect().top < selectionPrompt.querySelector('.prompt-results').getBoundingClientRect().bottom).map(row => {
        const title = row.querySelector('.suggestion-title'), pin = row.querySelector('button'), icon = pin.querySelector('svg')
        const range = document.createRange(); range.selectNodeContents(title)
        const line = range.getClientRects()[0], r = pin.getBoundingClientRect(), i = icon.getBoundingClientRect()
        return {offset:i.top+i.height/2-line.top-line.height/2,width:r.width,height:r.height}
      })
      const results = selectionPrompt.querySelector('.prompt-results')
      results.scrollTop = results.scrollHeight
      await wait(100)
      await screen('selection script picker bottom', selectionPrompt, results)
      ${SELECTION_PICKER_CLOSE}
    }
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
    window.__abeleTest.SyncService.getInstance().publicationPrompt.asking.value = ${JSON.stringify(publicationQuestion)}
    await until(() => document.querySelector('.modal .abele-publication-confirm'), 5000)
    const publicationModal = document.querySelector('.modal')
    await screen('publication confirmation', publicationModal, publicationModal && publicationModal.querySelector('.abele-modal__body'))
    report['publication confirmation'].clipped = [...(publicationModal?.querySelectorAll('button') || [])].flatMap(field => { field.focus(); const cut = ringClipped(field); field.blur(); return cut })
    await closeDialog()

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

    window.__abeleTest.openProtocolWrite()
    if (await until(() => document.querySelector('.modal .abele-protocol-write'), 5000)) {
      const modal = document.querySelector('.modal')
      await screen('link write', modal, modal.querySelector('.abele-modal__body'))
      await closeDialog()
    } else {
      report['link write'] = { over: [], scrollers: [], capped: [], clipped: [], fill: 0, shot: '', error: 'write preview did not open' }
    }

    // Run after the existing settings inventory: native settings retain their active page.
    // Node presentation fixtures need no listener, token or execution to measure their layout.
    const nodeScreens = async () => {
      const chats = window.__abeleTest.ChatService.getInstance()
      const nodes = window.__abeleTest.NodeService.getInstance()
      const active = chats.activeTabId.value
      const wasNodes = nodes.nodes.value
      const registration = { id: 'layout-node', label: 'Sample local node with a longer label', url: 'http://127.0.0.1:7777', expectedNodeId: 'layout-node' }
      const reference = { kind: 'node-session', nodeId: 'layout-node', registrationId: 'layout-node', sessionId: 'layout-session', title: 'Sample node session' }
      const connection = { state: { value: 'connected' }, error: { value: '' }, connect: async () => {}, destroy: () => {} }
      const presenter = {
        id: 'layout-node-tab', reference, capabilities: { branches: false, rewind: false, editHistory: false, attachments: false, vaultResources: false },
        label: { value: reference.title }, state: { value: 'needs-attention' }, error: { value: '' }, isStreaming: { value: false }, connection,
        draft: { value: { text: '', attachments: [] } }, queued: { value: [{ id: 'queued', text: 'Sample queued follow-up' }] }, rejected: { value: [] },
        messages: { value: [{ id: 'user', role: 'user', content: 'Sample request', timestamp: 0 }, { id: 'reply', role: 'assistant', content: 'Sample streamed answer', timestamp: 0 }] },
        projection: { value: { artifacts: [], unknown: [], prompts: [{ prompt_id: 'sample-prompt', state: 'pending', expires_at: 1999999999999, choice: null }] } },
        send: async () => {}, answer: async () => {}, openResource: () => {}, destroy: () => {},
      }
      try {
        chats.nodeSessions.set(presenter.id, presenter)
        chats.tabOrder.value = [...chats.tabOrder.value, presenter.id]
        chats.activeTabId.value = presenter.id
        await chats.revealSidebar({ focus: false })
        await until(() => {
          const box = document.querySelector('.abele-node-chat')?.getBoundingClientRect()
          return box && box.width > 0 && box.left >= -1 && box.left < window.innerWidth
        }, 5000)
        await wait(400)
        const nodeChat = document.querySelector('.abele-node-chat')
        await screen('node chat', nodeChat, nodeChat.querySelector('.abele-ai-chat__messages'))
        const claude = { ...presenter, id: 'layout-claude-tab', queued: { value: [] }, provider: { value: 'claude' }, nativeSessionId: { value: 'sample-native-session' }, workspaceId: { value: 'sample-workspace' },
          messages: { value: [{ id: 'assistant', role: 'assistant', content: '**Completed:** a sample edit.\\n\\n- One changed path', thinking: 'Sample exposed reasoning.', timestamp: 0 }, { id: 'tool', role: 'tool-call', content: '', toolName: 'Edit', toolParams: { file_path: 'src/sample-file.txt', old_string: 'before', new_string: 'after' }, toolResult: 'Edited sample file', toolStatus: 'approved', toolDiff: { old: 'before', new: 'after' }, timestamp: 0 }] },
          projection: { value: { activeRuns: ['sample-run'], queuedInputs: [{ id: 'followup', text: 'Sample queued follow-up' }], artifacts: [], unknown: [], children: { tool: [{ id: 'child', role: 'assistant', content: 'Sample nested work', timestamp: 0 }] }, prompts: [{ prompt_id: 'sample-permission', state: 'pending', tool_name: 'Bash', input: { command: 'printf sample > sample-new-file.txt', description: 'Write a disposable sample file' }, expires_at: Date.now() + 300000, choice: null }] } }, interrupt: async () => {}, cancelInput: async () => {} }
        chats.nodeSessions.set(claude.id, claude)
        chats.tabOrder.value = [...chats.tabOrder.value, claude.id]
        chats.activeTabId.value = claude.id
        await wait(400)
        const claudeChat = document.querySelector('.abele-node-chat')
        await screen('node claude chat', claudeChat, claudeChat.querySelector('.abele-ai-chat__messages'))
        const transcriptScroll = claudeChat.querySelector('.abele-ai-chat__messages')
        transcriptScroll.scrollTop = transcriptScroll.scrollHeight
        await wait(200)
        await screen('node claude permission', claudeChat, transcriptScroll)
        const approval = claudeChat.querySelector('.abele-node-permission')
        const approveButton = [...approval.querySelectorAll('button')].find(b => b.textContent.trim() === 'Approve')
        const denyButton = [...approval.querySelectorAll('button')].find(b => b.textContent.trim() === 'Deny')
        report['node claude permission'].actionRows = Math.abs(approveButton.getBoundingClientRect().top - denyButton.getBoundingClientRect().top) < 2 ? 1 : 2
        report['node claude permission'].accent = approveButton.classList.contains('mod-cta')
        report['node claude permission'].queueCopies = (claudeChat.textContent.match(/Sample queued follow-up/g) || []).length
        report['node claude chat'].headerHeight = claudeChat.querySelector('.abele-ai-chat__header').getBoundingClientRect().height
        for (const field of claudeChat.querySelectorAll('button, textarea, [tabindex="0"]')) {
          if (!field.getBoundingClientRect().width) continue
          field.focus(); report['node claude permission'].clipped.push(...ringClipped(field)); field.blur()
        }
        const sent = { ...claude, id: 'layout-node-answer-tab', answers: { value: { 'sample-permission': { state: 'pending', choice: 'allow' } } } }
        chats.nodeSessions.set(sent.id, sent)
        chats.tabOrder.value = [...chats.tabOrder.value, sent.id]
        chats.activeTabId.value = sent.id
        await wait(250)
        const sentChat = document.querySelector('.abele-node-chat')
        const sentScroll = sentChat.querySelector('.abele-ai-chat__messages')
        sentScroll.scrollTop = sentScroll.scrollHeight
        await wait(100)
        await screen('node answer sent', sentChat, sentScroll)
        report['node answer sent'].sent = sentChat.querySelector('.abele-node-permission')?.textContent.includes('Answer sent')
        report['node answer sent'].buttons = sentChat.querySelectorAll('.abele-node-permission button').length
        chats.nodeSessions.delete(sent.id)
        chats.tabOrder.value = chats.tabOrder.value.filter(id => id !== sent.id)
        const fence = String.fromCharCode(96).repeat(3)
        const codeReply = { ...claude, id: 'layout-node-code-tab', state: { value: 'idle' }, messages: { value: [{ id: 'reply', role: 'assistant', timestamp: 0, content: [fence + 'abele-message', 'chat: AI/Chats/sample.abchat', 'message: sample', '---', '![[sample-local-note.md]]', '[[sample-local-note]]', fence].join('\\n') }] }, projection: { value: { artifacts: [], unknown: [], children: {}, activeRuns: [], queuedInputs: [], prompts: [] } } }
        chats.nodeSessions.set(codeReply.id, codeReply)
        chats.tabOrder.value = [...chats.tabOrder.value, codeReply.id]
        chats.activeTabId.value = codeReply.id
        await until(() => document.querySelector('.abele-node-chat pre code'), 5000)
        await wait(200)
        const codeChat = document.querySelector('.abele-node-chat')
        await screen('node message code', codeChat, codeChat.querySelector('.abele-ai-chat__messages'))
        report['node message code'].cards = codeChat.querySelectorAll('.abele-message-card').length
        report['node message code'].code = codeChat.querySelector('pre code')?.textContent
        chats.nodeSessions.delete(codeReply.id)
        chats.tabOrder.value = chats.tabOrder.value.filter(id => id !== codeReply.id)
        chats.nodeSessions.delete(claude.id)
        chats.tabOrder.value = chats.tabOrder.value.filter(id => id !== claude.id)
        chats.activeTabId.value = presenter.id
        nodes.nodes.value = [...wasNodes, registration]
        nodes.connections.set(registration.id, { ...connection, client: { listSessions: async () => [{ title: 'Sample existing fake session', session_id: 'layout-session' }] }, state: { value: 'offline' }, error: { value: 'Connection unavailable' } })
        app.setting.open()
        app.setting.openTabById('abele')
        await until(() => document.querySelector('.abele-settings__nav .abele-tabs__tab'), 5000)
        ;[...document.querySelectorAll('.abele-settings__nav .abele-tabs__tab')].find(t => t.textContent.trim() === 'Nodes')?.click()
        await until(() => document.querySelector('input[aria-label="Node URL"]'), 5000)
        const modal = document.querySelector('.modal.mod-settings') || document.querySelector('.modal')
        const cuts = []
        for (const field of modal.querySelectorAll('input, button')) {
          if (!field.getBoundingClientRect().width) continue
          field.focus()
          for (const cut of ringClipped(field)) cuts.push(name(field) + ': ' + cut)
          field.blur()
        }
        await screen('settings nodes', modal, modal.querySelector('.vertical-tab-content'))
        report['settings nodes'].clipped = cuts
        const settingsScroll = modal.querySelector('.vertical-tab-content')
        if (settingsScroll) settingsScroll.scrollTop = 0
        await wait(200)
        await screen('settings nodes overview', modal, settingsScroll)
        ;[...modal.querySelectorAll('button')].find(button => button.textContent.trim() === 'Open session')?.click()
        await until(() => document.querySelector('.prompt .suggestion-item'), 5000)
        await wait(300)
        const picker = document.querySelector('.prompt')
        await screen('node session picker', picker, picker)
        await closeDialog()
      } finally {
        document.querySelector('.modal-setting-back-button')?.click()
        await until(() => document.querySelector('.abele-settings__nav .abele-tabs__tab'), 3000)
        app.setting.close()
        nodes.nodes.value = wasNodes
        nodes.connections.delete(registration.id)
        for (const id of [presenter.id, 'layout-claude-tab', 'layout-node-code-tab', 'layout-node-answer-tab']) {
          chats.nodeSessions.delete(id)
          chats.tabOrder.value = chats.tabOrder.value.filter(tab => tab !== id)
        }
        chats.activeTabId.value = active
      }
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

    ${MESSAGE_ACTIONS_SETUP}
    try {
      await screen('message actions', actionRow, actionRow)
      report['message actions'].targets = [...actionRow.querySelectorAll('button')].map(button => {
        const rect = button.getBoundingClientRect(); return [rect.width, rect.height]
      })
      actionRow.querySelector('[aria-label="More message actions"]').click()
      await wait(200)
      await screen('message actions menu', document.querySelector('.menu'), document.querySelector('.menu'))
      report['message actions menu'].labels = [...document.querySelectorAll('.menu-item-title')].map(item=>item.textContent.trim())
      await closeDialog()
      actionService.getSession(actionSourceId).preparingClone.value = true
      await wait(200)
      const pendingChat = [...document.querySelectorAll('.abele-ai-chat')].find(root=>root.getBoundingClientRect().width)
      await screen('chat copy pending', pendingChat, pendingChat)
      report['chat copy pending'].inputs = pendingChat.querySelectorAll('.abele-chat-input, .abele-ai-chat__header').length
      actionService.getSession(actionSourceId).preparingClone.value = false
    } finally { ${MESSAGE_ACTIONS_CLEANUP} }

    // Both selection-menu surfaces with long names and a list longer than the sheet.
    ${SELECTION_MENUS_SETUP}
    try {
      ${SELECTION_MENUS_OPEN}
      for (const [surface, label] of [['book', 'Books'], ['chat', 'Chats']]) {
        ;[...menuDoc.querySelectorAll('.abele-settings__selection-menus .abele-tabs__tab')].find(t => t.textContent.trim() === label)?.click()
        if (!await until(() => menuDoc.querySelector('.abele-selection-scripts-settings[data-surface="' + surface + '"]'), 5000)) throw Error('Selection surface did not open: ' + surface)
        await wait(300)
        const modal = menuDoc.querySelector('.modal.mod-settings') || menuDoc.querySelector('.modal')
        const scroll = modal.querySelector('.vertical-tab-content')
        if (scroll) scroll.scrollTop = 0
        await screen('settings selection ' + surface, modal, scroll)
        const cuts = []
        for (const field of modal.querySelectorAll('input, button, [tabindex="0"]')) {
          if (!field.getBoundingClientRect().width) continue
          field.focus()
          for (const cut of ringClipped(field)) cuts.push(name(field) + ': ' + cut)
          field.blur()
        }
        report['settings selection ' + surface].clipped = cuts
        if (scroll) scroll.scrollTop = scroll.scrollHeight
        await screen('settings selection ' + surface + ' bottom', modal, scroll)
      }
    } finally {
      ${SELECTION_MENUS_CLEANUP}
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
        if (page === 'AI Agent') {
          // The native title is stationary over the scrolling settings page. At the point where
          // the Secrets introduction moves behind it, the title needs an opaque surface.
          const secretsIntro = () => [...document.querySelectorAll('.abele-settings__ai .abele-section__heading')]
            .find((heading) => heading.textContent.trim() === 'Secrets')?.nextElementSibling
          await until(secretsIntro, 5000)
          const intro = secretsIntro()
          const settingsModal = document.querySelector('.modal.mod-settings') || document.querySelector('.modal')
          const header = settingsModal?.querySelector('.modal-header')
          const settingsScroll = settingsModal?.querySelector('.vertical-tab-content')
          const timeoutRow = [...document.querySelectorAll('.abele-settings__ai .setting-item')]
            .find((row) => row.querySelector('.setting-item-name')?.textContent === 'Request timeout (seconds)')
          if (timeoutRow?.querySelector('input') && settingsModal && settingsScroll) {
            timeoutRow.scrollIntoView({ block: 'center' })
            await wait(400)
            await screen('settings ai timeout', settingsModal, settingsScroll)
          }
          if (intro && header && settingsScroll) {
            settingsScroll.scrollTop += intro.getBoundingClientRect().top - header.getBoundingClientRect().bottom + 12
            await wait(400)
            await screen('settings ai secrets scroll', settingsModal, settingsScroll)
            report['settings ai secrets scroll'].headerCover = getComputedStyle(header).backgroundColor
            report['settings ai secrets scroll'].introTop = intro.getBoundingClientRect().top
            report['settings ai secrets scroll'].headerBottom = header.getBoundingClientRect().bottom
          } else {
            report['settings ai secrets scroll'] = { over: [], scrollers: [], capped: [], stranded: [], clipped: [], fill: 0, shot: '', error: 'no Secrets introduction or native settings header: ' + JSON.stringify({ intro: !!intro, header: !!header, scroll: !!settingsScroll }) }
          }
        }
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

    // Every other dialog of the plugin, each in the dialog shell, opened by name: nothing past
    // the edge, the whole dialog on the screen below the notch, its buttons in sight without
    // scrolling, and no field's focus ring cut.
    report.__dialogs = window.__abeleTest.dialogNames()
    for (const dialogName of report.__dialogs) {
      const label = 'dialog ' + dialogName
      const restoreRecipients = dialogName === 'key-destinations' ? recipientFixture() : null
      let fixtureCompletion, openingError
      try {
        fixtureCompletion = window.__abeleTest.openDialog(dialogName)
        // These contract fixtures prepare retained content before mounting, unlike approval
        // fixtures whose completion waits for the user to close them.
        if (['node-files', 'node-diffs', 'node-review', 'node-history'].includes(dialogName)) await fixtureCompletion
        fixtureCompletion?.catch(error => { openingError = error })
        if (!(await until(() => openingError || document.querySelector('.modal.abele-modal'), 5000))) throw new Error('did not open')
        if (openingError) throw openingError
        await wait(300)
        const modal = document.querySelector('.modal.abele-modal')
        if (dialogName === 'github-connections') {
          // Show the long connection rows, not the unrelated general settings above them.
          const heading = [...modal.querySelectorAll('.abele-section__heading')].find(el => el.textContent === 'Connections')
          heading?.scrollIntoView({ block: 'start' })
        }
        if (dialogName === 'chat-navigation') {
          if (modal.querySelector('input') === document.activeElement) throw new Error('Navigation opened the keyboard without a search tap')
          for (const details of [...modal.querySelectorAll('details')].slice(0, 2)) details.open = true
          await wait(200)
        }
        await screen(label, modal, modal.querySelector('.abele-modal__body'))
        if (dialogName === 'chat-navigation') {
          modal.querySelector('[data-fork-id="question-0"]').open = true
          await wait(150)
          modal.querySelector('[data-continuation="alternate"] details').open = true
          await wait(150)
          modal.querySelector('[data-fork-id="alternate"]').open = true
          await wait(150)
          await screen('navigation continuation', modal, modal.querySelector('.abele-modal__body'))
          for (const field of modal.querySelectorAll('input, select, button, summary, [tabindex="0"]')) {
            if (!field.getBoundingClientRect().width) continue
            field.focus(); report['navigation continuation'].clipped.push(...ringClipped(field)); field.blur()
          }
          const scope = modal.querySelector('select')
          scope.value = 'all'; scope.dispatchEvent(new Event('change', { bubbles: true }))
          const search = modal.querySelector('input')
          search.value = 'first nested'; search.dispatchEvent(new Event('input', { bubbles: true }))
          modal.querySelector('[role="checkbox"]').click()
          await wait(500)
          await screen('navigation search', modal, modal.querySelector('.abele-modal__body'))
          for (const field of modal.querySelectorAll('input, select, button, [tabindex="0"]')) {
            if (!field.getBoundingClientRect().width) continue
            field.focus(); report['navigation search'].clipped.push(...ringClipped(field)); field.blur()
          }
        }
        if (dialogName === 'github-connection-approval') {
          for (const p of modal.querySelectorAll('p')) if (p.scrollWidth > p.clientWidth + 1) {
            report[label].over.push('approval text exceeds its paragraph by ' + (p.scrollWidth-p.clientWidth) + 'px')
          }
        }
        const d = modal.getBoundingClientRect()
        report[label].edges = [Math.round(d.top), Math.round(d.bottom)]
        const footer = modal.querySelector('.abele-modal__footer')
        if (dialogName === 'key-destinations' || dialogName === 'saved-key-request') {
          report[label].pinnedActions = footer ? [...footer.querySelectorAll('button')].map(b => b.textContent.trim()) : []
          report[label].bodyActions = [...modal.querySelectorAll('.abele-modal__body button')].map(b => b.textContent.trim())
        }
        if (dialogName === 'key-destinations') {
          Object.assign(report[label], await recipientActions(modal))
          report[label].shot = await shoot(label)
          Object.assign(report[label], measure(modal, modal.querySelector('.abele-modal__body')))
        }
        report[label].hidden = footer
          ? [...footer.querySelectorAll('button')]
              .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.top < 0 || r.bottom > window.innerHeight) })
              .map((b) => b.textContent.trim())
          : []
        if (dialogName === 'node-workspaces') {
          for (const details of modal.querySelectorAll('details')) details.open = true
          const registration = [...modal.querySelectorAll('summary')].find(s => s.textContent.trim() === 'Register a project')
          registration?.scrollIntoView({ block: 'start' })
          await wait(200)
          await screen('node workspace registration', modal, modal.querySelector('.abele-modal__body'))
          const permissions = [...modal.querySelectorAll('summary')].find(s => s.textContent.trim() === 'Claude permission settings')
          permissions?.scrollIntoView({ block: 'start' })
          await wait(200)
          await screen('node workspace permissions', modal, modal.querySelector('.abele-modal__body'))
        }
        const clipped = []
        for (const f of modal.querySelectorAll('input, textarea, select, button, summary, [tabindex="0"], .cm-content[contenteditable="true"]')) {
          const cs = getComputedStyle(f)
          if (cs.display === 'none' || cs.visibility === 'hidden' || f.getBoundingClientRect().width === 0) continue
          f.focus()
          for (const cut of ringClipped(f)) clipped.push(name(f) + ': ' + cut)
          f.blur()
        }
        report[label].clipped = clipped
        if (dialogName === 'node-workspaces') {
          const preview = [...modal.querySelectorAll('summary')].find(s => s.textContent.trim() === 'Read-only status and HEAD diff')
          preview?.scrollIntoView({ block: 'start' })
          await wait(200)
          await screen('node workspace preview', modal, modal.querySelector('.abele-modal__body'))
          modal.querySelector('input[aria-label="Node session title"]')?.scrollIntoView({ block: 'start' })
          await wait(200)
          await screen('node workspace actions', modal, modal.querySelector('.abele-modal__body'))
        }
        if (dialogName === 'node-review') {
          const comment = modal.querySelector('textarea[aria-label="Review comment"]')
          comment?.scrollIntoView({ block: 'center' })
          await wait(200)
          await screen('node review comment', modal, modal.querySelector('.abele-modal__body'))
          if (!comment) report['node review comment'].error = 'No review comment field'
        }
        // The agent editor's interceptor, a script chosen and a pattern that does not compile
        // typed into its field: the picker, the field and the line saying why it was not kept.
        if (dialogName === 'agent-editor') {
          const registry = window.__abeleTest.AgentRegistry.getInstance()
          const agent = registry.list()[0]
          const was = { interceptorAgentId: agent.interceptorAgentId, interceptorScript: agent.interceptorScript, interceptorPattern: agent.interceptorPattern }
          try {
            registry.update(agent.id, { interceptorAgentId: replyReviewer.id, interceptorScript: '', interceptorPattern: '' })
            const replyRow = () => [...modal.querySelectorAll('.setting-item')].find(r => r.querySelector('.setting-item-name')?.textContent.trim() === 'Reply only')
            await until(() => replyRow(), 3000)
            const row = replyRow()
            if (row) row.scrollIntoView({ block: 'center' })
            await screen('agent editor reply only', modal, modal.querySelector('.abele-modal__body'))
            report['agent editor reply only'].replyToggle = !!row?.querySelector('.checkbox-container')
            registry.update(agent.id, { interceptorAgentId: '', interceptorScript: 'Phone probe guard', interceptorPattern: '' })
            await until(() => modal.querySelector('input[placeholder="^/todo"]'), 3000)
            const field = modal.querySelector('input[placeholder="^/todo"]')
            if (!field) throw new Error('no pattern field')
            field.value = '([a-'
            field.dispatchEvent(new Event('input', { bubbles: true }))
            await until(() => modal.querySelector('.mod-warning'), 3000)
            field.scrollIntoView({ block: 'center' })
            await wait(300)
            await screen('agent editor interceptor', modal, modal.querySelector('.abele-modal__body'))
            const cut = []
            for (const f of modal.querySelectorAll('input, textarea, select, button, [tabindex="0"]')) {
              const cs = getComputedStyle(f)
              if (cs.display === 'none' || cs.visibility === 'hidden' || f.getBoundingClientRect().width === 0) continue
              f.focus()
              for (const c of ringClipped(f)) cut.push(name(f) + ': ' + c)
              f.blur()
            }
            report['agent editor interceptor'].clipped = cut
            report['agent editor interceptor'].warning = !!modal.querySelector('.mod-warning')
            report['agent editor interceptor'].replyToggle = !!replyRow()?.querySelector('.checkbox-container')
          } finally {
            registry.update(agent.id, was)
          }
        }
        // The agent editor's Access tab: the tools, with the rows that set many at once.
        if (dialogName === 'agent-editor') {
          const access = [...modal.querySelectorAll('.abele-tabs__tab')].find((t) => t.textContent.trim() === 'Access')
          if (!access) throw new Error('no Access tab')
          access.click()
          await until(() => modal.querySelector('.abele-tool-modes__bulk'), 3000)
          await wait(300)
          await screen('agent editor access', modal, modal.querySelector('.abele-modal__body'))
          const cut = []
          for (const f of modal.querySelectorAll('input, textarea, select, button, [tabindex="0"]')) {
            const cs = getComputedStyle(f)
            if (cs.display === 'none' || cs.visibility === 'hidden' || f.getBoundingClientRect().width === 0) continue
            f.focus()
            for (const c of ringClipped(f)) cut.push(name(f) + ': ' + c)
            f.blur()
          }
          report['agent editor access'].clipped = cut
          // Off, Ask and Auto stay side by side in every row that sets many tools at once.
          report['agent editor access'].bulkRows = [...modal.querySelectorAll('.abele-tool-modes__bulk')].map(
            (row) => new Set([...row.querySelectorAll('button')].map((b) => Math.round(b.getBoundingClientRect().top))).size
          )
        }
      } catch (e) {
        report[label] = { over: [], scrollers: [], capped: [], clipped: [], fill: 0, shot: '', error: String((e && e.message) || e) }
      } finally {
        if (restoreRecipients || fixtureCompletion) {
          const entry = report[label] ??= { over: [], scrollers: [], capped: [], clipped: [], fill: 0, shot: '', error: '' }
          const closeOwnedFixture = async () => {
            if (document.querySelector('.modal[data-abele-fixture="' + dialogName + '"]')) await closeDialog()
          }
          // The next inventory entry cannot mutate state until this restoration and its
          // verification have settled; rejected cleanup is part of this entry's failure.
          await cleanupRecipientConsumer(entry, closeOwnedFixture, restoreRecipients, fixtureCompletion)
        } else await closeDialog()
      }
    }

    // The timeline's calendar opens in a main tab too, not only the right sidebar. Obsidian's
    // native floating view header must be above its calendar, not painted over the first week.
    await nodeScreens()
    const timelineLeaf = app.workspace.getLeaf('tab')
    try {
      await timelineLeaf.setViewState({ type: 'abele-timeline-sidebar-view', active: true })
      app.workspace.setActiveLeaf(timelineLeaf, { focus: true })
      const timeline = await until(() => timelineLeaf.view.containerEl.querySelector('.abele-timeline-sidebar'), 5000)
      const root = timelineLeaf.view.containerEl.querySelector('.abele-timeline-sidebar')
      const calendar = root?.querySelector('.abele-calendar')
      const header = timelineLeaf.view.containerEl.querySelector('.view-header')
      if (timeline && calendar && header) {
        await screen('timeline main tab', root, root)
        report['timeline main tab'].calendarGap = Math.round(calendar.getBoundingClientRect().top - header.getBoundingClientRect().bottom)
        report['timeline main tab'].scrollHeight = root.clientHeight
      } else report['timeline main tab'] = { over: [], scrollers: [], capped: [], clipped: [], fill: 0, shot: '', error: 'no main-tab calendar or view header' }
    } finally {
      timelineLeaf.detach()
    }

    // Human canvas controls and native Obsidian pickers at the same phone width.
    {
      const reference = await app.vault.create('Phone probe/sample-reference.md', 'Sample note on a canvas.')
      const file = await app.vault.create('Phone probe/sample-editor.canvas', JSON.stringify({nodes:[
        {id:'alpha',type:'text',text:'First concept',x:0,y:0,width:200,height:140},
        {id:'beta',type:'text',text:'Second concept',x:280,y:0,width:200,height:140},
        {id:'gamma',type:'text',text:'Third concept',x:0,y:220,width:200,height:140},
        {id:'sample-reference',type:'file',file:reference.path,x:280,y:220,width:220,height:140}
      ],edges:[{id:'sample-flow',fromNode:'alpha',toNode:'beta',label:'Next'}]}))
      SEEDED.push(file.path, reference.path)
      const leaf = app.workspace.getLeaf('tab')
      try {
        await leaf.setViewState({type:'abele-canvas',state:{file:file.path},active:true})
        await app.workspace.revealLeaf(leaf)
        await until(()=>leaf.view.editor,5000)
        const root=leaf.view.contentEl
        await screen('canvas editor',root,root)
        {const v=leaf.view.viewer,c=v.camera;report['canvas editor'].canvasFits=v.graph.nodes.every(n=>
          (n.x-c.x)*c.zoom>=0&&(n.y-c.y)*c.zoom>=0&&
          (n.x+n.width-c.x)*c.zoom<=v.stage.clientWidth&&
          (n.y+n.height-c.y)*c.zoom<=v.stage.clientHeight)}
        // Layout inventory only; actual mouse/touch acceptance is in canvasGeometry.
        const select=id=>{
          const viewer=leaf.view.viewer,n=viewer.graph.nodes.find(n=>n.id===id),c=viewer.camera,r=viewer.stage.getBoundingClientRect()
          const init={pointerId:1,pointerType:'touch',clientX:r.left+(n.x+n.width/2-c.x)*c.zoom,clientY:r.top+(n.y+n.height/2-c.y)*c.zoom,bubbles:true}
          for(const type of ['pointerdown','pointerup'])viewer.stage.dispatchEvent(new PointerEvent(type,init))
        }
        root.querySelector('[aria-label="Canvas drawing tools"]').click()
        root.querySelector('[aria-label="Draw with pen"]').click()
        await screen('canvas pen controls',root,root)
        report['canvas pen controls'].clipped=[]
        for(const field of root.querySelectorAll('select,button')){if(!field.getBoundingClientRect().width)continue;field.focus();report['canvas pen controls'].clipped.push(...ringClipped(field));field.blur()}
        {const v=leaf.view.viewer,c=v.camera,r=v.stage.getBoundingClientRect(),n=v.graph.nodes.find(n=>n.id==='alpha'),init={pointerId:1,pointerType:'touch',buttons:1,clientX:r.left+(n.x+n.width/2-c.x)*c.zoom,clientY:r.top+(n.y+n.height/2-c.y)*c.zoom,bubbles:true},before=r.top
          v.stage.dispatchEvent(new PointerEvent('pointerdown',init))
          v.stage.dispatchEvent(new PointerEvent('pointermove',{...init,clientX:init.clientX+30,clientY:init.clientY+10}));await wait(100)
          await screen('canvas ink preview',root,root)
          report['canvas ink preview'].stageTop=[before,v.stage.getBoundingClientRect().top]
          v.stage.dispatchEvent(new PointerEvent('pointercancel',init))}
        root.querySelector('[aria-label="Erase part of strokes"]').click()
        await screen('canvas eraser controls',root,root)
        report['canvas eraser controls'].clipped=[]
        for(const field of root.querySelectorAll('select,button')){if(!field.getBoundingClientRect().width)continue;field.focus();report['canvas eraser controls'].clipped.push(...ringClipped(field));field.blur()}
        {const v=leaf.view.viewer,c=v.camera,r=v.stage.getBoundingClientRect(),init={pointerId:1,pointerType:'touch',buttons:1,clientX:r.left+r.width/2,clientY:r.top+r.height/2,bubbles:true},before=r.top
          v.stage.dispatchEvent(new PointerEvent('pointerdown',init))
          v.stage.dispatchEvent(new PointerEvent('pointermove',{...init,clientX:init.clientX+30}));await wait(100)
          await screen('canvas eraser preview',root,root)
          report['canvas eraser preview'].stageTop=[before,v.stage.getBoundingClientRect().top]
          v.stage.dispatchEvent(new PointerEvent('pointercancel',init))}
        root.querySelector('[aria-label="Lasso canvas objects"]').click()
        select('alpha');await wait(100)
        root.querySelector('.abele-canvas-shape-controls details').open=true
        await screen('canvas lasso selection actions',root,root)
        report['canvas lasso selection actions'].clipped=[]
        for(const field of root.querySelectorAll('select,button,summary')){if(!field.getBoundingClientRect().width)continue;field.focus();report['canvas lasso selection actions'].clipped.push(...ringClipped(field));field.blur()}
        root.querySelector('.abele-canvas-shape-controls details').open=false
        root.querySelector('[aria-label="Canvas drawing tools"]').click()
        root.querySelector('[aria-label="Shapes and connections"]').click()
        await screen('canvas shapes',root,root)
        report['canvas shapes'].clipped=[]
        for(const field of root.querySelectorAll('select,button')){if(!field.getBoundingClientRect().width)continue;field.focus();report['canvas shapes'].clipped.push(...ringClipped(field));field.blur()}
        root.querySelector('[aria-label="Shapes and connections"]').click()
        {const v=leaf.view.viewer,c=v.camera,r=v.stage.getBoundingClientRect(),init={pointerId:1,pointerType:'touch',clientX:r.left+(240-c.x)*c.zoom,clientY:r.top+(70-c.y)*c.zoom,bubbles:true}
          for(const type of ['pointerdown','pointerup'])v.stage.dispatchEvent(new PointerEvent(type,init))}
        const properties=root.querySelector('.abele-canvas-connection-properties')
        properties.open=true
        await screen('canvas connection style',root,root)
        report['canvas connection style'].handles=[...root.querySelectorAll('.abele-canvas-endpoint-handle')].map(el=>{const r=el.getBoundingClientRect();return [r.width,r.height]})
        report['canvas connection style'].clipped=[]
        for(const field of root.querySelectorAll('input,select,button,summary')){if(!field.getBoundingClientRect().width)continue;field.focus();report['canvas connection style'].clipped.push(...ringClipped(field));field.blur()}
        properties.open=false
        select('alpha');await wait(100)
        await screen('canvas selection',root,root)
        report['canvas selection'].handles=[...root.querySelectorAll('.abele-canvas-resize-handle')].map(el=>{const r=el.getBoundingClientRect();return [r.width,r.height]})
        root.querySelector('[aria-label="Shapes and connections"]').click()
        root.querySelector('[aria-label="Draw connection"]').click();await wait(100)
        {const v=leaf.view.viewer,c=v.camera,r=v.stage.getBoundingClientRect(),n=v.graph.nodes.find(n=>n.id==='alpha'),init={pointerId:1,pointerType:'touch',clientX:r.left+(n.x+n.width/2-c.x)*c.zoom,clientY:r.top+(n.y+n.height/2-c.y)*c.zoom,bubbles:true},before=r.top
          v.stage.dispatchEvent(new PointerEvent('pointerdown',init))
          v.stage.dispatchEvent(new PointerEvent('pointermove',{...init,clientX:init.clientX+30}));await wait(100)
          await screen('canvas connector preview',root,root)
          report['canvas connector preview'].stageTop=[before,v.stage.getBoundingClientRect().top]
          v.stage.dispatchEvent(new PointerEvent('pointercancel',init))}
        root.querySelector('[aria-label="Select canvas objects"]').click()
        root.querySelector('[aria-label="Shapes and connections"]').click()
        root.querySelector('[aria-label="Toggle multiple selection"]').click()
        select('beta');select('gamma')
        root.querySelector('[aria-label="Group selected cards"]').click()
        await until(()=>!leaf.view.documentLease.document.session.dirty,5000)
        root.querySelector('[aria-label="Fit diagram"]').click();await wait(350)
        await screen('canvas group',root,root)
        report['canvas group'].clipped=[]
        for(const field of root.querySelectorAll('button')){if(!field.getBoundingClientRect().width)continue;field.focus();report['canvas group'].clipped.push(...ringClipped(field));field.blur()}
        root.querySelector('[aria-label="Toggle multiple selection"]').click()
        leaf.view.containerEl.querySelector('[aria-label="Export diagram picture"]').click()
        await until(()=>document.querySelector('.menu'),5000)
        await screen('canvas export menu',document.querySelector('.menu'))
        document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))
        await wait(200)
        root.querySelector('[aria-label="Add note or attachment"]').click()
        await until(()=>document.querySelector('.prompt'),5000)
        await screen('canvas file picker',document.querySelector('.prompt'))
        await closeDialog();await wait(200)
        root.querySelector('[aria-label="Add link"]').click()
        await until(()=>document.querySelector('.abele-canvas-input'),5000)
        const input=document.querySelector('.abele-canvas-input')
        await screen('canvas link input',input,input.querySelector('.abele-modal__body'))
        report['canvas link input'].clipped=[]
        for(const field of input.querySelectorAll('input,button')){field.focus();report['canvas link input'].clipped.push(...ringClipped(field));field.blur()}
        await closeDialog();await wait(200)
        root.querySelector('[aria-label="Add text card"]').click()
        await screen('canvas text draft',root,root)
        report['canvas text draft'].clipped=[]
        for(const field of root.querySelectorAll('textarea,button')){if(!field.getBoundingClientRect().width)continue;field.focus();report['canvas text draft'].clipped.push(...ringClipped(field));field.blur()}
        await app.fileManager.renameFile(reference,'Phone probe/sample-renamed-reference.md')
        SEEDED.push(reference.path)
        await until(()=>leaf.view.viewer.graph.nodes.some(n=>n.file===reference.path),5000)
        await screen('canvas renamed draft',root,root)
        leaf.view.containerEl.querySelector('[aria-label="Open in Obsidian Canvas"]').click()
        await until(()=>document.querySelector('.abele-canvas-choice'),5000)
        const choice=document.querySelector('.abele-canvas-choice')
        await screen('canvas native handoff',choice,choice.querySelector('.abele-modal__body'))
        report['canvas native handoff'].clipped=[]
        for(const field of choice.querySelectorAll('button')){field.focus();report['canvas native handoff'].clipped.push(...ringClipped(field));field.blur()}
        await closeDialog();await wait(200)
        root.querySelector('[aria-label="Discard local draft"]').click()
        await until(()=>document.querySelector('.abele-canvas-choice'),5000)
        const discard=document.querySelector('.abele-canvas-choice')
        await screen('canvas draft discard',discard,discard.querySelector('.abele-modal__body'))
        report['canvas draft discard'].clipped=[]
        for(const field of discard.querySelectorAll('button')){field.focus();report['canvas draft discard'].clipped.push(...ringClipped(field));field.blur()}
        await closeDialog();await wait(200)
        leaf.view.documentLease.document.discardDraft()
        app.commands.executeCommandById('abele:new-canvas')
        await until(()=>document.querySelector('.abele-canvas-input'),5000)
        const create=document.querySelector('.abele-canvas-input')
        await screen('canvas creation',create,create.querySelector('.abele-modal__body'))
        report['canvas creation'].clipped=[]
        for(const field of create.querySelectorAll('input,button')){field.focus();report['canvas creation'].clipped.push(...ringClipped(field));field.blur()}
        await closeDialog()
        const scope=new window.__abeleTest.ScopeResolver();scope.setFullVaultAccess(true)
        const ctx={scope,interactive:true},tools=Object.fromEntries(window.__abeleTest.createAgentTools().map(t=>[t.name,t]))
        let snapshot=JSON.parse((await tools.canvas_read.execute('read',{path:file.path},undefined,ctx)).content[0].text)
        await tools.canvas_edit.execute('ink',{path:file.path,revision:snapshot.revision,ops:[
          {op:'add_ink',node:'alpha',stroke:{version:1,id:'attached-ink',tool:'pen',points:[20,30,0.5,160,30,0.8],frame:{width:200,height:140}}},
          {op:'add_ink',stroke:{version:1,id:'free-ink',tool:'marker',points:[20,170,0.5,160,170,0.5]}}
        ]},undefined,ctx)
        snapshot=JSON.parse((await tools.canvas_read.execute('read',{path:file.path},undefined,ctx)).content[0].text)
        await tools.canvas_steps.execute('steps',{path:file.path,revision:snapshot.revision,ops:[{op:'replace',steps:[{id:'ink-step',reveal:['alpha','free-ink'],highlight:['attached-ink','free-ink'],say:'Two strokes in the same diagram.',focus:{x:-30,y:-20,width:260,height:230}}]}]},undefined,ctx)
        root.querySelector('[aria-label="Play walkthrough"]').click();await wait(350)
        await screen('canvas agent strokes',root,root)
        const shown=JSON.parse((await tools.canvas_read.execute('read',{path:file.path,step:1},undefined,ctx)).content[0].text)
        report['canvas agent strokes'].ids=shown.ink.map(s=>s.id)
      } finally {
        await closeDialog()
        leaf.view.documentLease?.document.discardDraft()
        leaf.detach()
      }
    }

    // Canvas-only inventory through the existing registered action; no shared dialog API fixture.
    await (async () => { ${PUBLICATION_SETUP} })()
    try {
      await (async () => { ${publicationFault('persisted')} })()
      await (async () => {
        ${PUBLICATION_PRELUDE}
        const action=fixture.view.containerEl.querySelector('[aria-label="Recover failed canvas change"]')
        if(!action)throw Error('Canvas recovery action missing from inventory')
        action.click()
        await until(()=>modal(), 'inventory-review')
        for(const label of ${JSON.stringify(CANVAS_SCREENS)}){
          if(label==='canvas publication confirmation'){
            const button=[...modal().querySelectorAll('button')].find(el=>el.textContent==='Discard local pending copy…')
            if(!button)throw Error('Canvas confirmation action missing')
            button.click();await until(()=>modal()?.textContent.includes('does not undo'), 'inventory-confirmation')
          }
          const root=modal()
          if(root!==fixture.view.publicationReviewModal?.modalEl)throw Error('Canvas inventory owner changed')
          const captureLabel=label+'-'+Date.now()+'-'+Math.random().toString(16).slice(2,10)
          await screen(captureLabel,root,root.querySelector('.abele-modal__body'))
          report[label]=report[captureLabel];delete report[captureLabel]
          const bounds=root.getBoundingClientRect()
          report[label].edges=[Math.round(bounds.top),Math.round(bounds.bottom)]
          report[label].hidden=[...root.querySelectorAll('.abele-modal__footer button')].filter(el=>{
            const r=el.getBoundingClientRect();return r.width>0&&(r.top<0||r.bottom>innerHeight)
          }).map(el=>el.textContent.trim())
          report[label].clipped=[]
          for(const field of root.querySelectorAll('button,summary')){
            field.focus();for(const cut of ringClipped(field))report[label].clipped.push(name(field)+': '+cut);field.blur()
          }
          report[label].retained=retained()===fixture.retained
          report[label].sourceSame=await app.vault.read(fixture.file)===fixture.before
          report[label].process=fixture.processCalls;report[label].ack=fixture.ackCalls;report[label].undo=fixture.session.history.undo
          report[label].baselineLabel=root.querySelector('[data-review="baseline"]')?.parentElement.querySelector('summary')?.textContent??null
        }
      })()
    } catch(error) {
      for(const label of ${JSON.stringify(CANVAS_SCREENS)})if(!report[label])report[label]={over:[],scrollers:[],capped:[],stranded:[],clipped:[],fill:0,shot:'',error:String(error?.message??error)}
    } finally {
      await (async () => { ${PUBLICATION_CLEANUP} })()
    }

    // A changelog is a tab, not a sheet; its Notice is transient, not a modal. The final
    // bullet and paging control must be scrollable above Obsidian's mobile navigation.
    app.commands.executeCommandById('abele:open-changelog')
    const changelogLeaf = () => app.workspace.getLeavesOfType('abele-changelog')[0]
    if (await until(() => changelogLeaf()?.view.contentEl.querySelector('.abele-changelog article'), 8000)) {
      const content = changelogLeaf().view.contentEl
      const scroller = content.querySelector('.abele-changelog__scroll')
      const controlRings = root => [...root.querySelectorAll('button')].flatMap(button => {
        button.focus(); const cuts=ringClipped(button); button.blur(); return cuts
      })
      await screen('changelog all', content)
      report['changelog all'].clipped = controlRings(content)
      const older = [...content.querySelectorAll('button')].find(b => b.textContent.includes('Show older versions'))
      if (older) older.click()
      await wait(150)
      scroller.scrollTop = scroller.scrollHeight
      await screen('changelog older', content)
      const navbar = document.querySelector('.mobile-navbar')
      const last = [...scroller.querySelectorAll('li, button')].pop()
      report['changelog older'].covered = last && navbar && navbar.getBoundingClientRect().height
        ? Math.max(0, Math.round(last.getBoundingClientRect().bottom - navbar.getBoundingClientRect().top)) : 0
      await changelogLeaf().setViewState({ type: 'abele-changelog', state: { range: { from: '1.56.0', to: '1.58.0' } }, active: true })
      await wait(200)
      await screen('changelog filtered', content)
      report['changelog filtered'].clipped = controlRings(content)
      const hide = window.__abeleTest.showChangelogOffer(app, { from: '1.56.0', to: '1.58.0' })
      try {
        await wait(150)
        const notice = [...document.querySelectorAll('.notice')].find(n => n.textContent.includes("What's new"))
        if (notice) { await screen('changelog notice', notice); report['changelog notice'].clipped=controlRings(notice) }
        else report['changelog notice'] = { over: [], scrollers: [], capped: [], clipped: [], fill: 0, shot: '', error: 'update notice did not open' }
      } finally { hide() }
      changelogLeaf().detach()
    } else report['changelog all'] = { over: [], scrollers: [], capped: [], clipped: [], fill: 0, shot: '', error: 'changelog did not open' }

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
    // The renderer is shared by AbeleMap (chat/script UI) and maps inside notes. Location
    // must be available on a phone without automatically requesting personal data.
    const mapRoot = document.createElement('div')
    mapRoot.className = 'abele-map'
    Object.assign(mapRoot.style, { position: 'fixed', width: 'auto', left: '12px', right: '12px', top: '90px', height: '320px', zIndex: '1000' })
    document.body.appendChild(mapRoot)
    let mapHandle
    try {
      mapHandle = await window.__abeleTest.renderMap(mapRoot, {
        points: [], lines: [], center: { lat: 12.345, lon: 67.89 }, height: 320, interactive: true,
      })
      await screen('map location', mapRoot)
      const edge = mapRoot.getBoundingClientRect()
      const buttons = [...mapRoot.querySelectorAll('.maplibregl-ctrl button')]
      report['map location'].locationLabel = mapRoot.querySelector('button[aria-label="Show my location"]')?.title || ''
      const scale = mapRoot.querySelector('.maplibregl-ctrl-scale')?.getBoundingClientRect()
      const attribution = mapRoot.querySelector('.maplibregl-ctrl-attrib')?.getBoundingClientRect()
      report['map location'].scaleOverlap = !!scale && !!attribution &&
        scale.left < attribution.right && scale.right > attribution.left &&
        scale.top < attribution.bottom && scale.bottom > attribution.top
      report['map location'].controlOverflow = buttons.filter(button => {
        const r = button.getBoundingClientRect()
        return r.left < edge.left || r.right > edge.right || r.top < edge.top || r.bottom > edge.bottom
      }).map(button => button.getAttribute('aria-label') || button.title)
    } finally {
      mapHandle?.destroy()
      mapRoot.remove()
    }
    const wordPath = 'sample-word-layout.docx'
    const wordBytes = Uint8Array.from(atob(${JSON.stringify(WORD_SAMPLE)}), c => c.charCodeAt(0))
    const wordFile = await app.vault.createBinary(wordPath, wordBytes.buffer)
    const wordLeaf = app.workspace.getLeaf('tab')
    try {
      await wordLeaf.setViewState({ type: 'abele-word', state: { file: wordPath }, active: true })
      await app.workspace.revealLeaf(wordLeaf)
      await until(() => wordLeaf.view.contentEl.querySelector('iframe')?.contentDocument?.querySelector('section.docx'), 15000)
      await screen('word document', wordLeaf.view.contentEl)
      report['word document'].handEditing = !!wordLeaf.view.contentEl.querySelector('.abele-word-edit')
    } finally {
      wordLeaf.detach()
      await app.vault.delete(wordFile)
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

/** A phone's window is its screen: measured, never set. */
const windowSize = (): [number, number] =>
  onPhone()
    ? evalJson<[number, number]>(`[innerWidth, innerHeight]`, 30_000)
    : evalJson<[number, number]>(
        `require('@electron/remote').getCurrentWindow().getContentSize()`,
        30_000
      )

const setWindowSize = async (width: number, height: number): Promise<void> => {
  if (onPhone()) return
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

describe.skipIf(!available)('the GitHub base picker on a phone', () => {
  let gh: FakeGithub, size: [number, number]
  beforeAll(async () => {
    size = windowSize()
    await setMobile(true)
    await setWindowSize(PHONE.width, PHONE.height)
    gh = await startFakeGithub()
    enableGithub(gh.origin, false)
  }, 90000)
  afterAll(async () => {
    try { restoreGithub() } finally { gh?.stop() }
    if (size?.[0]) await setWindowSize(size[0], size[1])
    await setMobile(false)
  }, 120000)
  it('shows the resolved SHA and keeps the native prompt and field ring within the phone', () => {
    const result = evalBase<{ clipped: string[]; over: string[]; sha: string; width: number; shot: string }>(`(async () => {
      ${BASE_PRELUDE}
      ${openBasePicker(gh.web)}
      ${basePickerGeometry}
      const shot = ${JSON.stringify(SHOTS + '/github-base-picker.png')}
      if (window.__e2eHost) pickerReport.shot = await window.__e2eHost.shot(shot)
      else { require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true }); const image = await require('@electron/remote').getCurrentWebContents().capturePage(); require('fs').writeFileSync(shot, image.toPNG()); pickerReport.shot = shot }
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
      return pickerReport
    })()`)
    expect(result.clipped).toEqual([])
    expect(result.over).toEqual([])
    expect(result.width).toBeGreaterThan(100)
    expect(result.sha).toContain(BASE_SHA)
    expect(result.shot).toMatch(/\.png$/)
  }, 90000)
})

describe.skipIf(!available)('the node repository tab on a phone', () => {
  let size: [number, number]
  beforeAll(async () => {
    size = windowSize()
    await setMobile(true)
    await setWindowSize(PHONE.width, PHONE.height)
  }, 90000)
  afterAll(async () => {
    evalRaw('window.__abeleTest.closeNodeRepositoryFixture()')
    if (size?.[0]) await setWindowSize(size[0], size[1])
    await setMobile(false)
  }, 120000)
  for (const state of ['home', 'file', 'changes', 'compare', 'commits', 'empty', 'missing', 'offline']) {
    it(`keeps the node repository ${state} readable in a full-width native leaf`, async () => {
      const result = JSON.parse(await evalLong(`(async () => {
        await window.__abeleTest.openNodeRepositoryFixture(${JSON.stringify(state)});
        await new Promise(r => setTimeout(r, 250));
        const root = [...document.querySelectorAll('.abele-github, .abele-node-repository__unavailable')].find(el => el.getBoundingClientRect().width > 0);
        if (!root) throw Error('Repository tab missing');
        const box = root.getBoundingClientRect();
        const repo = root.querySelector('.abele-github-header__repo');
        if (repo?.textContent.trim() && repo.getBoundingClientRect().width < 300) throw Error('Repository name squeezed beside actions');
        const clipped = [...root.querySelectorAll('button,select,[role="button"]')].filter(el => {
          const r=el.getBoundingClientRect();return r.width > 0 && (r.left < -1 || r.right > innerWidth+1)
        }).map(el => el.getAttribute('aria-label') || el.textContent);
        const hitBoxes = [...root.querySelectorAll('.abele-github-header [role="button"]')].map(el => {const r=el.getBoundingClientRect();return {width:r.width,height:r.height}});
        const shot=${JSON.stringify(SHOTS)}+'/node-repository-${state}.png';
        require('fs').mkdirSync(${JSON.stringify(SHOTS)},{recursive:true});
        const image=await require('@electron/remote').getCurrentWebContents().capturePage();require('fs').writeFileSync(shot,image.toPNG());
        return JSON.stringify({width:box.width,left:box.left,right:box.right,clipped,hitBoxes,shot});
      })()`)) as {width:number;left:number;right:number;clipped:string[];hitBoxes:{width:number;height:number}[];shot:string}
      expect(result.width).toBeGreaterThan(300)
      expect(result.left).toBeGreaterThanOrEqual(0)
      expect(result.right).toBeLessThanOrEqual(PHONE.width)
      expect(result.clipped).toEqual([])
      expect(result.hitBoxes.every(box => box.width >= 44 && box.height >= 44)).toBe(true)
      expect(result.shot).toMatch(/\.png$/)
    }, 90000)
  }
})

describe.skipIf(!available)('the chat dialogs on a phone', () => {
  let report: Report = {}
  let size: [number, number] = [0, 0]

  beforeAll(async () => {
    size = windowSize()
    await setMobile(true)
    await setWindowSize(PHONE.width, PHONE.height)
    // On a phone this probe runs longer than one call may block for: see `evalLong`.
    report = JSON.parse(await evalLong(probeScript, 320_000)) as Report

    const lines = Object.entries(report).map(
      ([label, s]) => `  ${label.padEnd(20)} ${s.shot || s.error}`
    )
    console.info(`\n  vault ...................... ${activeVaultName()}\n${lines.join('\n')}\n`)
    console.info('recipient action measurements', JSON.stringify(report['dialog key-destinations']))
  }, 480_000)

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
    'message actions',
    'message actions menu',
    'chat copy pending',
    'navigation continuation',
    'navigation search',
    'node chat',
    'node claude chat',
    'node claude permission',
    'node answer sent',
    'node message code',
    'node workspace preview',
    'node workspace actions',
    'node review comment',
    'node workspace registration',
    'node workspace permissions',
    'settings nodes',
    'settings nodes overview',
    'settings selection book',
    'settings selection chat',
    'settings selection book bottom',
    'settings selection chat bottom',
    'node session picker',
    'chat attachment',
    'chat deferred media',
    'chat image preview',
    'setup scope',
    'setup skills',
    'setup prompts',
    'setup tools',
    'setup settings',
    'setup settings reply only',
    'agent editor reply only',
    'setup debug',
    'history',
    'nested comment',
    'nested comment folded',
    'nested comment opened',
    'chat artifacts',
    'note picker',
    'chat picker',
    'icon picker',
    'icon picker search',
    'link write',
    'secrets list',
    'settings ai keys',
    'settings ai timeout',
    'settings ai secrets scroll',
    'settings finance keys',
    'settings mcp',
    'mcp server',
    'rewind',
    'script form',
    'selection script picker',
    'selection script picker bottom',
    'docs page',
    'docs contents',
    'docs search result',
    'script form picker',
    'timeline main tab',
    'map location',
    'word document',
    'canvas editor',
    'canvas selection',
    'canvas pen controls',
    'canvas ink preview',
    'canvas agent strokes',
    'canvas eraser controls',
    'canvas eraser preview',
    'canvas lasso selection actions',
    'canvas shapes',
    'canvas connection style',
    'canvas connector preview',
    'canvas group',
    'canvas export menu',
    'canvas file picker',
    'canvas link input',
    'canvas text draft',
    'canvas renamed draft',
    'canvas native handoff',
    'canvas draft discard',
    'canvas creation',
    ...CANVAS_SCREENS,
    'publication confirmation',
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

  it.each(['settings selection book', 'settings selection chat'])(
    '%s: every field and action keeps its focus ring',
    (label) => {
      expect(report[label]?.clipped).toEqual([])
    }
  )
  it('selection picker pins align to the first title line and have touch-sized targets', () => {
    const picker = report['selection script picker'] as Screen & { pins: { offset: number; width: number; height: number }[] }
    expect(picker.pins.length).toBeGreaterThan(0)
    for (const pin of picker.pins) {
      expect(Math.abs(pin.offset)).toBeLessThanOrEqual(1)
      expect(pin.width).toBeGreaterThanOrEqual(44)
      expect(pin.height).toBeGreaterThanOrEqual(44)
    }
  })
  it('message actions have phone-sized targets and keep branching and cloning in the native menu', () => {
    const actions = report['message actions'] as Screen & { targets: number[][] }
    expect(actions.clipped).toEqual([])
    expect(actions.targets.length).toBeGreaterThan(1)
    for (const [width, height] of actions.targets) {
      expect(width).toBeGreaterThanOrEqual(44)
      expect(height).toBeGreaterThanOrEqual(44)
    }
    const menu = report['message actions menu'] as Screen & { labels: string[] }
    expect(menu.labels).toContain('Branch from here')
    expect(menu.labels).toContain('New chat from here')
    expect((report['chat copy pending'] as Screen & { inputs: number }).inputs).toBe(0)
  })

  it('node session chrome leaves space for messages and keeps one compact approval and queue row', () => {
    const header = report['node claude chat'] as Screen & { headerHeight: number }
    const permission = report['node claude permission'] as Screen & {
      actionRows: number
      accent: boolean
      queueCopies: number
    }
    expect(header.headerHeight).toBeLessThan(60)
    expect(permission.actionRows).toBe(1)
    expect(permission.accent).toBe(true)
    expect(permission.queueCopies).toBe(1)
    expect(permission.clipped).toEqual([])
  })

  it('a restored sent answer offers no second approval or denial on a phone', () => {
    const sent = report['node answer sent'] as Screen & { sent: boolean; buttons: number }
    expect(sent.sent).toBe(true)
    expect(sent.buttons).toBe(0)
  })

  it('node message blocks remain plain code on a phone rather than vault-backed cards', () => {
    const code = report['node message code'] as Screen & { cards?: number; code?: string }
    expect(code?.cards).toBe(0)
    expect(code?.code).toContain('![[sample-local-note.md]]')
  })

  it('deferred media keeps attachment, dictation and editing controls available on a phone', () => {
    const screen = report['chat deferred media'] as Screen & {
      attach: boolean
      voice: boolean
      edit: boolean
      attachment: boolean
    }
    expect(screen?.attach).toBe(true)
    expect(screen?.voice).toBe(true)
    expect(screen?.edit).toBe(true)
    expect(screen?.attachment).toBe(true)
  })

  it('canvas editor: initially frames the diagram after its controls take space', () => {
    expect(report['canvas editor']?.canvasFits).toBe(true)
  })

  it('canvas agent strokes: free and attached ink remain readable in walkthroughs', () => {
    expect(report['canvas agent strokes']?.ids).toEqual(['attached-ink', 'free-ink'])
  })

  it('canvas ink preview: the toolbar does not shift the captured pointer surface', () => {
    const top = report['canvas ink preview']?.stageTop
    expect(top).toHaveLength(2)
    expect(top?.[1]).toBe(top?.[0])
  })
  it('canvas eraser preview: the toolbar does not shift the captured pointer surface', () => {
    const top = report['canvas eraser preview']?.stageTop
    expect(top).toHaveLength(2)
    expect(top?.[1]).toBe(top?.[0])
  })
  it('canvas connector preview: the toolbar does not shift the captured pointer surface', () => {
    const top = report['canvas connector preview']?.stageTop
    expect(top).toHaveLength(2)
    expect(top?.[1]).toBe(top?.[0])
  })

  it('canvas connection style: both endpoint targets remain touch-sized at phone width', () => {
    expect(report['canvas connection style']?.handles).toEqual(
      Array.from({ length: 2 }, () => [44, 44])
    )
  })

  it('canvas selection: all four corner targets remain touch-sized at phone width', () => {
    expect(report['canvas selection']?.handles).toEqual(Array.from({ length: 4 }, () => [44, 44]))
  })

  it.each([
    'canvas link input',
    'canvas text draft',
    'canvas native handoff',
    'canvas draft discard',
    'canvas creation',
    'canvas group',
    'canvas pen controls',
    'canvas eraser controls',
    'canvas lasso selection actions',
    'canvas shapes',
    'canvas connection style',
  ])('%s: every field and action keeps its focus ring', (label) => {
    expect(report[label]?.clipped ?? ['no report']).toEqual([])
  })

  it('Word documents fit the phone layout and offer no hand editing', () => {
    const screen = report['word document'] as Screen & { handEditing?: boolean }
    expect(screen?.error).toBe('')
    expect(screen?.handEditing).toBe(false)
    expect(screen?.over).toEqual([])
    expect(screen?.clipped).toEqual([])
    expect(screen?.capped).toEqual([])
    expect(screen?.scrollers.length).toBeLessThanOrEqual(1)
  })

  it('reaches every screen', () => {
    expect(report.run?.error ?? '').toBe('')
    expect(
      ((report as unknown as { __dialogs?: string[] }).__dialogs ?? []).map((n) => `dialog ${n}`)
    ).toEqual(DIALOGS)
    for (const label of [...screens, ...DIALOGS]) {
      expect(report[label], label).toBeDefined()
      expect(report[label].error, label).toBe('')
    }
  })

  type Dialog = Screen & { edges?: [number, number]; hidden?: string[] }

  it.each([...DIALOGS, ...CANVAS_SCREENS])(
    '%s: nothing past the edge, one scroller, and no ring cut',
    (label) => {
      expect(report[label]?.over ?? ['no report']).toEqual([])
      expect(report[label]?.scrollers.length ?? 9).toBeLessThanOrEqual(1)
      expect(report[label]?.clipped ?? ['no report']).toEqual([])
    }
  )

  it.each([...DIALOGS, ...CANVAS_SCREENS])(
    '%s: the whole dialog is on the screen, its buttons in sight',
    (label) => {
      const d = report[label] as Dialog
      expect(d?.edges?.[0] ?? -1).toBeGreaterThanOrEqual(0)
      expect(d?.edges?.[1] ?? 9999).toBeLessThanOrEqual(PHONE.height)
      expect(d?.hidden ?? ['no report']).toEqual([])
    }
  )

  it.each(CANVAS_SCREENS)(
    '%s: review and confirmation preserve source, pending work and history',
    (label) => {
      const screen = report[label] as Screen & {
        retained: boolean
        sourceSame: boolean
        process: number
        ack: number
        undo: number
        baselineLabel: string | null
      }
      expect(screen.error).toBe('')
      expect(screen.retained).toBe(true)
      expect(screen.sourceSame).toBe(true)
      expect(screen.process).toBe(0)
      expect(screen.ack).toBe(0)
      expect(screen.undo).toBe(0)
      if (label === 'canvas publication review')
        expect(screen.baselineLabel).toBe('Original baseline (historical)')
    }
  )

  it('key-destinations: every body action stays paired with its visible recipient and warning', () => {
    const dialog = report['dialog key-destinations'] as RecipientScreen
    expect(recipientRowFailures(dialog, RECIPIENT_ROWS)).toEqual([])
    expect(dialog.primary.text).toBe('Allow key and address')
    expect(dialog.primary.pinned).toBe(true)
    expect(dialog.primary.focused).toBe(true)
    expect(dialog.primary.reachable).toBe(true)
    expect(dialog.primary.inViewport).toBe(true)
    expect(dialog.primary.contextVisible).toBe(true)
    expect(dialog.primary.clipped).toEqual([])
    expect(dialog.primary.summary).toContain('Sample primary key → https://primary.sample.example')
  })

  it('key-destinations: one primary action is pinned and every body action belongs to a recipient row', () => {
    const dialog = report['dialog key-destinations'] as RecipientScreen
    expect(dialog.pinnedActions).toEqual(['Allow key and address'])
    expect(dialog.bodyActions).toEqual(RECIPIENT_ROWS.flatMap((row) => row.actions))
    expect(dialog.unpairedActions).toEqual([])
  })

  it.each([['saved-key-request', ['Cancel', 'Allow address and send']]])(
    '%s: approval actions are in the pinned footer, not the scrolling body',
    (name, actions) => {
      const dialog = report['dialog ' + name] as Screen & {
        pinnedActions?: string[]
        bodyActions?: string[]
      }
      expect(dialog?.pinnedActions).toEqual(actions)
      expect(dialog?.bodyActions).toEqual([])
    }
  )

  it('focusing an offscreen tab brings its whole focus ring into the scrolling strip', () => {
    const cases = Object.values(report).flatMap((screen) => screen.tabFocus ?? [])
    for (const level of ['primary', 'secondary'])
      expect(
        cases.some((c) => c.level === level && c.outside),
        level
      ).toBe(true)
    for (const item of cases) {
      expect(item.clipped, item.label).toEqual([])
    }
  })

  it.each(['scope', 'skills', 'prompts', 'tools', 'settings', 'debug'])(
    'setup %s: all six tabs stay on one row without shrinking the strip',
    (tab) => {
      const strips = report['setup ' + tab]?.tabs
      expect(strips?.length ?? 0).toBe(1)
      expect(strips?.[0].count).toBe(6)
      expect(strips?.[0].rows).toBe(1)
      expect(strips?.[0].clipped).toEqual([])
    }
  )

  it.each([...screens, ...DIALOGS])(
    '%s: horizontal tab strips keep to one unclipped row',
    (label) => {
      for (const strip of report[label]?.tabs ?? []) {
        expect(strip.rows, strip.name).toBe(1)
        expect(strip.clipped, strip.name).toEqual([])
      }
    }
  )

  it.each(['chat', 'nested comment'])('%s: every header action stays reachable directly or in More', (label) => {
    const header = report[label]?.header
    expect(header?.direct).toEqual([
      'Agents',
      ...(label === 'chat' ? ['Artifacts — notes, images and scripts'] : []),
      'Start a new chat', 'Open a chat you have had', 'More chat actions',
    ])
    expect(header?.overflow).toEqual([
      ...(label === 'nested comment' ? [
        'Back to the passage this is about', 'Turn this comment into an ordinary chat',
      ] : []),
      'Find in this chat', 'Navigation', 'Scope, skills, prompts, permissions and settings',
    ])
    expect(header?.unreachable).toEqual([])
    expect(header?.clipped).toEqual([])
    expect(header?.findOpened).toBe(true)
    expect(report[label + ' header menu']?.error).toBe('')
    expect(report[label + ' header menu']?.over).toEqual([])
  })

  it.each(screens)('%s: nothing reaches past the edge of the screen', (label) => {
    expect(report[label]?.over ?? ['no report']).toEqual([])
  })

  /**
   * Obsidian's own prompt, which the pickers are: on a phone it puts the search field *under*
   * the list, so its list stops a field's height above the bottom by design. Only the count of
   * scrollers is asked of it.
   */
  const prompts = new Set([
    'note picker',
    'chat picker',
    'canvas file picker',
    'node session picker',
  ])

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

  it.each([...sheets, 'agent editor access', 'agent editor interceptor', 'publication confirmation'])(
    '%s: nothing cuts the focus ring off any field',
    (label) => {
      expect(report[label]?.clipped ?? ['no report']).toEqual([])
    }
  )

  /**
   * The agent editor's Access tab, inside a dialog sized like the rest of the dialogs rather than
   * a sheet, so it is held to what a dialog is: nothing past the edge, no ring cut, and the rows
   * that set many tools at once keeping Off, Ask and Auto side by side.
   */
  describe('agent editor access', () => {
    const access = () => report['agent editor access'] as Screen & { bulkRows?: number[] }

    it('is reached, nothing past the edge, one scroller, no ring cut', () => {
      expect(access()?.error ?? 'no report').toBe('')
      expect(access().over).toEqual([])
      expect(access().scrollers.length).toBeLessThanOrEqual(1)
      expect(access().clipped).toEqual([])
    })

    it('keeps Off, Ask and Auto to one row in every row that sets many tools', () => {
      const rows = access()?.bulkRows
      expect(rows?.length ?? 0).toBeGreaterThan(1)
      expect(rows?.every((n) => n === 1)).toBe(true)
    })
  })

  it('agent editor interceptor: a script chosen, the pattern field and why it was not kept, inside the screen', () => {
    const r = report['agent editor interceptor'] as Screen & { warning?: boolean }
    expect(r?.error ?? 'no report').toBe('')
    expect(r.over).toEqual([])
    expect(r.scrollers.length).toBeLessThanOrEqual(1)
    expect(r.warning).toBe(true)
  })

  it("setup settings: the chat's interceptor pattern field is there to be measured", () => {
    expect((report['setup settings'] as Screen & { pattern?: boolean })?.pattern).toBe(true)
  })

  it.each(['setup settings reply only', 'agent editor reply only'])(
    '%s: the agent reviewer toggle is present',
    (label) => {
      expect((report[label] as Screen & { replyToggle?: boolean })?.replyToggle).toBe(true)
    }
  )

  it.each(['setup settings', 'agent editor interceptor'])(
    '%s: scripts also have a reply-only toggle',
    (label) => {
      expect((report[label] as Screen & { replyToggle?: boolean })?.replyToggle).toBe(true)
    }
  )

  it('nested comment folded: a trail of four levels keeps to one row', () => {
    expect((report['nested comment folded'] as Screen & { rows?: number })?.rows).toBe(1)
  })

  it('history: the content scope is visible beside a usable search field', () => {
    const scope = (
      report['history'] as Screen & {
        contentScope?: {
          label: string
          visible: boolean
          besideSearch: boolean
          searchWidth: number
        }
      }
    )?.contentScope
    expect(scope?.label).toBe('Content')
    expect(scope?.visible).toBe(true)
    expect(scope?.besideSearch).toBe(true)
    expect(scope?.searchWidth).toBeGreaterThanOrEqual(120)
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

  it('the main-tab timeline keeps its calendar below native navigation', () => {
    const screen = report['timeline main tab'] as Screen & {
      calendarGap?: number
      scrollHeight?: number
    }
    expect(screen?.error).toBe('')
    expect(screen.calendarGap).toBeGreaterThanOrEqual(0)
    expect(screen.scrollHeight).toBeGreaterThan(0)
    expect(screen.scrollHeight).toBeLessThanOrEqual(PHONE.height)
  })

  it('Secrets introduction does not show through the native settings header', () => {
    const screen = report['settings ai secrets scroll'] as Screen & {
      headerCover?: string
      introTop?: number
      headerBottom?: number
    }
    expect(screen?.error).toBe('')
    expect(screen.introTop).toBeLessThan(screen.headerBottom!)
    expect(screen.headerCover).toMatch(/^rgba?\([^)]*, 1\)|^rgb\(/)
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

  it.each(['changelog all', 'changelog older', 'changelog filtered'])(
    '%s: one content scroller and no horizontal overflow',
    (label) => {
      expect(report[label]?.error ?? 'no report').toBe('')
      expect(report[label].over).toEqual([])
      expect(report[label].scrollers.length).toBe(1)
      expect(report[label].clipped).toEqual([])
    }
  )

  it('changelog: paging stays above navigation and the native update offer fits', () => {
    expect((report['changelog older'] as Screen & { covered?: number })?.covered).toBe(0)
    expect(report['changelog notice']?.error ?? 'no report').toBe('')
    expect(report['changelog notice'].over).toEqual([])
    expect(report['changelog notice'].clipped).toEqual([])
  })

  it('map location: the labelled location button and every map control fit inside the map', () => {
    const map = report['map location'] as Screen & {
      locationLabel?: string
      controlOverflow?: string[]
      scaleOverlap?: boolean
    }
    expect(map?.locationLabel).toBe('Show my location')
    expect(map?.controlOverflow).toEqual([])
    expect(map?.scaleOverlap).toBe(false)
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

describe.skipIf(!available)('design catalogue phone contracts', () => {
  let size: [number, number]
  beforeAll(async () => {
    size = windowSize()
    await setMobile(true)
    await setWindowSize(PHONE.width, PHONE.height)
  }, 90_000)
  afterAll(async () => {
    evalRaw('window.__abeleTest.closeDesignCatalogue()')
    if (size?.[0]) await setWindowSize(size[0], size[1])
    await setMobile(false)
  }, 90_000)
  it.each(['rows', 'states', 'details', 'swatches', 'images', 'events', 'artifact', 'comment', 'comment-thread', 'waiting'])('%s: inventories intended actions, target sizes and reachable footer', async page => {
    const result = JSON.parse(await evalLong(`(async () => {
      window.__abeleTest.openDesignCatalogue(${JSON.stringify(page)});
      await new Promise(r => setTimeout(r, 300));
      ${CATALOGUE_PROBE}
    })()`)) as { failures: string[]; actions: number; primary: number; height: number }
    expect(result.failures).toEqual([])
    expect(result.primary).toBeLessThanOrEqual(1)
    if (page === 'rows') expect(result.actions).toBeGreaterThanOrEqual(14)
    if (page === 'comment') expect(result.height).toBeLessThan(PHONE.height * 0.85)
  })
})
