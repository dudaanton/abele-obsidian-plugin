/**
 * A comment, from the command to the tab, in the app people actually run.
 *
 * Everything here is a question happy-dom cannot answer. Whether the raw `%%c:…%%` ever reaches
 * the screen is a question about CodeMirror's decorations. Whether a press on the icon puts the
 * conversation in front of the person is a question about the workspace. And the phone is a
 * question about `app.emulateMobile(true)`, which is Obsidian switching its own layout — there
 * is no way to ask for it from a test that does not have Obsidian.
 *
 * The probe drives the command, because that is what a person's hotkey does. If the command
 * cannot reach the editor it falls back to creating the comment through `CommentService`, so
 * the rest of the run still says something; `via` records which happened and one assertion
 * pins it to the command.
 *
 * `app.emulateMobile(…)` does not just toggle a CSS class here: it reloads the app — the
 * workspace and the open note come back, but the page's own JS state (any `window.*` a script
 * set, including a probe's own in-flight `async` function) does not survive it. One script
 * spanning the toggle would simply stop running partway through, with nothing left to say why.
 * So the run is three separate `eval` calls instead of one: desktop, then mobile once the
 * reload has settled, then cleanup — each awaited and returning its own piece of the report
 * directly, with the CLI itself, not a window global, carrying state between them.
 *
 * `evalJson` wraps its expression in a synchronous arrow function, so it cannot await a
 * promise: given an `async` IIFE it hands back the pending promise itself, stringified to
 * `{}`, before it ever settles — which is also why the other e2e files park an async result on
 * `window` and poll for it instead. That trick does not survive the reload above, so these
 * scripts go through `evalRaw` and are parsed directly: the CLI's own `eval` already awaits a
 * returned promise, and by the time it answers, the settled value prints as JSON text.
 *
 * Requires Obsidian running on the demo vault with the development build — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { isObsidianRunning, hasTestApi, evalRaw, evalJson } from './helpers/obsidianCli'

/** `evalRaw` for a script that resolves to a JSON-serializable value, parsed directly. */
const evalAsync = <T>(script: string, timeoutMs: number): T =>
  JSON.parse(evalRaw(script, timeoutMs)) as T

interface DesktopReport {
  /** 'command' when the command palette entry did it, 'service' when the fallback did. */
  via: 'command' | 'service' | 'none'
  /** Whether any text node in the editor still shows the marker's raw text. */
  rawMarkerText: boolean
  /** The `data-comment-ids` the widget carries. */
  markerIds: string
  /** Nothing is drawn beside the text any more: the card in the margin is gone. */
  cardInMargin: boolean
  /** Where the comment's chat file was expected, and whether it is there. */
  commentPath: string
  commentFileExists: boolean
  /** After the press: the sidebar's chat, showing this comment. */
  chatVisible: boolean
  backToNoteVisible: boolean
  openAsChatVisible: boolean
  noteButtonVisible: boolean
  /** No dialog stands over the note — the phone sheet is gone too. */
  modalOpen: boolean
  /** A second marker pressed replaces the tab rather than adding one. */
  tabsAfterFirst: number
  tabsAfterSecond: number
  error: string
}

interface MobileReport {
  /** The same press, in the layout Obsidian gives a phone. */
  chatVisible: boolean
  composerVisible: boolean
  noteButtonVisible: boolean
  modalOpen: boolean
  error: string
}

interface CleanupReport {
  cleaned: boolean
  error: string
}

interface Report extends DesktopReport {
  cleaned: boolean
  mobileChatVisible: boolean
  mobileComposerVisible: boolean
  mobileNoteButtonVisible: boolean
  mobileModalOpen: boolean
}

const NOTE = 'Abele comment probe.md'
const QUOTE = 'the passage the probe asks about'
const SECOND = 'another passage entirely'
const BODY = `# Comment probe\n\nA paragraph holding ${QUOTE} and ${SECOND} after it.\n`

/** Deletes the probe note and whatever comment files its markers name, if either is there. */
const cleanupScript = `(async () => {
  const path = ${JSON.stringify(NOTE)}
  const service = window.__abeleTest.CommentService.getInstance()
  const report = { cleaned: false, error: '' }
  try {
    const note = app.vault.getAbstractFileByPath(path)
    if (note) {
      const text = await app.vault.read(note)
      const ids = [...text.matchAll(/%%c:([a-z0-9,]+)%%/g)].flatMap((m) => m[1].split(','))
      for (const id of ids) {
        const file = app.vault.getAbstractFileByPath(service.commentPath(id))
        if (file) await app.vault.delete(file)
      }
      await app.vault.delete(note)
    }
    report.cleaned = !app.vault.getAbstractFileByPath(path)
  } catch (e) {
    report.error = String((e && e.message) || e)
  }
  return report
})()`

/**
 * Creates the note, runs the comment command on a selection, presses the icon, and reports what
 * the app shows. The second comment is made through the service — one run of the command proves
 * the command works, and what the second one is for is the tab it does *not* add.
 */
const desktopScript = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const shown = (el) => !!el && el.getBoundingClientRect().height > 0
  const path = ${JSON.stringify(NOTE)}
  const quote = ${JSON.stringify(QUOTE)}
  const second = ${JSON.stringify(SECOND)}
  const service = window.__abeleTest.CommentService.getInstance()
  const chats = window.__abeleTest.ChatService.getInstance()
  const report = {
    via: 'none', rawMarkerText: true, markerIds: '', cardInMargin: false,
    commentPath: '', commentFileExists: false,
    chatVisible: false, backToNoteVisible: false, openAsChatVisible: false,
    noteButtonVisible: false, modalOpen: false, tabsAfterFirst: 0, tabsAfterSecond: 0,
    error: '',
  }

  try {
    const stale = app.vault.getAbstractFileByPath(path)
    if (stale) await app.vault.delete(stale)
    const file = await app.vault.create(path, ${JSON.stringify(BODY)})

    const leaf = app.workspace.getLeaf(false)
    await leaf.openFile(file)
    await wait(1000)

    // editorCallback resolves through the active markdown view, not through DOM focus, so
    // a selection set from here is the selection the command sees.
    const editor = app.workspace.activeEditor && app.workspace.activeEditor.editor
    if (!editor) throw new Error('no active editor after opening the probe note')
    const start = editor.getValue().indexOf(quote)
    if (start < 0) throw new Error('the probe note does not hold its own passage')
    editor.setSelection(editor.offsetToPos(start), editor.offsetToPos(start + quote.length))
    await wait(300)

    report.via = app.commands.executeCommandById('abele:comment-here') ? 'command' : 'none'
    await wait(2000)

    if (!document.querySelector('.abele-comment-marker')) {
      await service.create(file, start + quote.length, quote)
      report.via = 'service'
      await wait(2000)
    }

    const content = document.querySelector('.cm-content')
    if (!content) throw new Error('the editor rendered no content')
    const walker = content.ownerDocument.createTreeWalker(content, NodeFilter.SHOW_TEXT)
    let raw = false
    while (walker.nextNode()) {
      if (walker.currentNode.nodeValue.indexOf('%%c:') !== -1) raw = true
    }
    report.rawMarkerText = raw

    const marker = document.querySelector('.abele-comment-marker[data-comment-ids]')
    report.markerIds = marker ? marker.getAttribute('data-comment-ids') : ''
    report.cardInMargin = !!document.querySelector('.abele-comment-card')

    const id = report.markerIds.split(',')[0]
    report.commentPath = id ? service.commentPath(id) : ''
    report.commentFileExists =
      !!report.commentPath && !!app.vault.getAbstractFileByPath(report.commentPath)

    // The press, which is the whole of how a comment is opened now.
    marker.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wait(2000)

    const chat = document.querySelector('.abele-ai-chat')
    report.chatVisible = shown(chat)
    report.modalOpen = !!document.querySelector('.modal')
    report.tabsAfterFirst = chats.getAllSessions().length
    if (chat) {
      // Obsidian's own \`setIcon\` is what draws these, and what it leaves behind is an
      // \`svg.lucide-<name>\` — there is no attribute naming the icon in the running app.
      const icon = (name) => !!chat.querySelector('.abele-ai-chat__header-actions .lucide-' + name)
      report.backToNoteVisible = icon('corner-up-left')
      report.openAsChatVisible = icon('panel-right-open')
      report.noteButtonVisible = !!chat.querySelector('.abele-chat-input .lucide-sticky-note')
    }

    // A second comment, on another passage: its marker replaces the tab rather than adding one.
    const text = await app.vault.read(file)
    await service.create(file, text.indexOf(second) + second.length, second)
    await wait(1500)
    const markers = document.querySelectorAll('.abele-comment-marker[data-comment-ids]')
    markers[markers.length - 1].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wait(2000)
    report.tabsAfterSecond = chats.getAllSessions().length
  } catch (e) {
    report.error = String((e && e.message) || e)
  }

  return report
})()`

/**
 * The same press in the layout Obsidian gives a phone. Run after the reload.
 *
 * The note is opened again first: `emulateMobile` reloads the app and the active file does not
 * reliably come back with it, so a script that went straight for the marker would be asking
 * about whatever the workspace happened to restore.
 */
const mobileScript = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const shown = (el) => !!el && el.getBoundingClientRect().height > 0
  const report = {
    chatVisible: false, composerVisible: false, noteButtonVisible: false, modalOpen: false,
    error: '',
  }

  try {
    const note = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})
    if (!note) throw new Error('the probe note is gone after switching to mobile')
    await app.workspace.getLeaf(false).openFile(note)
    await wait(2000)

    const marker = document.querySelector('.abele-comment-marker[data-comment-ids]')
    if (!marker) throw new Error('no marker visible after switching to mobile')
    marker.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wait(2500)

    const chat = document.querySelector('.abele-ai-chat')
    report.chatVisible = shown(chat)
    report.modalOpen = !!document.querySelector('.modal')
    if (chat) {
      report.composerVisible = shown(chat.querySelector('.abele-chat-input__textarea'))
      report.noteButtonVisible = !!chat.querySelector('.abele-chat-input .lucide-sticky-note')
    }
  } catch (e) {
    report.error = String((e && e.message) || e)
  }

  return report
})()`

/** Closes anything standing over the note and switches emulation, letting the reload settle. */
const setMobile = async (on: boolean): Promise<void> => {
  // The return value is not parsed: a bare string like `ok` is not valid JSON, and this call
  // is only for the side effect anyway.
  evalRaw(
    `(() => {
      const close = document.querySelector('.modal-close-button')
      if (close) close.click()
      app.emulateMobile(${on});
      return 'ok'
    })()`,
    30_000
  )
  await new Promise((resolve) => setTimeout(resolve, 3000))
}

/**
 * The window's content size, and a way to set it.
 *
 * `emulateMobile` switches Obsidian's layout but not the width of the window, and a phone-sized
 * window is what makes the sidebar full screen the way a phone has it. The size is carried in
 * the test process rather than on `window`, because the toggle reloads the page and takes
 * anything parked there with it.
 */
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

let report: Report

const available = isObsidianRunning() && hasTestApi()

beforeAll(async () => {
  if (!available) return

  evalAsync(cleanupScript, 30_000)

  let desktop: DesktopReport = {
    via: 'none',
    rawMarkerText: true,
    markerIds: '',
    cardInMargin: false,
    commentPath: '',
    commentFileExists: false,
    chatVisible: false,
    backToNoteVisible: false,
    openAsChatVisible: false,
    noteButtonVisible: false,
    modalOpen: false,
    tabsAfterFirst: 0,
    tabsAfterSecond: 0,
    error: '',
  }
  let mobile: MobileReport = {
    chatVisible: false,
    composerVisible: false,
    noteButtonVisible: false,
    modalOpen: false,
    error: '',
  }
  let cleanup: CleanupReport = { cleaned: false, error: '' }
  let mobileOn = false
  let desktopSize: [number, number] | null = null

  // A CLI timeout or a non-zero exit throws out of `run()` (see obsidianCli.ts), and a plain
  // sequence of awaits would then skip straight past both the phone toggle and the cleanup
  // call below it — leaving the probe note, and the mobile emulation, behind in the demo
  // vault. `finally` is what makes both unconditional; each is wrapped in its own `try` too,
  // so a broken CLI on the way out cannot swallow the failure that got us here.
  try {
    desktop = evalAsync<DesktopReport>(desktopScript, 60_000)

    if (desktop.markerIds) {
      desktopSize = windowSize()
      await setWindowSize(414, 896)
      // Set before the await, not after: `setMobile` can throw partway — the reload is what it
      // is waiting on — and the app would be left emulating a phone with nothing to undo it.
      mobileOn = true
      await setMobile(true)
      mobile = evalAsync<MobileReport>(mobileScript, 60_000)
    }
  } finally {
    if (mobileOn) {
      try {
        await setMobile(false)
      } catch (e) {
        mobile.error =
          (mobile.error ? mobile.error + '; ' : '') + String((e as Error)?.message ?? e)
      }
    }

    // Its own try, and not behind the mobile flag: the window is resized before the emulation
    // is switched, so a throw in between leaves a phone-shaped window and no record of it.
    if (desktopSize) {
      try {
        await setWindowSize(desktopSize[0], desktopSize[1])
      } catch (e) {
        mobile.error =
          (mobile.error ? mobile.error + '; ' : '') + String((e as Error)?.message ?? e)
      }
    }

    try {
      cleanup = evalAsync<CleanupReport>(cleanupScript, 30_000)
    } catch (e) {
      cleanup = { cleaned: false, error: String((e as Error)?.message ?? e) }
    }
  }

  report = {
    ...desktop,
    error: [desktop.error, mobile.error, cleanup.error].filter(Boolean).join('; '),
    cleaned: cleanup.cleaned,
    mobileChatVisible: mobile.chatVisible,
    mobileComposerVisible: mobile.composerVisible,
    mobileNoteButtonVisible: mobile.noteButtonVisible,
    mobileModalOpen: mobile.modalOpen,
  }
}, 120_000)

describe.runIf(available)('commenting on a passage', () => {
  it('got through without an error of its own', () => {
    expect(report.error).toBe('')
  })

  it('is started by the command a hotkey would run', () => {
    expect(report.via).toBe('command')
  })

  it('never shows the marker as raw text in the editor', () => {
    expect(report.rawMarkerText).toBe(false)
  })

  it('puts an icon carrying the comment id where the marker is', () => {
    expect(report.markerIds).toMatch(/^[a-z0-9]{6}$/)
  })

  it('writes the conversation into the comment folder', () => {
    expect(report.commentPath).toMatch(/^AI\/Comments\/[a-z0-9]{6}\.abchat$/)
    expect(report.commentFileExists).toBe(true)
  })

  /**
   * Nothing is drawn beside the text. The card in the margin was three releases of trouble for
   * something only a very wide screen ever showed — «контекстный сайдбар виден только на очень
   * большом экране и только добавляет проблем».
   */
  it('draws nothing in the margin, and stands no dialog over the note', () => {
    expect({ card: report.cardInMargin, modal: report.modalOpen }).toEqual({
      card: false,
      modal: false,
    })
  })
})

describe.runIf(available)('pressing the icon', () => {
  it('opens the comment in the chat sidebar', () => {
    expect(report.chatVisible).toBe(true)
  })

  it('offers the way back to the passage and the way up into a full chat', () => {
    expect({ back: report.backToNoteVisible, up: report.openAsChatVisible }).toEqual({
      back: true,
      up: true,
    })
  })

  it('gives it the note button, which only a comment gets', () => {
    expect(report.noteButtonVisible).toBe(true)
  })

  /** «табы не плодить, а открывать на месте уже открытого КОНТЕКСТНОГО таба». */
  it('replaces the comment tab rather than adding one', () => {
    expect(report.tabsAfterSecond).toBe(report.tabsAfterFirst)
  })
})

describe.runIf(available)('the same comment on a phone', () => {
  it('opens in the chat, which is the whole screen there', () => {
    expect({ chat: report.mobileChatVisible, composer: report.mobileComposerVisible }).toEqual({
      chat: true,
      composer: true,
    })
  })

  it('keeps the note button, and stands no dialog over anything', () => {
    expect({ note: report.mobileNoteButtonVisible, modal: report.mobileModalOpen }).toEqual({
      note: true,
      modal: false,
    })
  })
})

describe.runIf(available)('afterwards', () => {
  it('leaves neither the probe note nor its comment behind', () => {
    expect(report.cleaned).toBe(true)
  })
})
