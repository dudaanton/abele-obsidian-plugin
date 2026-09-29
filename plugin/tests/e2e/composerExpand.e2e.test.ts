/**
 * The chat's composer, in the running app: Obsidian's note editor, and opened out over the
 * whole chat for writing at length.
 *
 * A chat is opened in the sidebar with its model pointed at an address nothing answers, and
 * `window.fetch` answers that address alone with a short scripted reply, so the message that
 * is sent is read back exactly as the model would get it. Then, in order: the field is the
 * real editor in live preview; its button opens it out until it fills the chat, the
 * conversation hidden; `[[` brings up Obsidian's link suggester; closed again, the draft is
 * still there; opened once more and sent with Shift+Enter, the words reach the model and the
 * composer is back under the conversation, empty.
 *
 * Then the same on a phone (390×844 under `emulateMobile`, the keyboard written as Obsidian's
 * iPhone app writes it): opened out with the keyboard up, the line being typed and the Send
 * button stay above the keyboard and above Obsidian's toolbar over it. Pictures in
 * `/tmp/abele-phone/composer-*.png`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  evalJson,
  evalLong,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
  setBackgroundThrottling,
  setFocusEmulation,
} from './helpers/obsidianCli'

const CHAT = 'AI/Chats/Abele composer probe.abchat'
const PHONE = { width: 390, height: 844 }
/** An iPhone keyboard with its suggestion bar, in points. */
const KEYBOARD = 336
const SHOTS = '/tmp/abele-phone'

const probeLib = `(() => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      try { const v = fn(); if (v) return v } catch {}
      await wait(50)
    }
    return null
  }
  const CHAT = ${JSON.stringify(CHAT)}
  const FAKE = 'http://abele-e2e-fake-provider.invalid/v1'
  const chats = window.__abeleTest.ChatService.getInstance()
  const fs = require('fs')
  const win = require('@electron/remote').getCurrentWindow()
  fs.mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })

  const state = window.__composerProbeState = window.__composerProbeState || {
    requests: [], createdDirs: [], realFetch: null, session: null,
  }

  const chatEl = () =>
    [...document.querySelectorAll('.abele-ai-chat')].filter((el) => el.getClientRects().length).at(-1)
  const composer = () => window.__abeleTest.composer(chatEl())
  const rect = (el) => {
    const r = el.getBoundingClientRect()
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) }
  }
  const keyboardHeight = () =>
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--keyboard-height')) || 0

  const shoot = async (label) => {
    await wait(400)
    const path = ${JSON.stringify(SHOTS)} + '/composer-' + label + '.png'
    let img
    try { img = await win.webContents.capturePage() } catch (error) {
      await wait(300)
      img = await win.webContents.capturePage()
    }
    fs.writeFileSync(path, img.toPNG())
    return path
  }

  window.__composerProbe = {
    async open() {
      state.requests = []
      state.realFetch = state.realFetch || window.fetch
      const realFetch = state.realFetch
      window.fetch = async (url, init) => {
        if (typeof url !== 'string' || !url.startsWith(FAKE)) return realFetch(url, init)
        const body = JSON.parse(init.body)
        const last = body.messages[body.messages.length - 1]
        const content = typeof last.content === 'string' ? last.content : (last.content || []).map((p) => p.text || '').join('')
        state.requests.push(content)
        const enc = new TextEncoder()
        const stream = new ReadableStream({
          start(controller) {
            for (const c of [{ choices: [{ delta: { content: 'Got it.' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }])
              controller.enqueue(enc.encode('data: ' + JSON.stringify(c) + '\\n\\n'))
            controller.enqueue(enc.encode('data: [DONE]\\n\\n'))
            controller.close()
          },
        })
        return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
      }
      for (const dir of ['AI', 'AI/Chats']) {
        if (!app.vault.getAbstractFileByPath(dir)) { await app.vault.createFolder(dir); state.createdDirs.unshift(dir) }
      }
      const stale = app.vault.getAbstractFileByPath(CHAT)
      if (stale) await app.vault.delete(stale)
      const meta = { v: 2, k: 'meta', type: 'abele-chat', title: 'Composer probe', providerId: '', modelId: '', created: '2026-09-29' }
      const file = await app.vault.create(CHAT, JSON.stringify(meta) + '\\n')
      await chats.openChatFile(file)
      await chats.revealSidebar()
      const session = chats.getSessionByFile(CHAT)
      if (!session) throw new Error('the probe chat did not open')
      state.session = session
      session.resolveModel = () => ({
        id: 'fake', name: 'Fake', baseUrl: FAKE, apiKey: 'none',
        contextWindow: 100000, maxTokens: 1000, supportsReasoning: false,
      })
      for (const k of ['generateTitle', 'generateSummary', 'generateRecap', 'autoCompactIfNeeded']) {
        session.summarizer[k] = async () => undefined
      }
      if (!(await until(() => composer(), 5000))) throw new Error('no composer on screen')
      await wait(500)
      const field = composer().field
      return {
        editor: !!field.querySelector('.cm-editor'),
        livePreview: !!field.querySelector('.is-live-preview'),
      }
    },

    async toggle() {
      const button = chatEl().querySelector('.abele-chat-input__expand')
      if (!button) throw new Error('no expand button')
      button.click()
      await wait(400)
      return 'toggled'
    },

    async measure(label) {
      const chat = chatEl()
      const c = composer()
      const input = chat.querySelector('.abele-chat-input')
      const messages = chat.querySelector('.abele-ai-chat__messages')
      const send = [...chat.querySelectorAll('.abele-chat-input__toolbar-right [data-keeps-focus]')].at(-1)
      const bar = document.querySelector('.mobile-toolbar')
      const barRect = bar && bar.getBoundingClientRect()
      const view = window.__abeleTest.noteFieldView(c.field)
      const caret = view && view.coordsAtPos(view.state.selection.main.head)
      const sendRect = send && send.getBoundingClientRect()
      const hit = sendRect && document.elementFromPoint(sendRect.left + sendRect.width / 2, sendRect.top + sendRect.height / 2)
      return {
        chat: rect(chat),
        field: rect(c.field),
        expanded: input.classList.contains('abele-chat-input--expanded'),
        messagesShown: !!messages && messages.getClientRects().length > 0,
        text: c.get(),
        caretBottom: caret ? Math.round(caret.bottom) : null,
        send: sendRect ? rect(send) : null,
        sendOnTop: !!(hit && send && send.contains(hit)),
        keyboardTop: Math.round(window.innerHeight - keyboardHeight()),
        toolbarTop: barRect && barRect.height > 0 && getComputedStyle(bar).display !== 'none' ? Math.round(barRect.top) : null,
        shot: label ? await shoot(label) : '',
      }
    },

    async write(text) {
      const c = composer()
      c.focus()
      c.set(text)
      await wait(300)
      return c.get()
    },

    async suggest() {
      const c = composer()
      const view = window.__abeleTest.noteFieldView(c.field)
      c.focus()
      // A window behind others never has the focus, and the suggester asks for it.
      Object.defineProperty(view, 'hasFocus', { get: () => true, configurable: true })
      const before = view.state.doc.length
      view.dispatch({ changes: { from: before, insert: ' [[Sca' }, selection: { anchor: before + 6 }, userEvent: 'input.type' })
      await wait(300)
      const owner = app.workspace.activeEditor
      if (!document.querySelector('.suggestion-container') && owner && owner.editor)
        app.workspace.editorSuggest.trigger(owner.editor, null, true)
      const open = !!(await until(() => document.querySelector('.suggestion-container .suggestion-item'), 3000))
      app.workspace.editorSuggest.close?.()
      await wait(200)
      delete view.hasFocus
      // Back to what was written before the probe.
      view.dispatch({ changes: { from: before, to: view.state.doc.length, insert: '' } })
      return { open, activeIsComposer: owner?.editor?.cm === view }
    },

    // The chat's own commands start with a slash. Obsidian's core slash-command plugin, when it
    // is on, offers its commands on a slash in a note; over the chat's it offered the wrong ones,
    // and Enter picked one of them. Switched on for the probe, and back as it was.
    async slash() {
      const core = app.internalPlugins.getPluginById('slash-command')
      const wasOn = !!core?.enabled
      if (!core) return { core: false, open: true, noteOpen: false }
      if (!wasOn) await core.enable(true)
      const c = composer()
      const view = window.__abeleTest.noteFieldView(c.field)
      c.focus()
      Object.defineProperty(view, 'hasFocus', { get: () => true, configurable: true })
      const before = view.state.doc.toString()
      const typeSlash = async (target, text) => {
        target.dispatch({ changes: { from: 0, to: target.state.doc.length, insert: text }, selection: { anchor: text.length }, userEvent: 'input.type' })
        await wait(300)
        const owner = app.workspace.activeEditor
        if (!document.querySelector('.suggestion-container') && owner && owner.editor)
          app.workspace.editorSuggest.trigger(owner.editor, owner.file ?? null, true)
        return !!(await until(() => document.querySelector('.suggestion-container .suggestion-item'), 1500))
      }
      const open = await typeSlash(view, '/comp')
      app.workspace.editorSuggest.close?.()
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: before } })
      delete view.hasFocus
      // The same plugin in a note, to know the probe would have seen it at all.
      let noteOpen = false
      const scratch = await app.vault.create('composer-probe-slash.md', '')
      try {
        const leaf = app.workspace.getLeaf(true)
        await leaf.openFile(scratch)
        await wait(400)
        const noteView = leaf.view.editor.cm
        noteView.focus()
        Object.defineProperty(noteView, 'hasFocus', { get: () => true, configurable: true })
        noteOpen = await typeSlash(noteView, '/comp')
        app.workspace.editorSuggest.close?.()
        delete noteView.hasFocus
        // Saved as it closes: emptied first, and deleted only once it has been written, or the
        // save puts the note back after it was deleted.
        noteView.dispatch({ changes: { from: 0, to: noteView.state.doc.length, insert: '' } })
        await leaf.view.save?.()
        leaf.detach()
        await wait(500)
      } finally {
        const left = app.vault.getAbstractFileByPath('composer-probe-slash.md')
        if (left) await app.vault.delete(left)
        if (!wasOn) await core.disable(true)
      }
      return { core: true, open, noteOpen }
    },

    // A file pasted, then one dropped, onto the editor: each becomes an attachment of the
    // message, as on the text box, and nothing is written into the text for it.
    async attach() {
      const c = composer()
      const before = c.get()
      const made = []
      const chips = () => chatEl().querySelectorAll('.abele-chat-input__attachment').length
      const fileOf = (name) => new File([new Uint8Array([1, 2, 3])], name, { type: 'text/plain' })
      const pasteData = new DataTransfer()
      pasteData.items.add(fileOf('composer-probe-pasted.txt'))
      c.keyTarget.dispatchEvent(new ClipboardEvent('paste', { clipboardData: pasteData, bubbles: true, cancelable: true }))
      await until(() => chips() >= 1, 3000)
      const dropData = new DataTransfer()
      dropData.items.add(fileOf('composer-probe-dropped.txt'))
      c.keyTarget.dispatchEvent(new DragEvent('drop', { dataTransfer: dropData, bubbles: true, cancelable: true }))
      await until(() => chips() >= 2, 3000)
      await wait(300)
      for (const f of app.vault.getFiles()) if (f.name.startsWith('composer-probe-')) made.push(f)
      const result = { chips: chips(), textUnchanged: c.get() === before, files: made.length }
      // Taken back off the message, and out of the vault.
      for (const x of [...chatEl().querySelectorAll('.abele-chat-input__attachment-remove')].reverse()) x.click()
      for (const f of made) await app.vault.delete(f)
      await wait(200)
      return result
    },

    async keyboard(up) {
      if (up) {
        composer().focus()
        document.documentElement.style.setProperty('--keyboard-height', '${KEYBOARD}px')
        const shown = new Event('keyboardWillShow')
        shown.keyboardHeight = ${KEYBOARD}
        window.dispatchEvent(shown)
      } else {
        document.documentElement.style.removeProperty('--keyboard-height')
        window.dispatchEvent(new Event('keyboardWillHide'))
        document.activeElement && document.activeElement.blur()
      }
      await wait(600)
      return keyboardHeight()
    },

    async send() {
      const c = composer()
      c.focus()
      c.keyTarget.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, shiftKey: true, bubbles: true, cancelable: true }))
      await until(() => state.requests.length > 0 && !state.session.isStreaming.value, 8000)
      await wait(300)
      return { requests: state.requests }
    },

    async close() {
      window.fetch = state.realFetch || window.fetch
      document.documentElement.style.removeProperty('--keyboard-height')
      const input = chatEl()?.querySelector('.abele-chat-input--expanded .abele-chat-input__expand')
      if (input) input.click()
      window.__abeleTest.composer()?.set('')
      try {
        if (state.session) { state.session.abort(); await chats.deleteChat(state.session.id) }
        const f = app.vault.getAbstractFileByPath(CHAT)
        if (f) await app.vault.delete(f)
        for (const dir of state.createdDirs) {
          const d = app.vault.getAbstractFileByPath(dir)
          if (d && d.children && !d.children.length) await app.vault.delete(d, true)
        }
      } finally {
        state.session = null
        state.createdDirs = []
      }
      return 'closed'
    },
  }
  return 'installed'
})()`

const step = async <T>(call: string): Promise<T> =>
  JSON.parse(
    await evalLong(
      `(async () => { ${probeLib}; return JSON.stringify(await window.__composerProbe.${call}) })()`,
      60_000
    )
  ) as T

interface Measure {
  chat: { top: number; bottom: number; height: number }
  field: { top: number; bottom: number; height: number }
  expanded: boolean
  messagesShown: boolean
  text: string
  caretBottom: number | null
  send: { top: number; bottom: number; height: number } | null
  sendOnTop: boolean
  keyboardTop: number
  toolbarTop: number | null
  shot: string
}

const available = isObsidianRunning() && hasTestApi()

const DRAFT = 'A long thought with **bold**, a list:\n- one\n- two\nand a link to [[sample-note]]'

describe.skipIf(!available)('the chat composer, opened out', () => {
  let opened: { editor: boolean; livePreview: boolean }
  let collapsed: Measure
  let expanded: Measure
  let suggest: { open: boolean; activeIsComposer: boolean }
  let attached: { chips: number; textUnchanged: boolean; files: number }
  let slash: { core: boolean; open: boolean; noteOpen: boolean }
  let closedAgain: Measure
  let sent: { requests: string[] }
  let afterSend: Measure

  beforeAll(async () => {
    setBackgroundThrottling(false)
    setFocusEmulation(true)
    try {
      opened = await step('open()')
      await step(`write(${JSON.stringify(DRAFT)})`)
      collapsed = await step('measure("desktop-collapsed")')
      await step('toggle()')
      expanded = await step('measure("desktop-expanded")')
      suggest = await step('suggest()')
      attached = await step('attach()')
      slash = await step('slash()')
      await step('toggle()')
      closedAgain = await step('measure("")')
      await step('toggle()')
      sent = await step('send()')
      afterSend = await step('measure("desktop-sent")')
    } finally {
      await step('close()')
    }
  }, 180_000)

  afterAll(() => {
    if (!available) return
    setFocusEmulation(false)
    setBackgroundThrottling(true)
  })

  it('is Obsidian’s note editor, in live preview', () => {
    expect(opened.editor).toBe(true)
    expect(opened.livePreview).toBe(true)
  })

  it('opens out to fill the chat, the conversation hidden under it', () => {
    expect(collapsed.expanded).toBe(false)
    expect(collapsed.field.height).toBeLessThanOrEqual(160)
    expect(expanded.expanded).toBe(true)
    expect(expanded.messagesShown).toBe(false)
    expect(expanded.field.height).toBeGreaterThan(expanded.chat.height * 0.6)
    expect(expanded.field.bottom).toBeLessThanOrEqual(expanded.chat.bottom)
  })

  it('offers Obsidian’s link suggester on [[', () => {
    expect(suggest.activeIsComposer).toBe(true)
    expect(suggest.open).toBe(true)
  })

  it('leaves the chat’s slash commands alone, with Obsidian’s slash commands switched on', () => {
    expect(slash.core).toBe(true)
    // In a note the same probe does see Obsidian's list, so the one below is not a blind spot.
    expect(slash.noteOpen).toBe(true)
    expect(slash.open).toBe(false)
  })

  it('takes a pasted and a dropped file as attachments, not as text', () => {
    expect(attached.files).toBe(2)
    expect(attached.chips).toBe(2)
    expect(attached.textUnchanged).toBe(true)
  })

  it('keeps the draft through opening and closing', () => {
    expect(expanded.text).toBe(DRAFT)
    expect(closedAgain.expanded).toBe(false)
    expect(closedAgain.messagesShown).toBe(true)
    expect(closedAgain.text).toBe(DRAFT)
  })

  it('sends the markdown as written, and closes back under the conversation', () => {
    expect(sent.requests[0]).toContain(DRAFT)
    expect(afterSend.expanded).toBe(false)
    expect(afterSend.text).toBe('')
    expect(afterSend.messagesShown).toBe(true)
  })

  describe('on a phone', () => {
    let size: [number, number] = [0, 0]
    let up: Measure
    let typedDown: Measure

    beforeAll(async () => {
      size = evalJson<[number, number]>(
        `require('@electron/remote').getCurrentWindow().getContentSize()`
      )
      await reloadApp('app.emulateMobile(true)')
      evalRaw(
        `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${PHONE.width}, ${PHONE.height}); return 'ok' })()`,
        30_000
      )
      await new Promise((resolve) => setTimeout(resolve, 1500))
      setBackgroundThrottling(false)
      setFocusEmulation(true)
      try {
        await step('open()')
        await step('toggle()')
        await step('keyboard(true)')
        // Something written, so Send is live and can be hit.
        await step('write("a first line")')
        up = await step('measure("phone-expanded-keyboard")')
        const lines = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n')
        await step(`write(${JSON.stringify(lines)})`)
        typedDown = await step('measure("phone-expanded-typed")')
        await step('keyboard(false)')
      } finally {
        await step('close()')
      }
    }, 240_000)

    afterAll(async () => {
      if (size[0])
        evalRaw(
          `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${size[0]}, ${size[1]}); return 'ok' })()`,
          30_000
        )
      await reloadApp('app.emulateMobile(false)')
    }, 180_000)

    it('fills the chat above the keyboard', () => {
      const floor = Math.min(up.keyboardTop, up.toolbarTop ?? Infinity)
      expect(up.expanded).toBe(true)
      expect(up.keyboardTop).toBeLessThan(PHONE.height - 200)
      expect(up.field.height).toBeGreaterThan((floor - up.chat.top) * 0.5)
      expect(up.field.bottom).toBeLessThanOrEqual(floor)
    })

    it('keeps Send above the keyboard and Obsidian’s toolbar, and reachable', () => {
      const floor = Math.min(up.keyboardTop, up.toolbarTop ?? Infinity)
      expect(up.send).not.toBeNull()
      expect(up.send!.bottom).toBeLessThanOrEqual(floor)
      expect(up.sendOnTop).toBe(true)
    })

    it('keeps the line being typed in sight, above the keyboard', () => {
      const floor = Math.min(typedDown.keyboardTop, typedDown.toolbarTop ?? Infinity)
      expect(typedDown.caretBottom).not.toBeNull()
      expect(typedDown.caretBottom!).toBeLessThanOrEqual(floor)
      expect(typedDown.caretBottom!).toBeGreaterThan(typedDown.field.top)
    })
  })
})
