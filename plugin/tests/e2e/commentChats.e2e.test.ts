/**
 * A comment, from the command to the card, in the app people actually run.
 *
 * Everything here is a question happy-dom cannot answer. Whether the raw `%%c:…%%` ever
 * reaches the screen is a question about CodeMirror's decorations. Whether the card is visible
 * is a question about a margin that has to be measured. And the phone sheet only exists under
 * `app.emulateMobile(true)`, which is Obsidian switching its own layout — there is no way to
 * ask for it from a test that does not have Obsidian.
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
import { isObsidianRunning, hasTestApi, evalRaw } from './helpers/obsidianCli'

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
  cardVisible: boolean
  /** Where the comment's chat file was expected, and whether it is there. */
  commentPath: string
  commentFileExists: boolean
  error: string
}

interface MobileReport {
  sheetOpen: boolean
  sheetInputVisible: boolean
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

/** Creates the note, runs the comment command on a selection, and reports what landed. */
const desktopScript = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const path = ${JSON.stringify(NOTE)}
  const quote = ${JSON.stringify(QUOTE)}
  const service = window.__abeleTest.CommentService.getInstance()
  const report = {
    via: 'none', rawMarkerText: true, markerIds: '', hasRoom: false, cardVisible: false,
    commentPath: '', commentFileExists: false, error: '',
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

    const box = document.querySelector('.abele-comment-widget-container')
    report.hasRoom = !!box && !box.classList.contains('abele-comment-widget-container_hidden')
    const card = document.querySelector('.abele-comment-card')
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

/** Taps the marker's icon and reports what the phone sheet showed. Run after the reload. */
const mobileScript = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const report = { sheetOpen: false, sheetInputVisible: false, error: '' }

  try {
    const marker = document.querySelector('.abele-comment-marker[data-comment-ids]')
    if (!marker) throw new Error('no marker visible after switching to mobile')
    marker.click()
    await wait(1200)

    const sheet = document.querySelector('.modal .abele-comment-card')
    report.sheetOpen = !!sheet
    const input = sheet && sheet.querySelector('textarea')
    report.sheetInputVisible = !!input && input.getBoundingClientRect().height > 0
  } catch (e) {
    report.error = String((e && e.message) || e)
  }

  return report
})()`

/** Closes whatever modal is open and switches emulation, waiting for the reload to settle. */
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
  await new Promise((resolve) => setTimeout(resolve, 2000))
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
    hasRoom: false,
    cardVisible: false,
    commentPath: '',
    commentFileExists: false,
    error: '',
  }
  let mobile: MobileReport = { sheetOpen: false, sheetInputVisible: false, error: '' }
  let cleanup: CleanupReport = { cleaned: false, error: '' }
  let mobileOn = false

  // A CLI timeout or a non-zero exit throws out of `run()` (see obsidianCli.ts), and a plain
  // sequence of awaits would then skip straight past both the phone toggle and the cleanup
  // call below it — leaving the probe note, and the mobile emulation, behind in the demo
  // vault. `finally` is what makes both unconditional; each is wrapped in its own `try` too,
  // so a broken CLI on the way out cannot swallow the failure that got us here.
  try {
    desktop = evalAsync<DesktopReport>(desktopScript, 60_000)

    if (desktop.markerIds) {
      await setMobile(true)
      mobileOn = true
      mobile = evalAsync<MobileReport>(mobileScript, 30_000)
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

    try {
      cleanup = evalAsync<CleanupReport>(cleanupScript, 30_000)
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

  it('shows the card in the margin exactly when the margin has room', () => {
    expect({ hasRoom: report.hasRoom, cardVisible: report.cardVisible }).toEqual({
      hasRoom: report.hasRoom,
      cardVisible: report.hasRoom,
    })
  })

  it('writes the conversation into the comment folder', () => {
    expect(report.commentPath).toMatch(/^AI\/Comments\/[a-z0-9]{6}\.abchat$/)
    expect(report.commentFileExists).toBe(true)
  })
})

describe.runIf(available)('the same comment on a phone', () => {
  it('opens as a sheet when the icon is tapped', () => {
    expect(report.sheetOpen).toBe(true)
  })

  it('keeps the input where it can be typed into', () => {
    expect(report.sheetInputVisible).toBe(true)
  })
})

describe.runIf(available)('afterwards', () => {
  it('leaves neither the probe note nor its comment behind', () => {
    expect(report.cleaned).toBe(true)
  })
})
