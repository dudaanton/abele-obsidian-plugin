/**
 * A comment, from the command to the card, in the app people actually run.
 *
 * Everything here is a question happy-dom cannot answer. Whether the raw `%%c:…%%` ever
 * reaches the screen is a question about CodeMirror's decorations. Whether the card is visible
 * is a question about a margin that has to be measured. And the phone's route into a dialog
 * only shows itself under `app.emulateMobile(true)`, which is Obsidian switching its own
 * layout — there is no way to ask for it from a test that does not have Obsidian. The dialog's
 * geometry is Obsidian's own `mod-lg`, so what is worth asking here is whether their rules
 * actually reached it: a sheet that sits inside the window with its close button on it.
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
  /** Whether the margin reported room — the card is only expected when it did. */
  hasRoom: boolean
  /** What this vault had these set to, so the cleanup can put them back. */
  readableLineLength: boolean
  leftCollapsed: boolean
  rightCollapsed: boolean
  cardVisible: boolean
  /** Where the comment's chat file was expected, and whether it is there. */
  commentPath: string
  commentFileExists: boolean
  error: string
}

interface MobileReport {
  /** Whether a dialog of ours is on screen at all after the tap. */
  modalOpen: boolean
  /** The card itself, inside it, expanded rather than folded. */
  cardVisible: boolean
  threadVisible: boolean
  /** The composer, tall enough to type into and set at a size iOS will not zoom into. */
  composerVisible: boolean
  composerFontPx: number
  /** Obsidian's own × for the dialog, and whether it is inside the window it opened in. */
  closeVisible: boolean
  closeInsideWindow: boolean
  /** The dialog's own box against the window: their sheet reaches the bottom and no further. */
  modalTop: number
  modalBottom: number
  windowHeight: number
  /** The sidebar was not borrowed for this: that is 1.17.1, and it is what came back wrong. */
  chatVisible: boolean
  error: string
}

interface CleanupReport {
  cleaned: boolean
  error: string
}

interface Report extends DesktopReport, MobileReport {
  cleaned: boolean
}

const NOTE = 'Abele comment probe.md'
const QUOTE = 'the passage the probe asks about'
const BODY = `# Comment probe\n\nA paragraph holding ${QUOTE} and little else.\n`

/** Deletes the probe note and whatever comment files its markers name, if either is there. */
const cleanupScript = (
  readable: boolean,
  leftCollapsed: boolean,
  rightCollapsed: boolean
) => `(async () => {
  const path = ${JSON.stringify(NOTE)}
  app.vault.setConfig('readableLineLength', ${readable})
  if (${leftCollapsed}) app.workspace.leftSplit.collapse()
  else app.workspace.leftSplit.expand()
  if (${rightCollapsed}) app.workspace.rightSplit.collapse()
  else app.workspace.rightSplit.expand()
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

/** Creates the note, runs the comment command on a selection, and reports what landed. */
const desktopScript = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const path = ${JSON.stringify(NOTE)}
  const quote = ${JSON.stringify(QUOTE)}
  const service = window.__abeleTest.CommentService.getInstance()
  const report = {
    via: 'none', rawMarkerText: true, markerIds: '', hasRoom: false, cardVisible: false,
    readableLineLength: false, leftCollapsed: false, rightCollapsed: false,
    commentPath: '', commentFileExists: false, error: '',
  }

  try {
    const stale = app.vault.getAbstractFileByPath(path)
    if (stale) await app.vault.delete(stale)
    const file = await app.vault.create(path, ${JSON.stringify(BODY)})

    // The margin is measured, and this vault has both sidebars open over a readable line of
    // 700 px: 127 px of right margin, which is under the 200 the overlay asks for. Without
    // this the desktop half of the probe only ever exercises the branch with no card in it.
    // Both are put back in the cleanup.
    report.readableLineLength = !!app.vault.getConfig('readableLineLength')
    report.leftCollapsed = !!app.workspace.leftSplit.collapsed
    report.rightCollapsed = !!app.workspace.rightSplit.collapsed
    app.vault.setConfig('readableLineLength', true)
    app.workspace.leftSplit.collapse()
    app.workspace.rightSplit.collapse()
    await wait(500)

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

    const box = document.querySelector('.abele-comment-widget-container')
    report.hasRoom = !!box && !box.classList.contains('abele-comment-widget-container_hidden')
    // Inside the host that was just asked about, not wherever the first card in the document
    // happens to be: with no margin there is no host, and Vue leaves the card at its mount
    // root — a card nobody can see, which is not the same as a card in the margin.
    const card = box && box.querySelector('.abele-comment-card')
    report.cardVisible = !!card && card.getBoundingClientRect().width > 0

    const id = report.markerIds.split(',')[0]
    report.commentPath = id ? service.commentPath(id) : ''
    report.commentFileExists =
      !!report.commentPath && !!app.vault.getAbstractFileByPath(report.commentPath)
  } catch (e) {
    report.error = String((e && e.message) || e)
  }

  return report
})()`

/**
 * Taps the marker's icon and reports what the phone showed. Run after the reload.
 *
 * The note is opened again first: `emulateMobile` reloads the app and the active file does not
 * reliably come back with it, so a script that went straight for the marker would be asking
 * about whatever the workspace happened to restore.
 */
const mobileScript = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const shown = (el) => !!el && el.getBoundingClientRect().height > 0
  const report = {
    modalOpen: false, cardVisible: false, threadVisible: false, composerVisible: false,
    composerFontPx: 0, closeVisible: false, closeInsideWindow: false,
    modalTop: 0, modalBottom: 0, windowHeight: 0, chatVisible: false, error: '',
  }

  try {
    const note = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})
    if (!note) throw new Error('the probe note is gone after switching to mobile')
    await app.workspace.getLeaf(false).openFile(note)
    await wait(2000)

    const marker = document.querySelector('.abele-comment-marker[data-comment-ids]')
    if (!marker) throw new Error('no marker visible after switching to mobile')
    marker.click()
    await wait(2000)

    report.windowHeight = window.innerHeight

    const modal = document.querySelector('.modal.abele-modal_tall')
    report.modalOpen = shown(modal)
    if (!modal) return report

    // The window this runs in is usually behind the terminal that started the test, and a
    // hidden page runs no animations: Obsidian slides its phone sheet up from the bottom, so
    // the box measured there is the box the sheet started from. Cancelling the transition
    // snaps it to where it was going.
    modal.style.transition = 'none'
    void modal.offsetHeight
    const box = modal.getBoundingClientRect()
    report.modalTop = Math.round(box.top)
    report.modalBottom = Math.round(box.bottom)

    const card = modal.querySelector('.abele-comment-card')
    report.cardVisible = shown(card)
    report.threadVisible = shown(modal.querySelector('.abele-comment-thread'))

    const field = modal.querySelector('.abele-comment-input__field')
    report.composerVisible = shown(field)
    if (field) {
      report.composerFontPx = Math.round(parseFloat(getComputedStyle(field).fontSize) || 0)
    }

    // Obsidian's own, drawn by the frame rather than by us — which is the point of asking for
    // their mod-lg instead of writing the geometry again.
    const close = modal.querySelector('.modal-close-button, .modal-header-button')
    report.closeVisible = shown(close)
    if (close) {
      const c = close.getBoundingClientRect()
      report.closeInsideWindow = c.top >= 0 && c.bottom <= window.innerHeight
    }

    report.chatVisible = shown(document.querySelector('.abele-ai-chat'))
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
 * `emulateMobile` switches Obsidian's layout but not the width of the window, and width is the
 * whole question here: the margin is measured, so a phone-shaped layout in a 1400 px window
 * still has room for a card beside the text and the marker would open one. The size is carried
 * in the test process rather than on `window`, because the toggle reloads the page and takes
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

  evalAsync(cleanupScript(false, false, false), 30_000)

  let desktop: DesktopReport = {
    via: 'none',
    rawMarkerText: true,
    markerIds: '',
    hasRoom: false,
    cardVisible: false,
    readableLineLength: false,
    leftCollapsed: false,
    rightCollapsed: false,
    commentPath: '',
    commentFileExists: false,
    error: '',
  }
  let mobile: MobileReport = {
    modalOpen: false,
    cardVisible: false,
    threadVisible: false,
    composerVisible: false,
    composerFontPx: 0,
    closeVisible: false,
    closeInsideWindow: false,
    modalTop: 0,
    modalBottom: 0,
    windowHeight: 0,
    chatVisible: false,
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
      // A phone's width as well as a phone's layout: the margin is measured, and a wide window
      // has room for a card whatever Obsidian is calling itself.
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
      cleanup = evalAsync<CleanupReport>(
        cleanupScript(
          desktop.readableLineLength,
          desktop.leftCollapsed,
          desktop.rightCollapsed
        ),
        30_000
      )
    } catch (e) {
      cleanup = { cleaned: false, error: String((e as Error)?.message ?? e) }
    }
  }

  report = {
    ...desktop,
    ...mobile,
    error: [desktop.error, mobile.error, cleanup.error].filter(Boolean).join('; '),
    cleaned: cleanup.cleaned,
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

  it('hangs the card in the margin the pane was given room for', () => {
    expect({ hasRoom: report.hasRoom, cardVisible: report.cardVisible }).toEqual({
      hasRoom: true,
      cardVisible: true,
    })
  })

  it('writes the conversation into the comment folder', () => {
    expect(report.commentPath).toMatch(/^AI\/Comments\/[a-z0-9]{6}\.abchat$/)
    expect(report.commentFileExists).toBe(true)
  })
})

describe.runIf(available)('the same comment on a phone', () => {
  it('opens the card in a dialog when the icon is tapped', () => {
    expect({ modal: report.modalOpen, card: report.cardVisible }).toEqual({
      modal: true,
      card: true,
    })
  })

  it('does not borrow the chat sidebar, which is the agent own room', () => {
    expect(report.chatVisible).toBe(false)
  })

  it('shows the conversation and a composer a thumb can type into', () => {
    expect({ thread: report.threadVisible, composer: report.composerVisible }).toEqual({
      thread: true,
      composer: true,
    })
  })

  /** Below 16 px iOS zooms the note into the focused field, and it has to be pinched back. */
  it('sets the field at a size iOS will not zoom into', () => {
    expect(report.composerFontPx).toBeGreaterThanOrEqual(16)
  })

  /**
   * The regression this release is about: 1.17.0 wrote the sheet's geometry itself and put
   * Obsidian's own × behind the status bar. The dialog is theirs now, and the × comes with it.
   */
  it('keeps Obsidian own close button on screen', () => {
    expect({ visible: report.closeVisible, inside: report.closeInsideWindow }).toEqual({
      visible: true,
      inside: true,
    })
  })

  it('stands inside the window, top and bottom', () => {
    expect(report.modalTop).toBeGreaterThanOrEqual(0)
    expect(report.modalBottom).toBeLessThanOrEqual(report.windowHeight)
  })
})

describe.runIf(available)('afterwards', () => {
  it('leaves neither the probe note nor its comment behind', () => {
    expect(report.cleaned).toBe(true)
  })
})
