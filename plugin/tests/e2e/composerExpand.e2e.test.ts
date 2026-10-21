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
  runCli,
  setBackgroundThrottling,
  setFocusEmulation,
} from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'
import { editableTapPoints } from '../helpers/editableTapPoints'

const CHAT = 'AI/Chats/Abele composer probe.abchat'
const PHONE = { width: 390, height: 844 }
/** An iPhone keyboard with its suggestion bar, in points. */
const KEYBOARD = 336
const SHOTS = shotDir('abele-phone')

const probeLib = `(() => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (state.session?.error.value) throw new Error(state.session.error.value)
      try { const v = fn(); if (v) return v } catch {}
      await wait(50)
    }
    return null
  }
  const CHAT = ${JSON.stringify(CHAT)}
  const FAKE = 'https://abele-e2e-fake-provider.invalid/v1'
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
    async accessModes(phone) {
      const scope = state.session.scopeResolver
      const original = { entries: scope.entries.value, full: scope.fullVaultAccess.value, mode: state.session.permissionMode.value }
      const results = []
      try {
        for (const [label, mode, full, glyph, words] of [
          ['confirm-all', 'confirm-all', false, null, null],
          ['edit-vault', 'allow-edit', true, 'pencil', 'Writes without asking'],
          ['edit-places', 'allow-edit', false, 'pencil', 'Writes without asking'],
          ['all-places', 'allow-all', false, 'shield-off', 'Runs everything without asking'],
        ]) {
          scope.entries.value = [{ type: 'folder', path: 'Sample' }, { type: 'folder', path: 'Other' }]
          scope.fullVaultAccess.value = full
          state.session.permissionMode.value = mode
          await wait(400)
          const button = chatEl().querySelector('button.abele-chat-input__scope')
          const code = button.querySelector('.abele-chat-input__scope-mode')
          const r = button.getBoundingClientRect()
          const row = button.closest('.abele-chat-input__toolbar').getBoundingClientRect()
          await shoot('access-' + (phone ? 'phone-' : 'desktop-') + label)
          if (!phone && glyph) {
            require('@electron/remote').getCurrentWebContents().sendInputEvent({ type: 'mouseMove', x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) })
            button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }))
            if (!(await until(() => [...document.querySelectorAll('.tooltip')].some((tip) => tip.textContent.includes(words)), 5000))) throw new Error('Access tooltip did not appear: ' + JSON.stringify({ button: button.outerHTML, tips: [...document.querySelectorAll('.tooltip')].map((tip) => tip.outerHTML), tooltip: require('obsidian').setTooltip.toString(), focused: document.hasFocus() }))
            await shoot('access-tooltip-' + label)
            require('@electron/remote').getCurrentWebContents().sendInputEvent({ type: 'mouseMove', x: 1, y: 1 })
            await wait(200)
          }
          results.push({ label, glyph: code?.querySelector('svg')?.getAttribute('class') ?? null, words: button.getAttribute('aria-label'), expectedWords: words, expectedGlyph: glyph ? require('obsidian').getIcon(glyph).getAttribute('class') : null, count: button.textContent.trim(), inside: r.left >= row.left && r.right <= row.right, nestedButtons: button.querySelectorAll('button').length, banner: !!chatEl().querySelector('.abele-chat-write-permission') })
        }
      } finally {
        scope.entries.value = original.entries
        scope.fullVaultAccess.value = original.full
        state.session.permissionMode.value = original.mode
      }
      return results
    },
    async open() {
      state.requests = []
      state.attachmentFolder = app.vault.getConfig('attachmentFolderPath')
      // Obsidian's "same folder" spelling must work even without a note behind the field.
      app.vault.setConfig('attachmentFolderPath', './')
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

    async compareNoteCaret() {
      const c = composer()
      const appearance = (view) => ({
        content: getComputedStyle(view.contentDOM).caretColor,
        line: getComputedStyle(view.contentDOM.querySelector('.cm-line')).caretColor,
        primaryCursors: [...view.scrollDOM.querySelectorAll('.cm-cursor-primary')].filter((el) => {
          const style = getComputedStyle(el)
          return style.display !== 'none' && style.visibility !== 'hidden' && el.getBoundingClientRect().height > 0
        }).length,
      })
      let leaf = null
      let file = null
      try {
        file = await app.vault.create('composer-caret-' + Date.now() + '.md', 'sample')
        leaf = app.workspace.getLeaf('tab')
        await leaf.openFile(file, { active: true })
        await leaf.setViewState({ type: 'markdown', state: { file: file.path, mode: 'source' }, active: true })
        leaf.view.editor.focus()
        await wait(300)
        const note = appearance(leaf.view.editor.cm)
        await chats.revealSidebar({ focus: false })
        c.focus()
        await wait(300)
        const result = { note, composer: appearance(window.__abeleTest.noteFieldView(c.field)) }
        fs.writeFileSync(${JSON.stringify(SHOTS)} + '/composer-caret-comparison.json', JSON.stringify(result, null, 2))
        return result
      } finally {
        leaf?.detach()
        if (file) await app.vault.delete(file)
        await chats.revealSidebar({ focus: false })
        c.focus()
        await wait(300)
      }
    },

    async typingTrace(target = null, label = 'phone-typing') {
      if (!target) await chats.revealSidebar({ focus: false })
      const c = target || composer()
      c.set('sample ')
      c.focus()
      await wait(300)
      const liveView = () => target ? target.liveView() : window.__abeleTest.noteFieldView(composer().field)
      const view = liveView()
      const content = view.contentDOM
      if (!content.getClientRects().length || !view.hasFocus) throw new Error('typing target must be visible and focused')
      const cdp = win.webContents.debugger
      const owned = !cdp.isAttached()
      if (owned) cdp.attach('1.3')
      const box = (el) => {
        const r = el.getBoundingClientRect()
        return [r.x, r.y, r.width, r.height]
      }
      const snapshot = () => ({
        field: box(c.field), content: box(content),
        scrollTop: view.scrollDOM.scrollTop,
        text: view.state.doc.toString(),
        selection: view.state.selection.main.head,
        nativeOffset: document.getSelection()?.anchorOffset,
        caretColor: getComputedStyle(content).caretColor,
        lineCaretColor: getComputedStyle(content.querySelector('.cm-line')).caretColor,
        toolbar: document.querySelector('.mobile-toolbar') && box(document.querySelector('.mobile-toolbar')),
        cursorLayers: [...c.field.querySelectorAll('.cm-cursorLayer')].map((el) => ({
          animation: getComputedStyle(el).animationName,
          duration: getComputedStyle(el).animationDuration,
          opacity: getComputedStyle(el).opacity,
        })),
        cursors: [...c.field.querySelectorAll('.cm-cursor')].map((el) => ({
          box: box(el), display: getComputedStyle(el).display,
        })),
      })
      const initial = snapshot()
      const steps = []
      let transactions = []
      let selectionWrites = []
      let focusCalls = 0
      let resizes = []
      const toolbar = document.querySelector('.mobile-toolbar')
      const watched = [c.field, content, toolbar].filter(Boolean)
      const sizes = new Map(watched.map((el) => [el, box(el).slice(2)]))
      const resizing = new ResizeObserver((entries) => {
        for (const { target } of entries) {
          const size = box(target).slice(2)
          if (JSON.stringify(sizes.get(target)) !== JSON.stringify(size)) {
            resizes.push({ target: target === toolbar ? 'toolbar' : target === content ? 'content' : 'field', size })
            sizes.set(target, size)
          }
        }
      })
      for (const el of watched) resizing.observe(el)
      const originalFocus = content.focus
      content.focus = function (...args) {
        focusCalls++
        return originalFocus.apply(this, args)
      }
      const selection = document.getSelection()
      const selectionMethods = new Map()
      for (const name of ['collapse', 'extend', 'setBaseAndExtent', 'removeAllRanges', 'addRange']) {
        const original = selection[name]
        selectionMethods.set(name, original)
        selection[name] = function (...args) {
          selectionWrites.push({ method: name, stack: new Error().stack })
          return original.apply(this, args)
        }
      }
      const original = view.update
      view.update = function (updates) {
        for (const tr of updates) {
          const changes = []
          tr.changes.iterChanges((from, to, _a, _b, inserted) =>
            changes.push({ from, to, insert: inserted.toString() }))
          transactions.push({ changes, selection: tr.selection?.main.head, input: tr.isUserEvent('input'),
            scrollIntoView: tr.scrollIntoView })
        }
        return original.call(this, updates)
      }
      try {
        for (const character of 'typing') {
          transactions = []
          selectionWrites = []
          focusCalls = 0
          resizes = []
          const before = snapshot()
          const line = content.querySelector('.cm-line')
          const nativeAnchor = document.getSelection()?.anchorNode
          const mutations = []
          const observer = new MutationObserver((records) => {
            for (const r of records) mutations.push({
              type: r.type, attribute: r.attributeName,
              removed: [...r.removedNodes].map((n) => n.textContent),
            })
          })
          observer.observe(content, { subtree: true, childList: true, characterData: true, attributes: true })
          try {
            await cdp.sendCommand('Input.insertText', { text: character })
            await wait(120)
            steps.push({ character, before, after: snapshot(), transactions, mutations, selectionWrites, focusCalls, resizes,
              sameField: target ? target.liveView().dom === c.field : composer().field === c.field,
              sameEditor: liveView() === view && content.isConnected && liveView().contentDOM === content,
              sameLine: line === content.querySelector('.cm-line'),
              sameAnchor: nativeAnchor === document.getSelection()?.anchorNode })
          } finally { observer.disconnect() }
        }
      } finally {
        view.update = original
        resizing.disconnect()
        content.focus = originalFocus
        for (const [name, original] of selectionMethods) selection[name] = original
        if (owned) cdp.detach()
      }
      const result = { initial, steps, shot: await shoot(label) }
      fs.writeFileSync(${JSON.stringify(SHOTS)} + '/' + label + '.json', JSON.stringify(result, null, 2))
      return result
    },

    async compareTypingTrace() {
      const chat = await this.typingTrace()
      let leaf = null
      let file = null
      try {
        file = await app.vault.create('composer-typing-' + Date.now() + '.md', 'sample ')
        leaf = app.workspace.getLeaf('tab')
        await leaf.openFile(file, { active: true })
        await leaf.setViewState({ type: 'markdown', state: { file: file.path, mode: 'source' }, active: true })
        const editor = leaf.view.editor
        const target = {
          field: editor.cm.dom,
          set: (text) => editor.cm.dispatch({ changes: { from: 0, to: editor.cm.state.doc.length, insert: text }, selection: { anchor: text.length } }),
          focus: () => editor.focus(),
          liveView: () => leaf.view.editor.cm,
        }
        const note = await this.typingTrace(target, 'phone-note-typing')
        return { chat, note }
      } finally {
        leaf?.detach()
        if (file) await app.vault.delete(file)
        await chats.revealSidebar({ focus: false })
        composer().focus()
        await wait(300)
      }
    },

    async textareaTypingTrace() {
      const steps = []
      const cdp = win.webContents.debugger
      const owned = !cdp.isAttached()
      if (owned) cdp.attach('1.3')
      try {
        await window.__abeleTest.openNodeSessionFixture('empty')
        const root = await until(() => document.querySelector('.abele-node-chat textarea')?.closest('.abele-node-chat'), 5000)
        if (!root) throw new Error('no plain-text composer')
        const c = window.__abeleTest.composer(root)
        c.set('sample ')
        c.focus()
        document.documentElement.style.setProperty('--keyboard-height', '${KEYBOARD}px')
        const event = new Event('keyboardWillShow')
        event.keyboardHeight = ${KEYBOARD}
        window.dispatchEvent(event)
        await wait(600)
        const field = c.field
        if (!field.getClientRects().length || document.activeElement !== field) throw new Error('plain-text typing target must be visible and focused')
        const snapshot = () => ({ field: rect(field), text: field.value, scrollTop: field.scrollTop,
          selection: [field.selectionStart, field.selectionEnd] })
        const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
        const originalSelection = field.setSelectionRange
        const originalFocus = field.focus
        let valueWrites = 0, selectionWrites = 0, focusCalls = 0
        Object.defineProperty(field, 'value', { configurable: true,
          get() { return descriptor.get.call(this) },
          set(value) { valueWrites++; descriptor.set.call(this, value) } })
        field.setSelectionRange = function (...args) { selectionWrites++; return originalSelection.apply(this, args) }
        field.focus = function (...args) { focusCalls++; return originalFocus.apply(this, args) }
        try {
          for (const character of 'typing') {
            valueWrites = 0; selectionWrites = 0; focusCalls = 0
            const before = snapshot()
            const styles = []
            const observer = new MutationObserver((records) => styles.push(...records.map((r) => r.oldValue)))
            observer.observe(field, { attributes: true, attributeFilter: ['style'], attributeOldValue: true })
            try {
              await cdp.sendCommand('Input.insertText', { text: character })
              await wait(120)
              steps.push({ character, before, after: snapshot(), styles, valueWrites, selectionWrites, focusCalls,
                sameField: window.__abeleTest.composer(root).field === field && field.isConnected })
            } finally { observer.disconnect() }
          }
        } finally {
          delete field.value
          field.setSelectionRange = originalSelection
          field.focus = originalFocus
        }
        const shot = await shoot('phone-textarea-typing')
        c.set(Array.from({ length: 12 }, () => 'sample line').join('\\n'))
        await wait(150)
        const long = { ...snapshot(), overflow: getComputedStyle(field).overflowY, shot: await shoot('phone-textarea-long') }
        c.set('two\\nlines')
        await wait(150)
        const short = { ...snapshot(), overflow: getComputedStyle(field).overflowY, shot: await shoot('phone-textarea-short') }
        c.set('')
        await wait(150)
        const empty = { ...snapshot(), overflow: getComputedStyle(field).overflowY, shot: await shoot('phone-textarea-empty') }
        const result = { steps, shot, long, short, empty, maxHeight: parseFloat(getComputedStyle(field).maxHeight) }
        fs.writeFileSync(${JSON.stringify(SHOTS)} + '/phone-textarea-typing.json', JSON.stringify(result, null, 2))
        return result
      } finally {
        document.documentElement.style.removeProperty('--keyboard-height')
        window.dispatchEvent(new Event('keyboardWillHide'))
        await window.__abeleTest.closeNodeSessionFixture()
        if (owned) cdp.detach()
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
      const send = chat.querySelector('.abele-chat-input__send')
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

    async tapArea(label) {
      const field = composer().field
      const content = field.querySelector('.cm-content')
      if (!content) throw new Error('no editable composer')
      const box = field.getBoundingClientRect()
      const editable = content.getBoundingClientRect()
      const style = getComputedStyle(field)
      const points = (${editableTapPoints.toString()})(box, [style.borderTopLeftRadius,
        style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius])
      const misses = []
      for (const [x, y] of points) {
        const hit = document.elementFromPoint(x, y)
        if (!hit || !content.contains(hit)) misses.push({ x, y, hit: hit?.className })
      }
      return {
        gaps: [editable.left - box.left, editable.top - box.top,
          box.right - editable.right, box.bottom - editable.bottom],
        misses,
        shot: await shoot(label),
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
    // The chat draws its own list of commands, skills and prompts in Obsidian's suggestion
    // classes, marked abele-chat-slash: that one is expected, Obsidian's is not.
    async slash() {
      const core = app.internalPlugins.getPluginById('slash-command')
      const wasOn = !!core?.enabled
      if (!core) return { core: false, open: true, noteOpen: false, chatOpen: false }
      const native = () => document.querySelector('.suggestion-container:not(.abele-chat-slash) .suggestion-item')
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
        if (!native() && owner && owner.editor)
          app.workspace.editorSuggest.trigger(owner.editor, owner.file ?? null, true)
        return !!(await until(native, 1500))
      }
      const open = await typeSlash(view, '/comp')
      const chatOpen = !!chatEl().querySelector('.abele-chat-slash .suggestion-item')
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
      return { core: true, open, noteOpen, chatOpen }
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

    async prepareNativePaste() {
      const clipboard = require('@electron/remote').clipboard
      state.clipboard = clipboard.availableFormats().map((format) => [format, clipboard.readBuffer(format)])
      state.beforePaste = new Set(app.vault.getFiles().map((f) => f.path))
      state.beforePasteText = composer().get()
      const canvas = document.createElement('canvas')
      canvas.width = 8; canvas.height = 8
      canvas.getContext('2d').fillRect(0, 0, 8, 8)
      clipboard.writeImage(require('@electron/remote').nativeImage.createFromDataURL(canvas.toDataURL()))
      composer().focus()
      return 'ready'
    },

    async finishNativePaste() {
      const chips = () => chatEl().querySelectorAll('.abele-chat-input__attachment').length
      await until(() => chips() >= 1, 3000)
      const made = app.vault.getFiles().filter((f) => !state.beforePaste.has(f.path))
      const result = { files: made.length, chips: chips(), textUnchanged: composer().get() === state.beforePasteText }
      for (const x of [...chatEl().querySelectorAll('.abele-chat-input__attachment-remove')].reverse()) x.click()
      for (const f of made) await app.vault.delete(f)
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
      if (state.session.error.value) throw new Error(state.session.error.value)
      await wait(300)
      return { requests: state.requests }
    },

    async close() {
      window.fetch = state.realFetch || window.fetch
      app.vault.setConfig('attachmentFolderPath', state.attachmentFolder)
      if (state.clipboard) {
        const clipboard = require('@electron/remote').clipboard
        clipboard.clear()
        for (const [format, bytes] of state.clipboard) clipboard.writeBuffer(format, bytes)
        state.clipboard = null
      }
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

interface CaretComparison {
  note: { content: string; line: string; primaryCursors: number }
  composer: { content: string; line: string; primaryCursors: number }
}

const available = isObsidianRunning() && hasTestApi()

const DRAFT = 'A long thought with **bold**, a list:\n- one\n- two\nand a link to [[sample-note]]'

describe.skipIf(!available)('the chat composer, opened out', () => {
  let opened: { editor: boolean; livePreview: boolean }
  let caret: CaretComparison
  let collapsed: Measure
  let expanded: Measure
  let suggest: { open: boolean; activeIsComposer: boolean }
  let attached: { chips: number; textUnchanged: boolean; files: number }
  let nativePaste: { chips: number; textUnchanged: boolean; files: number }
  let slash: { core: boolean; open: boolean; noteOpen: boolean; chatOpen: boolean }
  let closedAgain: Measure
  let sent: { requests: string[] }
  let afterSend: Measure

  beforeAll(async () => {
    setBackgroundThrottling(false)
    setFocusEmulation(true)
    try {
      opened = await step('open()')
      const accessModes = await step<
        Array<{
          expectedGlyph: string | null
          glyph: string | null
          expectedWords: string | null
          words: string
          count: string
          inside: boolean
          nestedButtons: number
          banner: boolean
        }>
      >('accessModes(false)')
      for (const mode of accessModes) {
        expect(mode.banner).toBe(false)
        expect(mode.nestedButtons).toBe(0)
        expect(mode.inside).toBe(true)
        if (mode.expectedGlyph) expect(mode.glyph).toBe(mode.expectedGlyph)
        else expect(mode.glyph).toBeNull()
        if (mode.expectedWords) expect(mode.words).toContain(mode.expectedWords)
      }
      caret = await step('compareNoteCaret()')
      await step(`write(${JSON.stringify(DRAFT)})`)
      collapsed = await step('measure("desktop-collapsed")')
      await step('toggle()')
      expanded = await step('measure("desktop-expanded")')
      suggest = await step('suggest()')
      attached = await step('attach()')
      await step('prepareNativePaste()')
      for (const type of ['keyDown', 'keyUp']) {
        runCli(
          [
            'dev:cdp',
            'method=Input.dispatchKeyEvent',
            `params=${JSON.stringify({
              type,
              key: 'v',
              code: 'KeyV',
              modifiers: 4,
              windowsVirtualKeyCode: 86,
              ...(type === 'keyDown' ? { commands: ['Paste'] } : {}),
            })}`,
          ],
          30_000
        )
      }
      nativePaste = await step('finishNativePaste()')
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

  it('uses the same native and drawn caret as an ordinary note editor', () => {
    expect(caret.composer).toEqual(caret.note)
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
    // What is offered over the chat is its own list, the one Enter picks from there.
    expect(slash.chatOpen).toBe(true)
  })

  it('takes a pasted and a dropped file as attachments, not as text', () => {
    expect(attached.files).toBe(2)
    expect(attached.chips).toBe(2)
    expect(attached.textUnchanged).toBe(true)
  })

  it('takes a native clipboard image pasted through CDP as an attachment', () => {
    expect(nativePaste.files).toBe(1)
    expect(nativePaste.chips).toBe(1)
    expect(nativePaste.textUnchanged).toBe(true)
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
    let phoneCaret: CaretComparison
    let typing: {
      steps: Array<{
        character: string
        before: { field: number[]; content: number[]; scrollTop: number; text: string }
        after: {
          field: number[]
          content: number[]
          scrollTop: number
          text: string
          selection: number
        }
        sameLine: boolean
        sameAnchor: boolean
        sameField: boolean
        sameEditor: boolean
        resizes: Array<{ target: string; size: number[] }>
        selectionWrites: Array<{ method: string; stack: string }>
        focusCalls: number
        transactions: Array<{
          changes: Array<{ from: number; to: number; insert: string }>
          input: boolean
          selection?: number
        }>
      }>
    }
    let noteTyping: typeof typing
    let textareaTyping: {
      long: { field: { height: number }; overflow: string }
      short: { field: { height: number }; overflow: string }
      empty: { field: { height: number }; overflow: string }
      maxHeight: number
      steps: Array<{
        character: string
        before: { field: object; text: string; scrollTop: number }
        after: { field: object; text: string; scrollTop: number; selection: number[] }
        styles: string[]
        valueWrites: number
        selectionWrites: number
        focusCalls: number
        sameField: boolean
      }>
    }
    const tapAreas: Array<{ gaps: number[]; misses: unknown[]; shot: string }> = []

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
        const modes =
          await step<Array<{ inside: boolean; nestedButtons: number; banner: boolean }>>(
            'accessModes(true)'
          )
        for (const mode of modes) {
          expect(mode.inside).toBe(true)
          expect(mode.nestedButtons).toBe(0)
          expect(mode.banner).toBe(false)
        }
        phoneCaret = await step('compareNoteCaret()')
        tapAreas.push(await step('tapArea("phone-empty-tap-area")'))
        await step('keyboard(true)')
        const traces = await step<{ chat: typeof typing; note: typeof typing }>(
          'compareTypingTrace()'
        )
        typing = traces.chat
        noteTyping = traces.note
        await step('keyboard(false)')
        await step('write("sample draft")')
        tapAreas.push(await step('tapArea("phone-filled-tap-area")'))
        await step('toggle()')
        tapAreas.push(await step('tapArea("phone-expanded-tap-area")'))
        await step('keyboard(true)')
        // Something written, so Send is live and can be hit.
        await step('write("a first line")')
        up = await step('measure("phone-expanded-keyboard")')
        const lines = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n')
        await step(`write(${JSON.stringify(lines)})`)
        typedDown = await step('measure("phone-expanded-typed")')
        await step('keyboard(false)')
        textareaTyping = await step('textareaTypingTrace()')
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

    it('types without moving the field or rewriting existing content and selection', () => {
      for (const report of [typing, noteTyping]) {
        expect(report.steps).toHaveLength(6)
        for (const step of report.steps) {
          expect(step.after.field, JSON.stringify(step)).toEqual(step.before.field)
          expect(step.after.content, JSON.stringify(step)).toEqual(step.before.content)
          expect(step.after.scrollTop, JSON.stringify(step)).toBe(step.before.scrollTop)
          expect(step.after.text).toBe(step.before.text + step.character)
          expect(step.after.selection).toBe(step.after.text.length)
          expect(step.sameLine, JSON.stringify(step)).toBe(true)
          expect(step.sameAnchor, JSON.stringify(step)).toBe(true)
          expect(step.sameField, JSON.stringify(step)).toBe(true)
          expect(step.sameEditor, JSON.stringify(step)).toBe(true)
          expect(step.resizes, JSON.stringify(step)).toEqual([])
          expect(step.selectionWrites, JSON.stringify(step)).toEqual([])
          expect(step.focusCalls, JSON.stringify(step)).toBe(0)
          expect(
            step.transactions.filter(
              (tr) => !tr.input && (tr.changes.length || tr.selection !== undefined)
            ),
            JSON.stringify(step)
          ).toEqual([])
          const changes = step.transactions.flatMap((tr) => tr.changes)
          expect(changes, JSON.stringify(step)).toEqual([
            { from: step.before.text.length, to: step.before.text.length, insert: step.character },
          ])
        }
      }
    })

    it('uses the note editor’s computed caret colors and primary cursor count', () => {
      expect(phoneCaret.composer).toEqual(phoneCaret.note)
    })

    it('leaves the plain-text composer height, value, selection and DOM alone while typing', () => {
      expect(textareaTyping.steps).toHaveLength(6)
      for (const step of textareaTyping.steps) {
        expect(step.after.field, JSON.stringify(step)).toEqual(step.before.field)
        expect(step.after.scrollTop).toBe(step.before.scrollTop)
        expect(step.after.text).toBe(step.before.text + step.character)
        expect(step.after.selection).toEqual([step.after.text.length, step.after.text.length])
        expect(step.styles, JSON.stringify(step)).toEqual([])
        expect(step.valueWrites).toBe(0)
        expect(step.selectionWrites).toBe(0)
        expect(step.focusCalls).toBe(0)
        expect(step.sameField).toBe(true)
      }
      expect(textareaTyping.long.field.height).toBeLessThanOrEqual(textareaTyping.maxHeight + 1)
      expect(textareaTyping.long.overflow).toBe('auto')
      expect(textareaTyping.short.field.height).toBeLessThan(textareaTyping.long.field.height)
      expect(textareaTyping.short.overflow).toBe('hidden')
      expect(textareaTyping.empty.field.height).toBeLessThan(textareaTyping.short.field.height)
      expect(textareaTyping.empty.field.height).toBeGreaterThan(0)
    })

    it('fills the chat above the keyboard', () => {
      const floor = Math.min(up.keyboardTop, up.toolbarTop ?? Infinity)
      expect(up.expanded).toBe(true)
      expect(up.keyboardTop).toBeLessThan(PHONE.height - 200)
      expect(up.field.height).toBeGreaterThan((floor - up.chat.top) * 0.5)
      expect(up.field.bottom).toBeLessThanOrEqual(floor)
    })

    it('makes the editable cover the empty, filled and expanded field tap area', () => {
      expect(tapAreas).toHaveLength(3)
      for (const area of tapAreas) {
        expect(area.gaps, area.shot).toHaveLength(4)
        for (const gap of area.gaps) expect(gap, area.shot).toBeLessThanOrEqual(1)
        expect(area.misses, area.shot).toEqual([])
      }
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
